import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerStatus,
  type Ctx,
  createRoutine,
  DUE,
  FIRE_ANSWER,
  pass,
  readLauncher,
  ready,
  routineCall,
  routineOf,
  setup,
  sqlRows,
  tick,
} from "./test-launcher.ts";
import { rows, seedProject, userWithToken } from "./test-mcp.ts";

// Slice 14.2 (decision 056 A, B, G, H): the routines of a user, the pass that fires them, « Lancer maintenant ».
//
// Pinned where the decision leaves room:
// - The pass is the existing `runDueRoutines(db, { encryptionKey, fireRoutine }, now)` (022 E), extended to the routines.
// - Body of POST and PUT /api/routines: { name, instruction, agents, projectIds, frequency: on_demand | daily | weekly, hour?,
//   weekday? (ISO), timeZone }. A routine answers those fields plus { id, nextRunAt (ISO or null), pausedAt }; POST answers 201,
//   GET /api/routines answers { routines: [...] }, DELETE 204, pause and resume 200.
// - A project the user is not a member of is 404 (not_found), an unticked one 409 project_not_in_launcher; a bad body is 400.
// - POST /api/routines/:id/run answers 201 { launchId, sessionUrl } like the launch of a story, and journals fire_routine human / ui.
// - Tables `routines(id, next_run_at, paused_at, ...)` and `cloud_launches(routine_id, finished_at, outcome)`.
// - A pass that gives up a launch without news after 2 h writes outcome 'failed' on it.

afterEach(() => {
  vi.unstubAllGlobals();
});

const entries = (ctx: Ctx, action: string) =>
  rows(ctx.db, sql`action = ${action}`);
const routineRow = async (ctx: Ctx, id: number) =>
  (
    await sqlRows<{ next_run_at: Date | null; paused_at: Date | null }>(
      ctx,
      sql`select next_run_at, paused_at from routines where id = ${id}`,
    )
  )[0];
const launches = (ctx: Ctx) =>
  sqlRows<{
    routine_id: number | null;
    outcome: string | null;
    finished_at: Date | null;
  }>(
    ctx,
    sql`select routine_id, outcome, finished_at from cloud_launches where routine_id is not null order by id`,
  );
const later = (at: Date, minutes: number) =>
  new Date(at.getTime() + minutes * 60_000);

describe("criterion 1: the routes of the routines", () => {
  it("given a ticked project, when the user creates a daily routine, then it is saved with its next run, and the entry save_routine has args { routineId } and no instruction", async () => {
    const ctx = await ready();

    const res = await createRoutine(ctx);

    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      name: "Nettoyage",
      instruction: "Ranger les imports",
      agents: ["bug-hunter"],
      projectIds: [ctx.projectId],
      frequency: "daily",
      hour: 12,
      timeZone: "UTC",
      nextRunAt: "2026-11-08T12:00:00.000Z",
      pausedAt: null,
    });
    const found = await entries(ctx, "save_routine");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      args: { routineId: created.id },
      result: "ok",
    });
    expect(JSON.stringify(found)).not.toContain("Ranger les imports");
  });

  it("given a routine, when the user updates it to on demand, then the fields change and there is no next run", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);

    const res = await ctx.app.request(`/api/routines/${id}`, {
      method: "PUT",
      headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Autre",
        instruction: "Autre chose",
        agents: [],
        projectIds: [ctx.projectId],
        frequency: "on_demand",
        timeZone: "UTC",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id,
      name: "Autre",
      agents: [],
      frequency: "on_demand",
      nextRunAt: null,
    });
    expect((await routineRow(ctx, id))?.next_run_at).toBeNull();
    expect(await entries(ctx, "save_routine")).toHaveLength(2);
  });

  it("given bodies out of bounds, when the user creates a routine, then each is refused 400 and nothing is saved", async () => {
    const ctx = await ready();
    const bad = [
      { name: "" },
      { name: "x".repeat(101) },
      { instruction: "" },
      { instruction: "x".repeat(10_001) },
      { agents: Array.from({ length: 11 }, (_, i) => `agent-${i}`) },
      { agents: ["Not An Agent!"] },
      { projectIds: [] },
      { frequency: "hourly" },
    ];

    for (const over of bad)
      expect(
        (await createRoutine(ctx, over)).status,
        JSON.stringify(over),
      ).toBe(400);

    const list = await ctx.app.request("/api/routines", {
      headers: { cookie: ctx.alice.cookie },
    });
    expect(await list.json()).toEqual({ routines: [] });
  });

  it("given a project not ticked in the launcher, when a routine names it, then it is refused 409 project_not_in_launcher; a project of someone else is 404", async () => {
    const ctx = await setup();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const others = await seedProject(ctx.db, bob.id, {
      githubRepoId: 2,
      fullName: "user2000/app",
    });

    const unticked = await createRoutine(ctx);
    const foreign = await createRoutine(ctx, { projectIds: [others] });

    expect(unticked.status).toBe(409);
    expect(await unticked.json()).toEqual({ error: "project_not_in_launcher" });
    expect(foreign.status).toBe(404);
  });

  it("given routines of two users, when each lists, then it sees only its own; another user's routine is 404 on PUT, DELETE, pause, resume and run", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const list = await ctx.app.request("/api/routines", {
      headers: { cookie: bob.cookie },
    });
    expect(await list.json()).toEqual({ routines: [] });
    const mine = await ctx.app.request("/api/routines", {
      headers: { cookie: ctx.alice.cookie },
    });
    expect(
      ((await mine.json()) as { routines: { id: number }[] }).routines.map(
        (r) => r.id,
      ),
    ).toEqual([id]);
    for (const [method, suffix] of [
      ["PUT", ""],
      ["DELETE", ""],
      ["POST", "/pause"],
      ["POST", "/resume"],
      ["POST", "/run"],
    ] as const)
      expect(
        (await routineCall(ctx, method, id, suffix, bob.cookie)).status,
        `${method} ${suffix}`,
      ).toBe(404);
    expect(await routineRow(ctx, id)).toBeDefined();
  });

  it("given a routine, when the user pauses then resumes it, then paused_at is set then cleared, and each leaves its entry with args { routineId }", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);

    expect((await routineCall(ctx, "POST", id, "/pause")).status).toBe(200);
    expect((await routineRow(ctx, id))?.paused_at).not.toBeNull();
    expect((await routineCall(ctx, "POST", id, "/resume")).status).toBe(200);
    expect((await routineRow(ctx, id))?.paused_at).toBeNull();

    for (const action of ["pause_routine", "resume_routine"])
      expect((await entries(ctx, action)).map((e) => e.args)).toEqual([
        { routineId: id },
      ]);
  });

  it("given a routine, when the user deletes it, then it is gone and the entry delete_routine has args { routineId }", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);

    expect((await routineCall(ctx, "DELETE", id)).status).toBe(204);

    expect(await routineRow(ctx, id)).toBeUndefined();
    expect((await entries(ctx, "delete_routine")).map((e) => e.args)).toEqual([
      { routineId: id },
    ]);
  });
});

describe("criterion 2: the pass of the minute", () => {
  it("given a due routine, when the pass runs, then /fire is called once with launch_id, a launch with routine_id exists, the next run moves on and fire_routine is a system entry", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);

    await pass(ctx, DUE);
    await pass(ctx, later(DUE, 1));

    expect(ctx.calls).toHaveLength(1);
    const [launch] = await launches(ctx);
    expect(launch?.routine_id).toBe(id);
    const launchId = (
      await sqlRows<{ id: number }>(ctx, sql`select id from cloud_launches`)
    )[0]?.id;
    expect(ctx.calls[0]?.body).toEqual({ text: `launch_id: ${launchId}` });
    expect(
      new Date(String((await routineRow(ctx, id))?.next_run_at)).toISOString(),
    ).toBe("2026-11-09T12:00:00.000Z");
    const [entry] = await entries(ctx, "fire_routine");
    expect(entry).toMatchObject({
      actor: "system",
      user_id: ctx.alice.id,
      args: {
        routineId: id,
        launchId,
        sessionId: FIRE_ANSWER.claude_code_session_id,
      },
      result: "ok",
    });
  });

  it("given a paused routine and an on-demand one, when the pass runs, then nothing is fired", async () => {
    const ctx = await ready();
    const paused = await routineOf(ctx);
    await routineCall(ctx, "POST", paused, "/pause");
    await routineOf(ctx, { frequency: "on_demand", hour: undefined });

    await pass(ctx, DUE);

    expect(ctx.calls).toHaveLength(0);
  });

  it("given two due routines of one user, when the first is running, then the second waits; two hours without finish_launch, the first counts failed and the second fires", async () => {
    const ctx = await ready();
    const first = await routineOf(ctx);
    const second = await routineOf(ctx, { name: "Deuxième" });

    await pass(ctx, DUE);
    await pass(ctx, later(DUE, 60));
    expect(ctx.calls).toHaveLength(1);
    await pass(ctx, later(DUE, 121));

    expect(ctx.calls).toHaveLength(2);
    expect((await launches(ctx)).map((l) => [l.routine_id, l.outcome])).toEqual(
      [
        [first, "failed"],
        [second, null],
      ],
    );
  });

  it("given no launcher, when a routine is due, then nothing is fired", async () => {
    const ctx = await ready();
    await routineOf(ctx);
    await ctx.app.request("/api/me/launcher", {
      method: "DELETE",
      headers: { cookie: ctx.alice.cookie },
    });

    await pass(ctx, DUE);

    expect(ctx.calls).toHaveLength(0);
    expect(await launches(ctx)).toEqual([]);
  });

  it("given /fire answers 401, when a routine is fired, then the launcher needs to be reconnected and the next due routine is not fired", async () => {
    const ctx = await ready(answerStatus(401));
    await routineOf(ctx);

    await pass(ctx, DUE);
    await pass(ctx, later(DUE, 24 * 60));

    expect((await readLauncher(ctx)).needsReconnect).toBe(true);
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("criterion 3: « Lancer maintenant »", () => {
  it("given a routine, when the user runs it, then it fires, answers 201 and the entry fire_routine is human / ui", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);

    const res = await routineCall(ctx, "POST", id, "/run");

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      sessionUrl: FIRE_ANSWER.claude_code_session_url,
    });
    expect(ctx.calls).toHaveLength(1);
    const [entry] = await entries(ctx, "fire_routine");
    expect(entry).toMatchObject({ actor: "human", origin: "ui", result: "ok" });
    expect(entry?.args).toMatchObject({ routineId: id });
  });

  it("given no launcher, when the user runs a routine, then it is refused 409 launcher_not_connected", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);
    await ctx.app.request("/api/me/launcher", {
      method: "DELETE",
      headers: { cookie: ctx.alice.cookie },
    });

    const res = await routineCall(ctx, "POST", id, "/run");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "launcher_not_connected" });
  });

  it("given a launcher to reconnect, when the user runs a routine, then it is refused 409 launcher_needs_reconnect", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);
    await ctx.db.execute(
      sql`update cloud_launchers set needs_reconnect = true`,
    );

    const res = await routineCall(ctx, "POST", id, "/run");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "launcher_needs_reconnect" });
  });

  it("given a passage not finished, when the user runs the routine again, then it is refused 409 routine_running", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);
    await routineCall(ctx, "POST", id, "/run");

    const res = await routineCall(ctx, "POST", id, "/run");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "routine_running" });
    expect(ctx.calls).toHaveLength(1);
  });

  it("given a project unticked since, when the user runs the routine, then it is refused 409 project_not_in_launcher", async () => {
    const ctx = await ready();
    const id = await routineOf(ctx);
    await tick(ctx, ctx.projectId, false);

    const res = await routineCall(ctx, "POST", id, "/run");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_not_in_launcher" });
    expect(ctx.calls).toHaveLength(0);
  });

  it("given /fire fails, when the user runs a routine, then the answer is 502 fire_failed", async () => {
    const ctx = await ready(answerStatus(500));
    const id = await routineOf(ctx);

    const res = await routineCall(ctx, "POST", id, "/run");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fire_failed" });
  });
});
