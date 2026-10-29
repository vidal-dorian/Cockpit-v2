import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { decrypt } from "./secrets.ts";
import { send } from "./test-decisions.ts";
import { stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";
import {
  archiveProject,
  closeWriting,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  type TestDb,
  userWithToken,
} from "./test-mcp.ts";

// Slice "Programmer l'écriture des US" (decision 022): the routine of a user (an address and a token for the
// `/fire` call of a Claude Code scheduled task), the schedule of each project, the tick that fires, the button.
//
// Choices fixed here, where the decision leaves them open (the developer may not weaken them):
// - The outbound `/fire` call is `AppOptions.fireRoutine?: (url: string, init?: RequestInit) => Promise<Response>`, a
//   fetch-shaped function (default: the global fetch). Cockpit adds the abort signal (10 s) itself, like
//   `fetchClientMetadata`. A rejection (timeout, network) and a non-2xx answer are both a failed fire.
// - `AppOptions.now` (021, milliseconds) is the clock of the routes: the computation of `nextRunAt` at save time,
//   `lastRun.at` of the button.
// - The tick is `runDueRoutines(db, { encryptionKey, fireRoutine }, now: Date)` exported by ./routines.ts (it must
//   not need the clock of the app, so a test never waits for a minute). `scheduleRoutines(db, { encryptionKey,
//   fireRoutine })` (same module) calls it every 60 seconds with the real time and returns an unref'd timer.
// - Table `write_us_routines` (one row per user, 022 C); the token column holds `encrypt(key, token)` ("v1:..."),
//   read here without knowing the column names.
// - GET /api/me/routine -> { connected, fireUrl (null when none), needsReconnect, prompt } (the prompt of 022 B is
//   there too, also when nothing is connected). PUT answers 200 with the same object. DELETE answers 204.
// - Project: GET and PUT /api/projects/:id/routine both answer { frequency, hour (null), weekday (null), timeZone,
//   nextRunAt (ISO or null), lastRun ({ at, result: "ok" | "error", sessionUrl } or null) }. A project that was
//   never scheduled is { frequency: "off", ... nextRunAt: null, lastRun: null }. `weekday` is ISO: Monday 1 .. Sunday 7.
// - The routine used for a project is the one of the user who saved its schedule (or who clicks the button).
// - POST /api/projects/:id/routine/run: 200 { sessionUrl }; 409 { error: "routine_not_connected" | "routine_needs_reconnect"
//   | "project_archived" }; a failed fire is 502 { error: "fire_failed" } (a 401/403 of /fire is the 409
//   routine_needs_reconnect right away). The button does not move `nextRunAt`.
// - `fire_write_us` entries carry the user (the owner of the routine); a failed one is `error` with detail { reason: "error" }.
// - The tick runs the project at `nextRunAt <= now` and moves `nextRunAt` to the first occurrence strictly after `now`
//   (a server that was down does not catch up every missed day).

const NOW = new Date("2026-10-29T10:00:00Z"); // a Thursday
const TICK = new Date("2026-10-30T06:00:30Z"); // just after the first daily 7 h (Europe/Paris, CET) after NOW
const FIRE_URL =
  "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCdef23/fire";
const TOKEN = "sk-ant-oat01-ROUTINE-TOKEN-9f3a";
const FIRE_ANSWER = {
  type: "routine_fire",
  claude_code_session_id: "session_01HJKLMNOPQRSTUVWXYZ",
  claude_code_session_url:
    "https://claude.ai/code/session_01HJKLMNOPQRSTUVWXYZ",
};
const DAILY = { frequency: "daily", hour: 7, timeZone: "Europe/Paris" };

type Fire = (url: string, init?: RequestInit) => Promise<Response>;
type FireCall = {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: unknown;
};
type Handler = (call: FireCall, n: number) => Response | Promise<Response>;

const answerOk: Handler = () => Response.json(FIRE_ANSWER);
const answerStatus =
  (status: number): Handler =>
  () =>
    Response.json({ error: "stub failure" }, { status });

/** The double of `/fire`: records every call and answers with `handler`. A handler that throws is a network failure. */
function fireDouble(handler: Handler = answerOk, delayMs = 0) {
  const calls: FireCall[] = [];
  const fn: Fire = async (url, init = {}) => {
    let body: unknown = init.body;
    try {
      body = JSON.parse(String(init.body));
    } catch {}
    const call = { url, init, headers: new Headers(init.headers), body };
    calls.push(call);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return handler(call, calls.length);
  };
  return { fn, calls };
}

/** Alice (1000) with a project, the clock at NOW, the global fetch stubbed so that nothing real is reached. */
async function setup(handler?: Handler, delayMs = 0) {
  stubGitHub({ account: 1000 });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const clock = { now: NOW.getTime() };
  const fire = fireDouble(handler, delayMs);
  const app = createApp(db, "1.2.3", {
    ...testAppOptions,
    fireRoutine: fire.fn,
    now: () => clock.now,
  });
  const alice = await userWithToken(app, db, 1000);
  const projectId = await seedProject(db, alice.id, {
    githubRepoId: 1,
    fullName: "user1000/app",
  });
  // Imported here: the tests of the routes must not all fail because the module is missing.
  const tick = async (at: Date) => {
    const { runDueRoutines } = await import("./routines.ts");
    return runDueRoutines(
      db,
      { encryptionKey: TEST_KEY, fireRoutine: fire.fn },
      at,
    );
  };
  return { db, app, fire, clock, alice, projectId, tick };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
type App = Ctx["app"];

const connectBody = (over: Record<string, unknown> = {}) => ({
  fireUrl: FIRE_URL,
  token: TOKEN,
  ...over,
});
const connectRoutine = (app: App, cookie: string, body: unknown) =>
  send(app, cookie, "PUT", "/api/me/routine", body);
const getRoutine = (app: App, cookie: string) =>
  send(app, cookie, "GET", "/api/me/routine");
const putSchedule = (
  app: App,
  cookie: string,
  projectId: number | string,
  body: unknown,
) => send(app, cookie, "PUT", `/api/projects/${projectId}/routine`, body);
const getSchedule = (app: App, cookie: string, projectId: number | string) =>
  send(app, cookie, "GET", `/api/projects/${projectId}/routine`);
const runNow = (app: App, cookie: string, projectId: number | string) =>
  send(app, cookie, "POST", `/api/projects/${projectId}/routine/run`);

type RoutineState = {
  connected: boolean;
  fireUrl: string | null;
  needsReconnect: boolean;
  prompt: string;
};
type Schedule = {
  frequency: string;
  hour: number | null;
  weekday: number | null;
  timeZone: string;
  nextRunAt: string | null;
  lastRun: { at: string; result: string; sessionUrl: string | null } | null;
};

/** Connects the routine of the user and checks the 200, so a test never goes on from a missing feature. */
async function connected(
  ctx: Ctx,
  cookie = ctx.alice.cookie,
  body = connectBody(),
) {
  const res = await connectRoutine(ctx.app, cookie, body);
  expect(res.status, "connecting the routine must work for this test").toBe(
    200,
  );
}
/** Saves a schedule (clock at NOW unless set) and checks the 200. */
async function scheduled(
  ctx: Ctx,
  body: unknown = DAILY,
  projectId = ctx.projectId,
  cookie = ctx.alice.cookie,
) {
  const res = await putSchedule(ctx.app, cookie, projectId, body);
  expect(res.status, "saving the schedule must work for this test").toBe(200);
  return (await res.json()) as Schedule;
}
const readRoutine = async (ctx: Ctx, cookie = ctx.alice.cookie) =>
  (await (await getRoutine(ctx.app, cookie)).json()) as RoutineState;
const readSchedule = async (
  ctx: Ctx,
  projectId = ctx.projectId,
  cookie = ctx.alice.cookie,
) => (await (await getSchedule(ctx.app, cookie, projectId)).json()) as Schedule;

/** A project that has something to write, a connected routine and a daily schedule: due at TICK. */
async function due(ctx: Ctx) {
  await connected(ctx);
  await seedTicket(ctx.db, ctx.projectId, "À découper");
  await scheduled(ctx);
}

const entries = (db: TestDb, action: string) =>
  rows(db, sql`action = ${action}`);
const fired = (db: TestDb) => entries(db, "fire_write_us");
const allHistory = async (db: TestDb) => JSON.stringify(await rows(db));

async function routineRows(db: TestDb) {
  const result = await db.execute(sql`select * from write_us_routines`);
  return (result as unknown as { rows: Record<string, unknown>[] }).rows;
}

const SECRET_PARTS = [TOKEN, "trig_01ABCdef23", "api.anthropic.com"];
const expectNoSecret = (text: string) => {
  for (const part of SECRET_PARTS) expect(text).not.toContain(part);
};

describe("PUT /api/me/routine", () => {
  it("given an address and a token, when they are saved, then 200 and GET /api/me/routine says connected with the address, without the token", async () => {
    const ctx = await setup();

    const res = await connectRoutine(ctx.app, ctx.alice.cookie, connectBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      connected: true,
      fireUrl: FIRE_URL,
      needsReconnect: false,
    });
    const got = await getRoutine(ctx.app, ctx.alice.cookie);
    expect(got.status).toBe(200);
    const body = (await got.json()) as RoutineState;
    expect(Object.keys(body).sort()).toEqual([
      "connected",
      "fireUrl",
      "needsReconnect",
      "prompt",
    ]);
    expect(body).toMatchObject({
      connected: true,
      fireUrl: FIRE_URL,
      needsReconnect: false,
    });
  });

  it("given a saved token, when the database is read, then it is stored encrypted with the instance key and the raw value is nowhere: not in the row, not in any answer, not in the history", async () => {
    const ctx = await setup();

    const put = await connectRoutine(ctx.app, ctx.alice.cookie, connectBody());
    const putText = await put.text();
    const getText = await (await getRoutine(ctx.app, ctx.alice.cookie)).text();

    const stored = await routineRows(ctx.db);
    expect(stored).toHaveLength(1);
    const values = Object.values(stored[0] ?? {}).filter(
      (v): v is string => typeof v === "string",
    );
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
    const sealed = values.filter((v) => v.startsWith("v1:"));
    expect(sealed, "one column holds the encrypted token").toHaveLength(1);
    expect(decrypt(TEST_KEY, sealed[0] as string)).toBe(TOKEN);
    expect(putText).not.toContain(TOKEN);
    expect(getText).not.toContain(TOKEN);
    expect(await allHistory(ctx.db)).not.toContain(TOKEN);
    // The other answers that mention the routine.
    await scheduled(ctx);
    expect(
      await (
        await getSchedule(ctx.app, ctx.alice.cookie, ctx.projectId)
      ).text(),
    ).not.toContain(TOKEN);
    expect(
      await (
        await send(ctx.app, ctx.alice.cookie, "GET", "/api/history")
      ).text(),
    ).not.toContain(TOKEN);
  });

  it("given a routine already saved, when another address and token are saved, then they replace it (one row) and the next fire uses the new ones", async () => {
    const ctx = await setup();
    await due(ctx);
    const other =
      "https://api.anthropic.com/v1/claude_code/routines/trig_02NEW/fire";

    await connected(
      ctx,
      ctx.alice.cookie,
      connectBody({ fireUrl: other, token: "second-token" }),
    );

    expect(await routineRows(ctx.db)).toHaveLength(1);
    expect((await readRoutine(ctx)).fireUrl).toBe(other);
    await ctx.tick(TICK);
    expect(ctx.fire.calls).toHaveLength(1);
    expect(ctx.fire.calls[0]?.url).toBe(other);
    expect(ctx.fire.calls[0]?.headers.get("authorization")).toBe(
      "Bearer second-token",
    );
  });

  it.each([
    ["another host", "https://example.com/v1/claude_code/routines/trig_1/fire"],
    [
      "a host that only starts like it",
      "https://api.anthropic.com.evil.com/v1/claude_code/routines/trig_1/fire",
    ],
    [
      "a user in front of the host",
      "https://api.anthropic.com@evil.com/v1/claude_code/routines/trig_1/fire",
    ],
    [
      "a subdomain",
      "https://x.api.anthropic.com/v1/claude_code/routines/trig_1/fire",
    ],
    ["http", "http://api.anthropic.com/v1/claude_code/routines/trig_1/fire"],
    [
      "another port",
      "https://api.anthropic.com:8443/v1/claude_code/routines/trig_1/fire",
    ],
    [
      "an extra path after fire",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1/fire/extra",
    ],
    [
      "a trailing slash",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1/fire/",
    ],
    [
      "a path in front",
      "https://api.anthropic.com/x/v1/claude_code/routines/trig_1/fire",
    ],
    [
      "a query",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1/fire?x=1",
    ],
    [
      "a fragment",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1/fire#x",
    ],
    ["a missing id", "https://api.anthropic.com/v1/claude_code/routines//fire"],
    ["no id segment", "https://api.anthropic.com/v1/claude_code/routines/fire"],
    [
      "an id that holds a slash",
      "https://api.anthropic.com/v1/claude_code/routines/a/b/fire",
    ],
    ["another endpoint", "https://api.anthropic.com/v1/messages"],
    [
      "a path that is not fire",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1/delete",
    ],
    ["an empty string", ""],
    ["something that is not an address", "pas une adresse"],
    [
      "a NUL character",
      "https://api.anthropic.com/v1/claude_code/routines/trig_1\u0000/fire",
    ],
  ])(
    "given %s as the address, when it is saved, then 400, nothing is stored and nothing is written to the history",
    async (_name, fireUrl) => {
      const ctx = await setup();

      const res = await connectRoutine(
        ctx.app,
        ctx.alice.cookie,
        connectBody({ fireUrl }),
      );

      expect(res.status).toBe(400);
      expect((await readRoutine(ctx)).connected).toBe(false);
      expect(await routineRows(ctx.db)).toHaveLength(0);
      expect(await entries(ctx.db, "connect_routine")).toHaveLength(0);
    },
  );

  it("given an address that is not a string, or no address, when it is saved, then 400", async () => {
    const ctx = await setup();

    const missing = await connectRoutine(ctx.app, ctx.alice.cookie, {
      token: TOKEN,
    });
    const number = await connectRoutine(
      ctx.app,
      ctx.alice.cookie,
      connectBody({ fireUrl: 3 }),
    );

    expect(missing.status).toBe(400);
    expect(number.status).toBe(400);
    expect((await readRoutine(ctx)).connected).toBe(false);
  });

  it.each([
    ["an empty token", ""],
    ["a token of 4,097 characters", "t".repeat(4097)],
    ["a token with a NUL character", "abc\u0000def"],
    ["a token that is not a string", 12345],
    ["a token that is null", null],
  ])(
    "given %s, when it is saved, then 400, nothing is stored and nothing is written to the history",
    async (_name, token) => {
      const ctx = await setup();

      const res = await connectRoutine(
        ctx.app,
        ctx.alice.cookie,
        connectBody({ token }),
      );

      expect(res.status).toBe(400);
      expect((await readRoutine(ctx)).connected).toBe(false);
      expect(await routineRows(ctx.db)).toHaveLength(0);
      expect(await entries(ctx.db, "connect_routine")).toHaveLength(0);
    },
  );

  it("given no token, or a body that is not JSON, when it is saved, then 400", async () => {
    const ctx = await setup();

    const none = await connectRoutine(ctx.app, ctx.alice.cookie, {
      fireUrl: FIRE_URL,
    });
    const broken = await ctx.app.request("/api/me/routine", {
      method: "PUT",
      headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
      body: "{not json",
    });

    expect(none.status).toBe(400);
    expect(broken.status).toBe(400);
    expect((await readRoutine(ctx)).connected).toBe(false);
  });

  it("given a token of exactly 4,096 characters, when it is saved, then 200", async () => {
    const ctx = await setup();

    const res = await connectRoutine(
      ctx.app,
      ctx.alice.cookie,
      connectBody({ token: "t".repeat(4096) }),
    );

    expect(res.status).toBe(200);
  });

  it("given a connected routine, when the history is read, then one connect_routine entry is ok, human, ui, with no argument at all and no address nor token anywhere", async () => {
    const ctx = await setup();

    await connected(ctx);

    const found = await entries(ctx.db, "connect_routine");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: {},
      project_id: null,
    });
    expectNoSecret(await allHistory(ctx.db));
  });
});

describe("GET /api/me/routine", () => {
  it("given no routine, when it is read, then connected is false, fireUrl null, needsReconnect false, and the prompt is there anyway", async () => {
    const ctx = await setup();

    const res = await getRoutine(ctx.app, ctx.alice.cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as RoutineState;
    expect(body).toMatchObject({
      connected: false,
      fireUrl: null,
      needsReconnect: false,
    });
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt.length).toBeGreaterThan(100);
  });

  it("given the answer, when the prompt is read, then it is the English prompt of decision 022 B: it names the tools, the fire payload block and project_id", async () => {
    const ctx = await setup();

    const { prompt } = await readRoutine(ctx);

    for (const name of [
      "list_tickets_needing_us",
      "create_user_stories",
      "update_user_story",
      "routine-fire-payload",
      "project_id",
    ])
      expect(prompt, name).toContain(name);
    expect(prompt).toMatch(/Cockpit/);
    expect(prompt).toMatch(/This task is started by Cockpit/);
  });

  it("given two users, one connected, when they read, then the prompt is the same fixed text for both and the other sees no routine", async () => {
    const ctx = await setup();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    await connected(ctx);

    const mine = await readRoutine(ctx);
    const his = await readRoutine(ctx, bob.cookie);

    expect(mine.connected).toBe(true);
    expect(his).toMatchObject({
      connected: false,
      fireUrl: null,
      needsReconnect: false,
    });
    expect(his.prompt).toBe(mine.prompt);
    expect(mine.prompt).not.toContain(TOKEN);
    expect(mine.prompt).not.toContain("trig_01ABCdef23");
  });
});

describe("DELETE /api/me/routine", () => {
  it("given a connected routine, when it is removed, then 204, the row is gone, GET says not connected and one disconnect_routine entry has no argument, no address and no token", async () => {
    const ctx = await setup();
    await connected(ctx);

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      "/api/me/routine",
    );

    expect(res.status).toBe(204);
    expect(await routineRows(ctx.db)).toHaveLength(0);
    expect(await readRoutine(ctx)).toMatchObject({
      connected: false,
      fireUrl: null,
    });
    const found = await entries(ctx.db, "disconnect_routine");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: {},
    });
    expectNoSecret(await allHistory(ctx.db));
  });
});

describe("access to /api/me/routine", () => {
  it.each([
    ["GET", (app: App) => getRoutine(app, "")],
    ["PUT", (app: App) => connectRoutine(app, "", connectBody())],
    [
      "PUT with an invalid body",
      (app: App) => connectRoutine(app, "", { fireUrl: "x", token: "" }),
    ],
    ["DELETE", (app: App) => send(app, "", "DELETE", "/api/me/routine")],
  ])("given no session, when %s is called, then 401", async (_name, call) => {
    const ctx = await setup();

    const res = await call(ctx.app);

    expect(res.status).toBe(401);
    expect(await routineRows(ctx.db)).toHaveLength(0);
  });

  it("given two users, when each connects their own routine, then each sees only their own and removing one leaves the other", async () => {
    const ctx = await setup();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const bobUrl =
      "https://api.anthropic.com/v1/claude_code/routines/trig_BOB/fire";
    await connected(ctx);
    await connected(
      ctx,
      bob.cookie,
      connectBody({ fireUrl: bobUrl, token: "bob-token" }),
    );

    expect((await readRoutine(ctx)).fireUrl).toBe(FIRE_URL);
    expect((await readRoutine(ctx, bob.cookie)).fireUrl).toBe(bobUrl);
    expect(await routineRows(ctx.db)).toHaveLength(2);
    const res = await send(ctx.app, bob.cookie, "DELETE", "/api/me/routine");

    expect(res.status).toBe(204);
    expect((await readRoutine(ctx)).fireUrl).toBe(FIRE_URL);
    expect((await readRoutine(ctx, bob.cookie)).connected).toBe(false);
  });
});

describe("GET and PUT /api/projects/:id/routine", () => {
  it("given a project never scheduled, when its routine is read, then it is off, with no next run and no last run", async () => {
    const ctx = await setup();

    const res = await getSchedule(ctx.app, ctx.alice.cookie, ctx.projectId);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      frequency: "off",
      hour: null,
      weekday: null,
      nextRunAt: null,
      lastRun: null,
    });
  });

  it.each([
    [
      "off",
      { frequency: "off", timeZone: "Europe/Paris" },
      { hour: null, weekday: null },
      false,
    ],
    [
      "on_demand",
      { frequency: "on_demand", timeZone: "Europe/Paris" },
      { hour: null, weekday: null },
      false,
    ],
    [
      "daily",
      { frequency: "daily", hour: 7, timeZone: "Europe/Paris" },
      { hour: 7, weekday: null },
      true,
    ],
    [
      "weekly",
      { frequency: "weekly", hour: 9, weekday: 1, timeZone: "Europe/Paris" },
      { hour: 9, weekday: 1 },
      true,
    ],
  ])(
    "given the frequency %s, when it is saved, then 200 and GET gives it back, with a next run only when it is a schedule",
    async (frequency, body, shown, hasNext) => {
      const ctx = await setup();

      const res = await putSchedule(
        ctx.app,
        ctx.alice.cookie,
        ctx.projectId,
        body,
      );

      expect(res.status).toBe(200);
      const saved = (await res.json()) as Schedule;
      expect(saved).toMatchObject({
        frequency,
        timeZone: "Europe/Paris",
        lastRun: null,
        ...shown,
      });
      expect(typeof saved.nextRunAt).toBe(hasNext ? "string" : "object");
      expect(await readSchedule(ctx)).toEqual(saved);
      if (!hasNext) expect(saved.nextRunAt).toBeNull();
      if (hasNext)
        expect(Date.parse(saved.nextRunAt as string)).toBeGreaterThan(
          NOW.getTime(),
        );
    },
  );

  it("given a daily schedule, when it is switched to on_demand and then off, then the next run goes away and it is saved as such", async () => {
    const ctx = await setup();
    await scheduled(ctx);

    const second = await scheduled(ctx, {
      frequency: "on_demand",
      timeZone: "Europe/Paris",
    });
    const third = await scheduled(ctx, {
      frequency: "off",
      timeZone: "Europe/Paris",
    });

    expect(second).toMatchObject({ frequency: "on_demand", nextRunAt: null });
    expect(third).toMatchObject({ frequency: "off", nextRunAt: null });
    expect(await readSchedule(ctx)).toMatchObject({
      frequency: "off",
      nextRunAt: null,
    });
  });

  it.each([
    // [name, saved at (UTC), body, expected next run (UTC)]
    [
      "daily 7 h in Paris, saved on 29 Oct at 10:00 UTC (after 7 h local)",
      "2026-10-29T10:00:00Z",
      DAILY,
      "2026-10-30T06:00:00Z",
    ],
    [
      "daily 7 h in Paris, saved on 29 Oct at 04:00 UTC (before 7 h local)",
      "2026-10-29T04:00:00Z",
      DAILY,
      "2026-10-29T06:00:00Z",
    ],
    [
      "daily 7 h in Paris, saved the day before the DST change (summer time, UTC+2)",
      "2026-10-23T10:00:00Z",
      DAILY,
      "2026-10-24T05:00:00Z",
    ],
    [
      "daily 7 h in Paris, saved on the eve of the change: the run lands after it (UTC+1)",
      "2026-10-24T10:00:00Z",
      DAILY,
      "2026-10-25T06:00:00Z",
    ],
    [
      "daily 7 h in UTC",
      "2026-10-29T10:00:00Z",
      { frequency: "daily", hour: 7, timeZone: "UTC" },
      "2026-10-30T07:00:00Z",
    ],
    [
      "daily 7 h in India (UTC+5:30)",
      "2026-10-29T10:00:00Z",
      { frequency: "daily", hour: 7, timeZone: "Asia/Kolkata" },
      "2026-10-30T01:30:00Z",
    ],
    [
      "daily 7 h in New York, saved the day before its DST change (EDT to EST on 1 Nov)",
      "2026-10-31T12:00:00Z",
      { frequency: "daily", hour: 7, timeZone: "America/New_York" },
      "2026-11-01T12:00:00Z",
    ],
    [
      "daily at midnight in Paris",
      "2026-10-29T10:00:00Z",
      { frequency: "daily", hour: 0, timeZone: "Europe/Paris" },
      "2026-10-29T23:00:00Z",
    ],
    [
      "weekly Monday 9 h in Paris, saved on a Thursday",
      "2026-10-29T10:00:00Z",
      { frequency: "weekly", weekday: 1, hour: 9, timeZone: "Europe/Paris" },
      "2026-11-02T08:00:00Z",
    ],
    [
      "weekly Thursday 7 h in Paris, saved on Thursday after 7 h: next week",
      "2026-10-29T10:00:00Z",
      { frequency: "weekly", weekday: 4, hour: 7, timeZone: "Europe/Paris" },
      "2026-11-05T06:00:00Z",
    ],
    [
      "weekly Thursday 12 h in Paris, saved on Thursday before 12 h: the same day",
      "2026-10-29T10:00:00Z",
      { frequency: "weekly", weekday: 4, hour: 12, timeZone: "Europe/Paris" },
      "2026-10-29T11:00:00Z",
    ],
    [
      "weekly Sunday (7) 7 h in Paris",
      "2026-10-29T10:00:00Z",
      { frequency: "weekly", weekday: 7, hour: 7, timeZone: "Europe/Paris" },
      "2026-11-01T06:00:00Z",
    ],
    [
      "weekly Saturday 7 h in Paris, the day before the change (UTC+2)",
      "2026-10-20T10:00:00Z",
      { frequency: "weekly", weekday: 6, hour: 7, timeZone: "Europe/Paris" },
      "2026-10-24T05:00:00Z",
    ],
    [
      "weekly Sunday 7 h in Paris, the day of the change (UTC+1)",
      "2026-10-20T10:00:00Z",
      { frequency: "weekly", weekday: 7, hour: 7, timeZone: "Europe/Paris" },
      "2026-10-25T06:00:00Z",
    ],
  ])(
    "given %s, when the schedule is saved, then nextRunAt is the next local occurrence in UTC",
    async (_name, at, body, expected) => {
      const ctx = await setup();
      ctx.clock.now = Date.parse(at);

      const saved = await scheduled(ctx, body);

      expect(saved.nextRunAt).not.toBeNull();
      expect(Date.parse(saved.nextRunAt as string)).toBe(Date.parse(expected));
      expect((await readSchedule(ctx)).nextRunAt).toBe(saved.nextRunAt);
    },
  );

  it.each([
    ["an unknown frequency", { frequency: "hourly", timeZone: "Europe/Paris" }],
    ["no frequency", { hour: 7, timeZone: "Europe/Paris" }],
    ["daily without an hour", { frequency: "daily", timeZone: "Europe/Paris" }],
    [
      "an hour of 24",
      { frequency: "daily", hour: 24, timeZone: "Europe/Paris" },
    ],
    [
      "a negative hour",
      { frequency: "daily", hour: -1, timeZone: "Europe/Paris" },
    ],
    [
      "a decimal hour",
      { frequency: "daily", hour: 7.5, timeZone: "Europe/Paris" },
    ],
    [
      "an hour that is a string",
      { frequency: "daily", hour: "7", timeZone: "Europe/Paris" },
    ],
    [
      "weekly without an hour",
      { frequency: "weekly", weekday: 1, timeZone: "Europe/Paris" },
    ],
    [
      "weekly without a weekday",
      { frequency: "weekly", hour: 7, timeZone: "Europe/Paris" },
    ],
    [
      "a weekday of 0",
      { frequency: "weekly", hour: 7, weekday: 0, timeZone: "Europe/Paris" },
    ],
    [
      "a weekday of 8",
      { frequency: "weekly", hour: 7, weekday: 8, timeZone: "Europe/Paris" },
    ],
    [
      "a decimal weekday",
      { frequency: "weekly", hour: 7, weekday: 1.5, timeZone: "Europe/Paris" },
    ],
    [
      "an unknown time zone",
      { frequency: "daily", hour: 7, timeZone: "Mars/Phobos" },
    ],
    [
      "a time zone with a typo",
      { frequency: "daily", hour: 7, timeZone: "Europe/Pariss" },
    ],
    ["an empty time zone", { frequency: "daily", hour: 7, timeZone: "" }],
    ["no time zone", { frequency: "daily", hour: 7 }],
    [
      "a time zone that is not a string",
      { frequency: "daily", hour: 7, timeZone: 2 },
    ],
    [
      "a NUL in the time zone",
      { frequency: "daily", hour: 7, timeZone: "Europe/Paris\u0000" },
    ],
  ])(
    "given %s, when the schedule is saved, then 400, the saved schedule is untouched and nothing more is written to the history",
    async (_name, body) => {
      const ctx = await setup();
      const first = await scheduled(ctx);

      const res = await putSchedule(
        ctx.app,
        ctx.alice.cookie,
        ctx.projectId,
        body,
      );

      expect(res.status).toBe(400);
      expect(await readSchedule(ctx)).toEqual(first);
      expect(await entries(ctx.db, "schedule_routine")).toHaveLength(1);
    },
  );

  it("given a body that is not JSON, when the schedule is saved, then 400", async () => {
    const ctx = await setup();

    const res = await ctx.app.request(
      `/api/projects/${ctx.projectId}/routine`,
      {
        method: "PUT",
        headers: {
          cookie: ctx.alice.cookie,
          "content-type": "application/json",
        },
        body: "{not json",
      },
    );

    expect(res.status).toBe(400);
  });

  it("given a saved schedule, when the history is read, then one schedule_routine entry holds exactly { projectId, frequency }, the project id column, human and ui, and no time zone", async () => {
    const ctx = await setup();

    await scheduled(ctx);

    const found = await entries(ctx.db, "schedule_routine");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      project_id: ctx.projectId,
      args: { projectId: ctx.projectId, frequency: "daily" },
    });
    expect(found[0]?.args).toEqual({
      projectId: ctx.projectId,
      frequency: "daily",
    });
    expect(JSON.stringify(found[0])).not.toContain("Europe/Paris");
  });
});

describe("access to /api/projects/:id/routine", () => {
  it.each([
    ["GET", (app: App, id: number) => getSchedule(app, "", id)],
    ["PUT", (app: App, id: number) => putSchedule(app, "", id, DAILY)],
    ["POST .../run", (app: App, id: number) => runNow(app, "", id)],
  ])("given no session, when %s is called, then 401", async (_name, call) => {
    const ctx = await setup();

    const res = await call(ctx.app, ctx.projectId);

    expect(res.status).toBe(401);
    expect(ctx.fire.calls).toHaveLength(0);
  });

  it.each([
    [
      "GET",
      (ctx: Ctx, bob: { cookie: string }, id: number | string) =>
        getSchedule(ctx.app, bob.cookie, id),
    ],
    [
      "PUT",
      (ctx: Ctx, bob: { cookie: string }, id: number | string) =>
        putSchedule(ctx.app, bob.cookie, id, DAILY),
    ],
    [
      "POST .../run",
      (ctx: Ctx, bob: { cookie: string }, id: number | string) =>
        runNow(ctx.app, bob.cookie, id),
    ],
  ])(
    "given the project of someone else, an unknown one or a bad id, when %s is called, then 404, nothing is saved, nothing is fired and nothing is written to the history",
    async (_name, call) => {
      const ctx = await setup();
      const bob = await userWithToken(ctx.app, ctx.db, 2000);
      await connected(ctx, bob.cookie);
      const before = (await rows(ctx.db)).length;

      for (const id of [ctx.projectId, 999, "abc", 0, -1]) {
        const res = await call(ctx, bob, id);
        expect(res.status, `project ${id}`).toBe(404);
      }

      expect(ctx.fire.calls).toHaveLength(0);
      expect(await readSchedule(ctx)).toMatchObject({ frequency: "off" });
      expect((await rows(ctx.db)).length).toBe(before);
    },
  );

  it("given an archived project, when its schedule is saved, then 409 project_archived, nothing is saved and one refused schedule_routine entry holds the reason", async () => {
    const ctx = await setup();
    const first = await scheduled(ctx);
    await archiveProject(ctx.db, ctx.projectId);

    const res = await putSchedule(ctx.app, ctx.alice.cookie, ctx.projectId, {
      frequency: "off",
      timeZone: "Europe/Paris",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await readSchedule(ctx)).toEqual(first);
    const found = await entries(ctx.db, "schedule_routine");
    expect(found.map((e) => e.result)).toEqual(["ok", "refused"]);
    expect(found[1]).toMatchObject({
      detail: { reason: "project_archived" },
      project_id: ctx.projectId,
    });
  });

  it("given an archived project, when its schedule is read, then 200: reading stays possible", async () => {
    const ctx = await setup();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await getSchedule(ctx.app, ctx.alice.cookie, ctx.projectId);

    expect(res.status).toBe(200);
  });
});

describe("the tick, runDueRoutines", () => {
  it("given a due project, when the tick runs, then it POSTs to the address of the user with the token, the two version headers and the body { text: 'project_id: <id>' }", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(TICK);

    expect(ctx.fire.calls).toHaveLength(1);
    const [call] = ctx.fire.calls;
    expect(call?.url).toBe(FIRE_URL);
    expect(call?.init.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call?.headers.get("anthropic-beta")).toBe(
      "experimental-cc-routine-2026-04-01",
    );
    expect(call?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.body).toEqual({ text: `project_id: ${ctx.projectId}` });
    expect(
      call?.init.signal,
      "the call can be aborted after 10 s",
    ).toBeInstanceOf(AbortSignal);
  });

  it("given a due project, when the tick runs, then nextRunAt moves to the following occurrence and the last run is recorded with the session url of the answer", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(TICK);

    const after = await readSchedule(ctx);
    expect(Date.parse(after.nextRunAt as string)).toBe(
      Date.parse("2026-10-31T06:00:00Z"),
    );
    expect(after.lastRun).toMatchObject({
      result: "ok",
      sessionUrl: FIRE_ANSWER.claude_code_session_url,
    });
    expect(Date.parse(after.lastRun?.at as string)).toBe(TICK.getTime());
  });

  it("given a project due exactly at its next run, when the tick runs a second before and then at that second, then only the second fires", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(new Date("2026-10-30T05:59:59Z"));
    expect(ctx.fire.calls).toHaveLength(0);
    await ctx.tick(new Date("2026-10-30T06:00:00Z"));

    expect(ctx.fire.calls).toHaveLength(1);
  });

  it("given a project not due yet, when the tick runs, then nothing is fired, nothing is written and the schedule is untouched", async () => {
    const ctx = await setup();
    await due(ctx);
    const before = await readSchedule(ctx);

    await ctx.tick(new Date("2026-10-30T05:00:00Z"));

    expect(ctx.fire.calls).toHaveLength(0);
    expect(await fired(ctx.db)).toHaveLength(0);
    expect(await readSchedule(ctx)).toEqual(before);
  });

  it("given a project whose tick was missed for several days, when the tick runs, then it fires once and the next run is the first occurrence after now", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(new Date("2026-11-02T10:00:00Z"));

    expect(ctx.fire.calls).toHaveLength(1);
    expect(Date.parse((await readSchedule(ctx)).nextRunAt as string)).toBe(
      Date.parse("2026-11-03T06:00:00Z"),
    );
  });

  it("given a fired project, when the tick runs again right away, then it does not fire a second time", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(TICK);
    await ctx.tick(TICK);

    expect(ctx.fire.calls).toHaveLength(1);
    expect(await fired(ctx.db)).toHaveLength(1);
  });

  it("given two ticks at the same time, when both find the project due, then exactly one fire and one history entry", async () => {
    const ctx = await setup(answerOk, 30);
    await due(ctx);

    await Promise.all([ctx.tick(TICK), ctx.tick(TICK)]);

    expect(ctx.fire.calls).toHaveLength(1);
    expect(await fired(ctx.db)).toHaveLength(1);
  });

  it("given two due projects and two ticks at the same time, when they run, then each project is fired exactly once", async () => {
    const ctx = await setup(answerOk, 30);
    const second = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    await due(ctx);
    await seedTicket(ctx.db, second, "Autre idée");
    await scheduled(ctx, DAILY, second);

    await Promise.all([ctx.tick(TICK), ctx.tick(TICK)]);

    const texts = ctx.fire.calls
      .map((c) => (c.body as { text: string }).text)
      .sort();
    expect(texts).toEqual(
      [`project_id: ${ctx.projectId}`, `project_id: ${second}`].sort(),
    );
  });

  describe("when there is nothing to write", () => {
    async function dueWith(ctx: Ctx, seed: () => Promise<void>) {
      await connected(ctx);
      await seed();
      await scheduled(ctx);
    }
    const expectSkipped = async (ctx: Ctx) => {
      await ctx.tick(TICK);
      expect(ctx.fire.calls).toHaveLength(0);
      expect(await fired(ctx.db)).toHaveLength(0);
      const after = await readSchedule(ctx);
      expect(Date.parse(after.nextRunAt as string)).toBe(
        Date.parse("2026-10-31T06:00:00Z"),
      );
      expect(after.lastRun).toBeNull();
    };

    it("given a project without any ticket, when the tick runs, then no fire, no entry, and nextRunAt still advances", async () => {
      const ctx = await setup();
      await dueWith(ctx, async () => {});

      await expectSkipped(ctx);
    });

    it("given only tickets whose writing is closed and no story to rewrite, when the tick runs, then no fire, no entry, and nextRunAt still advances", async () => {
      const ctx = await setup();
      await dueWith(ctx, async () => {
        const ticketId = await seedTicket(ctx.db, ctx.projectId, "Déjà écrit");
        await seedStory(ctx.db, ticketId, { status: "ready" });
        await closeWriting(ctx.db, ticketId);
      });

      await expectSkipped(ctx);
    });

    it("given only an abandoned ticket with an open writing, when the tick runs, then no fire, no entry, and nextRunAt still advances", async () => {
      const ctx = await setup();
      await dueWith(ctx, async () => {
        await seedTicket(ctx.db, ctx.projectId, "Abandonné", "", new Date());
      });

      await expectSkipped(ctx);
    });

    it("given a ticket with an open writing, when the tick runs, then it fires", async () => {
      const ctx = await setup();
      await dueWith(ctx, async () => {
        await seedTicket(ctx.db, ctx.projectId, "À écrire");
      });

      await ctx.tick(TICK);

      expect(ctx.fire.calls).toHaveLength(1);
    });

    it("given a story to rewrite on a ticket whose writing is closed, when the tick runs, then it fires", async () => {
      const ctx = await setup();
      await dueWith(ctx, async () => {
        const ticketId = await seedTicket(ctx.db, ctx.projectId, "À corriger");
        await seedStory(ctx.db, ticketId, {
          status: "to_rewrite",
          rewriteComment: "plus court",
        });
        await closeWriting(ctx.db, ticketId);
      });

      await ctx.tick(TICK);

      expect(ctx.fire.calls).toHaveLength(1);
    });
  });

  it("given an archived project, when the tick runs, then it is never fired", async () => {
    const ctx = await setup();
    await due(ctx);
    await archiveProject(ctx.db, ctx.projectId);

    await ctx.tick(TICK);
    await ctx.tick(new Date("2026-11-30T06:00:00Z"));

    expect(ctx.fire.calls).toHaveLength(0);
    expect(await fired(ctx.db)).toHaveLength(0);
  });

  it("given no routine connected anymore, when the tick runs, then nothing is fired", async () => {
    const ctx = await setup();
    await due(ctx);
    expect(
      (await send(ctx.app, ctx.alice.cookie, "DELETE", "/api/me/routine"))
        .status,
    ).toBe(204);

    await ctx.tick(TICK);

    expect(ctx.fire.calls).toHaveLength(0);
    expect(await fired(ctx.db)).toHaveLength(0);
  });

  it.each([
    ["on_demand", { frequency: "on_demand", timeZone: "Europe/Paris" }],
    ["off", { frequency: "off", timeZone: "Europe/Paris" }],
  ])(
    "given the frequency %s with a ticket to write and a connected routine, when the tick runs on any day, then it is never fired",
    async (_name, body) => {
      const ctx = await setup();
      await connected(ctx);
      await seedTicket(ctx.db, ctx.projectId, "À écrire");
      await scheduled(ctx, body);

      await ctx.tick(TICK);
      await ctx.tick(new Date("2027-03-01T06:00:00Z"));

      expect(ctx.fire.calls).toHaveLength(0);
    },
  );

  it("given a project switched from daily to off, when the tick runs after the old next run, then it is not fired", async () => {
    const ctx = await setup();
    await due(ctx);
    await scheduled(ctx, { frequency: "off", timeZone: "Europe/Paris" });

    await ctx.tick(TICK);

    expect(ctx.fire.calls).toHaveLength(0);
  });

  it("given two users with due projects, when the tick runs, then each project is fired with its owner's address and token", async () => {
    const ctx = await setup();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const bobUrl =
      "https://api.anthropic.com/v1/claude_code/routines/trig_BOB/fire";
    const bobProject = await seedProject(ctx.db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/app",
    });
    await due(ctx);
    await connected(
      ctx,
      bob.cookie,
      connectBody({ fireUrl: bobUrl, token: "bob-token" }),
    );
    await seedTicket(ctx.db, bobProject, "Idée de Bob");
    await scheduled(ctx, DAILY, bobProject, bob.cookie);

    await ctx.tick(TICK);

    const byUrl = new Map(ctx.fire.calls.map((c) => [c.url, c]));
    expect(ctx.fire.calls).toHaveLength(2);
    expect(byUrl.get(FIRE_URL)?.headers.get("authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(byUrl.get(FIRE_URL)?.body).toEqual({
      text: `project_id: ${ctx.projectId}`,
    });
    expect(byUrl.get(bobUrl)?.headers.get("authorization")).toBe(
      "Bearer bob-token",
    );
    expect(byUrl.get(bobUrl)?.body).toEqual({
      text: `project_id: ${bobProject}`,
    });
  });

  it("given the tick has just run, when the history is read, then no token and no address appear anywhere", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(TICK);

    expectNoSecret(await allHistory(ctx.db));
  });
});

describe("the button, POST /api/projects/:id/routine/run", () => {
  const frequencies = [
    ["off (the default)", undefined],
    ["on_demand", { frequency: "on_demand", timeZone: "Europe/Paris" }],
    ["daily", DAILY],
    [
      "weekly",
      { frequency: "weekly", weekday: 1, hour: 9, timeZone: "Europe/Paris" },
    ],
  ] as const;

  it.each(frequencies)(
    "given a connected routine and the frequency %s, when the button is used, then it fires now and answers 200 { sessionUrl }, even with nothing to write",
    async (_name, body) => {
      const ctx = await setup();
      await connected(ctx);
      if (body) await scheduled(ctx, body);

      const res = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        sessionUrl: FIRE_ANSWER.claude_code_session_url,
      });
      expect(ctx.fire.calls).toHaveLength(1);
      expect(ctx.fire.calls[0]?.url).toBe(FIRE_URL);
      expect(ctx.fire.calls[0]?.headers.get("authorization")).toBe(
        `Bearer ${TOKEN}`,
      );
      expect(ctx.fire.calls[0]?.headers.get("anthropic-beta")).toBe(
        "experimental-cc-routine-2026-04-01",
      );
      expect(ctx.fire.calls[0]?.headers.get("anthropic-version")).toBe(
        "2023-06-01",
      );
      expect(ctx.fire.calls[0]?.body).toEqual({
        text: `project_id: ${ctx.projectId}`,
      });
    },
  );

  it("given the button was used, when the schedule is read, then the last run is the one of the button (clock of the app) and nextRunAt did not move", async () => {
    const ctx = await setup();
    await connected(ctx);
    const saved = await scheduled(ctx);
    ctx.clock.now = Date.parse("2026-10-29T12:00:00Z");

    await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

    const after = await readSchedule(ctx);
    expect(after.nextRunAt).toBe(saved.nextRunAt);
    expect(after.lastRun).toMatchObject({
      result: "ok",
      sessionUrl: FIRE_ANSWER.claude_code_session_url,
    });
    expect(Date.parse(after.lastRun?.at as string)).toBe(ctx.clock.now);
  });

  it("given no routine connected, when the button is used, then 409 routine_not_connected and nothing is fired or written", async () => {
    const ctx = await setup();
    const before = (await rows(ctx.db)).length;

    const res = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "routine_not_connected" });
    expect(ctx.fire.calls).toHaveLength(0);
    expect(await fired(ctx.db)).toHaveLength(0);
    expect((await rows(ctx.db)).length).toBe(before);
  });

  it("given an archived project, when the button is used, then 409 project_archived and nothing is fired", async () => {
    const ctx = await setup();
    await connected(ctx);
    await archiveProject(ctx.db, ctx.projectId);

    const res = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(ctx.fire.calls).toHaveLength(0);
  });

  it("given a fire by the button, when the history is read, then one fire_write_us entry is ok, human, ui, with args { projectId, sessionId } and the project id column", async () => {
    const ctx = await setup();
    await connected(ctx);

    await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

    const found = await fired(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      project_id: ctx.projectId,
    });
    expect(found[0]?.args).toEqual({
      projectId: ctx.projectId,
      sessionId: FIRE_ANSWER.claude_code_session_id,
    });
    expectNoSecret(await allHistory(ctx.db));
  });

  it("given a fire by the tick, when the history is read, then one fire_write_us entry is ok, system, system, with args { projectId, sessionId } and the project id column", async () => {
    const ctx = await setup();
    await due(ctx);

    await ctx.tick(TICK);

    const found = await fired(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      actor: "system",
      origin: "system",
      result: "ok",
      project_id: ctx.projectId,
    });
    expect(found[0]?.args).toEqual({
      projectId: ctx.projectId,
      sessionId: FIRE_ANSWER.claude_code_session_id,
    });
  });
});

describe("errors of /fire", () => {
  it.each([401, 403])(
    "given /fire answers %i to the tick, when it runs, then the routine needs reconnecting, an error entry is written, later ticks fire nothing and the button answers 409 routine_needs_reconnect",
    async (status) => {
      const ctx = await setup(answerStatus(status));
      await due(ctx);

      await ctx.tick(TICK);

      expect(ctx.fire.calls).toHaveLength(1);
      expect(await readRoutine(ctx)).toMatchObject({
        connected: true,
        needsReconnect: true,
      });
      const found = await fired(ctx.db);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        actor: "system",
        origin: "system",
        result: "error",
        project_id: ctx.projectId,
        detail: { reason: "error" },
      });
      await ctx.tick(new Date("2026-10-31T06:00:30Z"));
      await ctx.tick(new Date("2026-11-07T06:00:30Z"));
      expect(ctx.fire.calls).toHaveLength(1);
      const button = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);
      expect(button.status).toBe(409);
      expect(await button.json()).toEqual({ error: "routine_needs_reconnect" });
      expect(ctx.fire.calls).toHaveLength(1);
    },
  );

  it("given /fire answers 401 to the button, when it is used, then 409 routine_needs_reconnect right away, the routine is marked and the next click does not call /fire", async () => {
    const ctx = await setup(answerStatus(401));
    await connected(ctx);

    const first = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);
    const second = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ error: "routine_needs_reconnect" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "routine_needs_reconnect" });
    expect(ctx.fire.calls).toHaveLength(1);
    expect((await readRoutine(ctx)).needsReconnect).toBe(true);
    const found = await fired(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      result: "error",
      detail: { reason: "error" },
    });
  });

  it("given two due projects of a user whose token is refused, when the tick runs, then it stops after the first call, and another user is not affected", async () => {
    const ctx = await setup((call) =>
      call.url === FIRE_URL
        ? Response.json({}, { status: 401 })
        : Response.json(FIRE_ANSWER),
    );
    const second = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const bobUrl =
      "https://api.anthropic.com/v1/claude_code/routines/trig_BOB/fire";
    const bobProject = await seedProject(ctx.db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/app",
    });
    await due(ctx);
    await seedTicket(ctx.db, second, "Autre");
    await scheduled(ctx, DAILY, second);
    await connected(
      ctx,
      bob.cookie,
      connectBody({ fireUrl: bobUrl, token: "bob-token" }),
    );
    await seedTicket(ctx.db, bobProject, "Idée de Bob");
    await scheduled(ctx, DAILY, bobProject, bob.cookie);

    await ctx.tick(TICK);

    expect(ctx.fire.calls.filter((c) => c.url === FIRE_URL)).toHaveLength(1);
    expect(ctx.fire.calls.filter((c) => c.url === bobUrl)).toHaveLength(1);
    expect((await readRoutine(ctx, bob.cookie)).needsReconnect).toBe(false);
  });

  it("given /fire answers 500 to the tick, when it runs, then an error entry is written with { reason: 'error' }, needsReconnect stays unset, the last run is an error and the next occurrence tries again", async () => {
    const ctx = await setup((_call, n) =>
      n === 1
        ? Response.json({ error: "boom" }, { status: 500 })
        : Response.json(FIRE_ANSWER),
    );
    await due(ctx);

    await ctx.tick(TICK);

    expect((await readRoutine(ctx)).needsReconnect).toBe(false);
    const found = await fired(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      result: "error",
      project_id: ctx.projectId,
      detail: { reason: "error" },
    });
    const after = await readSchedule(ctx);
    expect(after.lastRun).toMatchObject({ result: "error", sessionUrl: null });
    expect(Date.parse(after.nextRunAt as string)).toBe(
      Date.parse("2026-10-31T06:00:00Z"),
    );

    await ctx.tick(new Date("2026-10-31T06:00:30Z"));

    expect(ctx.fire.calls).toHaveLength(2);
    expect((await fired(ctx.db)).map((e) => e.result)).toEqual(["error", "ok"]);
  });

  it.each([
    [
      "a timeout",
      () => new DOMException("The operation timed out.", "TimeoutError"),
    ],
    [
      "an abort",
      () => new DOMException("This operation was aborted", "AbortError"),
    ],
    ["a network failure", () => new TypeError("fetch failed")],
  ])(
    "given /fire fails with %s, when the tick runs, then an error entry is written without the message of the error, needsReconnect stays unset and the tick does not throw",
    async (_name, failure) => {
      const ctx = await setup(() => {
        throw failure();
      });
      await due(ctx);

      await expect(ctx.tick(TICK)).resolves.not.toThrow();

      expect(ctx.fire.calls).toHaveLength(1);
      expect((await readRoutine(ctx)).needsReconnect).toBe(false);
      const found = await fired(ctx.db);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        result: "error",
        detail: { reason: "error" },
      });
      expect(JSON.stringify(found[0])).not.toMatch(
        /timed out|aborted|fetch failed/,
      );
    },
  );

  it("given /fire fails with a message that holds the token, when the tick runs, then the history never holds it", async () => {
    const ctx = await setup(() => {
      throw new Error(`leak ${TOKEN} ${FIRE_URL}`);
    });
    await due(ctx);

    await ctx.tick(TICK);

    expect(await fired(ctx.db)).toHaveLength(1);
    expectNoSecret(await allHistory(ctx.db));
  });

  it("given /fire answers 500 to the button, when it is used, then 502 fire_failed, an error entry (human, ui), needsReconnect unset and the next click calls /fire again", async () => {
    const ctx = await setup((_call, n) =>
      n === 1 ? Response.json({}, { status: 500 }) : Response.json(FIRE_ANSWER),
    );
    await connected(ctx);

    const first = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);
    const second = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);

    expect(first.status).toBe(502);
    expect(await first.json()).toEqual({ error: "fire_failed" });
    expect(second.status).toBe(200);
    expect(ctx.fire.calls).toHaveLength(2);
    expect((await readRoutine(ctx)).needsReconnect).toBe(false);
    const found = await fired(ctx.db);
    expect(found.map((e) => e.result)).toEqual(["error", "ok"]);
    expect(found[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      detail: { reason: "error" },
      project_id: ctx.projectId,
    });
  });

  it("given a routine that needs reconnecting, when the token is saved again, then needsReconnect is cleared and the button and the tick fire again", async () => {
    const ctx = await setup((_call, n) =>
      n === 1 ? Response.json({}, { status: 401 }) : Response.json(FIRE_ANSWER),
    );
    await due(ctx);
    await ctx.tick(TICK);
    expect((await readRoutine(ctx)).needsReconnect).toBe(true);

    await connected(
      ctx,
      ctx.alice.cookie,
      connectBody({ token: "fresh-token" }),
    );

    expect(await readRoutine(ctx)).toMatchObject({
      connected: true,
      needsReconnect: false,
    });
    const res = await runNow(ctx.app, ctx.alice.cookie, ctx.projectId);
    expect(res.status).toBe(200);
    expect(ctx.fire.calls).toHaveLength(2);
    expect(ctx.fire.calls[1]?.headers.get("authorization")).toBe(
      "Bearer fresh-token",
    );
    await ctx.tick(new Date("2026-10-31T06:00:30Z"));
    expect(ctx.fire.calls).toHaveLength(3);
  });
});

describe("scheduleRoutines", () => {
  /** Polls with the real setTimeout: only the interval is faked. */
  async function until(check: () => boolean) {
    for (let i = 0; i < 150; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(check()).toBe(true);
  }

  it("given a project that is due by the real clock, when 60 seconds pass, then the tick has fired it, and the timer is unref'd so it never keeps the process alive", async () => {
    const ctx = await setup();
    // The routes run two days in the past, so the next run is already behind the real time.
    ctx.clock.now = Date.now() - 2 * 86_400_000;
    await due(ctx);
    const { scheduleRoutines } = await import("./routines.ts");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const timer = scheduleRoutines(ctx.db, {
        encryptionKey: TEST_KEY,
        fireRoutine: ctx.fire.fn,
      });

      expect(timer.hasRef()).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      await until(() => ctx.fire.calls.length >= 1);
      clearInterval(timer);

      expect(ctx.fire.calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
