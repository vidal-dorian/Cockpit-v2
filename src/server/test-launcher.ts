import type { SQL } from "drizzle-orm";
import { expect } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { runDueRoutines } from "./routines.ts";
import { send } from "./test-decisions.ts";
import { stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";
import {
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
} from "./test-mcp.ts";

// Shared by the tests of slice 14.1 (decision 054): Alice with a project and a ready story, a fake clock and a fake `/fire`.

export const NOW = new Date("2026-11-08T10:00:00Z");
export const FIRE_URL =
  "https://api.anthropic.com/v1/claude_code/routines/trig_01LAUNCHER/fire";
export const TOKEN = "sk-ant-oat01-LAUNCHER-TOKEN-4c1d";
export const FIRE_ANSWER = {
  type: "routine_fire",
  claude_code_session_id: "session_01ABCDEFGHIJ",
  claude_code_session_url: "https://claude.ai/code/session_01ABCDEFGHIJ",
};
export const BRANCH = "us/1-x";

export type FireCall = { url: string; init: RequestInit; body: unknown };
export type Handler = (call: FireCall) => Response | Promise<Response>;
export const answerOk: Handler = () => Response.json(FIRE_ANSWER);
export const answerStatus =
  (status: number): Handler =>
  () =>
    Response.json({ error: "stub" }, { status });

/** Alice with a project and a ready story, a fake clock, a fake `/fire`; the launcher is not connected yet. */
export async function setup(handler: Handler = answerOk) {
  stubGitHub({ account: 1000 });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const clock = { now: NOW.getTime() };
  const calls: FireCall[] = [];
  const fireRoutine = async (url: string, init: RequestInit = {}) => {
    let body: unknown = init.body;
    try {
      body = JSON.parse(String(init.body));
    } catch {}
    const call = { url, init, body };
    calls.push(call);
    return handler(call);
  };
  const app = createApp(db, "1.2.3", {
    ...testAppOptions,
    fireRoutine,
    now: () => clock.now,
  });
  const alice = await userWithToken(app, db, 1000);
  const projectId = await seedProject(db, alice.id, {
    githubRepoId: 1,
    fullName: "user1000/app",
  });
  const ticketId = await seedTicket(db, projectId, "Le ticket");
  const storyId = await seedStory(db, ticketId, { status: "ready" });
  return {
    db,
    app,
    calls,
    clock,
    fireRoutine,
    alice,
    projectId,
    ticketId,
    storyId,
  };
}
export type Ctx = Awaited<ReturnType<typeof setup>>;

export const connectLauncher = (ctx: Ctx, body: unknown = connectBody()) =>
  send(ctx.app, ctx.alice.cookie, "PUT", "/api/me/launcher", body);
export const connectBody = (over: Record<string, unknown> = {}) => ({
  fireUrl: FIRE_URL,
  token: TOKEN,
  ...over,
});
export const tick = (ctx: Ctx, projectId = ctx.projectId, inLauncher = true) =>
  send(
    ctx.app,
    ctx.alice.cookie,
    "PUT",
    `/api/projects/${projectId}/launcher`,
    { inLauncher },
  );
export const launch = (
  ctx: Ctx,
  body: unknown = { branch: BRANCH, comment: "Fais attention" },
  storyId = ctx.storyId,
  cookie = ctx.alice.cookie,
) => send(ctx.app, cookie, "POST", `/api/stories/${storyId}/launch`, body);
export const readLauncher = async (ctx: Ctx) =>
  (await (
    await send(ctx.app, ctx.alice.cookie, "GET", "/api/me/launcher")
  ).json()) as {
    connected: boolean;
    needsReconnect: boolean;
    prompt: string;
    projectIds: number[];
    missingProjectIds: number[];
  };

/** Connected launcher and ticked project, each step checked so a test never goes on from a missing feature. */
export async function ready(handler?: Handler) {
  const ctx = await setup(handler);
  expect((await connectLauncher(ctx)).status, "connecting").toBe(200);
  expect((await tick(ctx)).status, "ticking the project").toBe(200);
  return ctx;
}

// Slice 14.2 (decision 056): routines. A daily routine at 12:00 UTC is due 2 h after NOW (a Sunday).
export const DUE = new Date("2026-11-08T12:00:30Z");
export const routineBody = (ctx: Ctx, over: Record<string, unknown> = {}) => ({
  name: "Nettoyage",
  instruction: "Ranger les imports",
  agents: ["bug-hunter"],
  projectIds: [ctx.projectId],
  frequency: "daily",
  hour: 12,
  timeZone: "UTC",
  ...over,
});
export const createRoutine = (ctx: Ctx, over: Record<string, unknown> = {}) =>
  send(
    ctx.app,
    ctx.alice.cookie,
    "POST",
    "/api/routines",
    routineBody(ctx, over),
  );
export const routineCall = (
  ctx: Ctx,
  method: string,
  id: number,
  suffix = "",
  cookie = ctx.alice.cookie,
) => send(ctx.app, cookie, method, `/api/routines/${id}${suffix}`);
/** A routine created through the route, each step checked. */
export async function routineOf(ctx: Ctx, over: Record<string, unknown> = {}) {
  const res = await createRoutine(ctx, over);
  expect(res.status, "creating the routine").toBe(201);
  return ((await res.json()) as { id: number }).id;
}
/** One pass of the minute (decision 022 E, extended by 056 B) at `at`. */
export const pass = (ctx: Ctx, at: Date) =>
  runDueRoutines(
    ctx.db,
    { encryptionKey: TEST_KEY, fireRoutine: ctx.fireRoutine },
    at,
  );
export const sqlRows = async <T>(ctx: Ctx, query: SQL) =>
  ((await ctx.db.execute(query)) as unknown as { rows: T[] }).rows;
