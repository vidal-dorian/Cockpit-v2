import { type SQL, sql } from "drizzle-orm";
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
  callTool,
  dataOf,
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
  const fetchMock = stubGitHub({ account: 1000 });
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
    fetchMock,
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

// Slice 14.3 (decision 058): the queue. Pinned where the decision leaves room:
// - the routes answer like the others: POST /api/queue 201 { storyId } (409 { error: <code> }), DELETE and PUT 200, POST /pause and
//   /resume 200; `waiting` of an item is null or { reason: "not_ready" } or { reason: "dependency", storyId } (the awaited story).
// - tables `queue_items(story_id, position)`, `cloud_launches.from_queue`; `queue_paused_reason` is read through GET /api/queue.
export type QueueItem = {
  storyId: number;
  iWant: string;
  projectId: number;
  projectName: string;
  waiting: { reason: string; storyId?: number } | null;
};
export const queueCall = (
  ctx: Ctx,
  method: string,
  suffix = "",
  body?: unknown,
  cookie = ctx.alice.cookie,
) => send(ctx.app, cookie, method, `/api/queue${suffix}`, body);
export const readQueue = async (ctx: Ctx) =>
  (await (await queueCall(ctx, "GET")).json()) as {
    paused: boolean;
    pausedReason: string | null;
    items: QueueItem[];
  };
/** A story of the project's ticket, ready unless said otherwise. */
export const readyStory = (ctx: Ctx, over: Record<string, unknown> = {}) =>
  seedStory(ctx.db, ctx.ticketId, { status: "ready", ...over });
/** The stories (the first is ctx.storyId, plus n - 1 new ones) put in the queue through the route, each step checked. */
export async function queued(ctx: Ctx, n: number) {
  const ids = [ctx.storyId];
  while (ids.length < n) ids.push(await readyStory(ctx));
  for (const id of ids)
    expect(
      (await queueCall(ctx, "POST", "", { storyId: id })).status,
      "queueing",
    ).toBe(201);
  return ids;
}
/** The launches made so far, oldest first. */
export const launches = (ctx: Ctx) =>
  sqlRows<{
    id: number;
    story_id: number;
    branch: string;
    from_queue: boolean;
  }>(
    ctx,
    sql`select id, story_id, branch, from_queue from cloud_launches order by id`,
  );
/** What Claude does in the cloud once a launch is fired: start_run with the launch_id; then, for "succeeded", a linked PR; then finish_run. */
export async function finishLaunched(
  ctx: Ctx,
  outcome: "succeeded" | "failed" | null,
) {
  const launch = (await launches(ctx)).at(-1);
  expect(launch, "a launch to run").toBeDefined();
  const { id, story_id, branch } = launch as Awaited<
    ReturnType<typeof launches>
  >[number];
  const { run_id } = dataOf<{ run_id: number }>(
    await callTool(ctx.app, ctx.alice.secret, "start_run", {
      story_id,
      branch,
      model: "claude-x",
      launch_id: id,
    }),
  );
  if (outcome === null) return run_id;
  if (outcome === "succeeded") {
    ctx.fetchMock.addPull("user1000/app", 100 + story_id, branch);
    dataOf(
      await callTool(ctx.app, ctx.alice.secret, "link_pull_request", {
        run_id,
        pr_number: 100 + story_id,
      }),
    );
  }
  dataOf(
    await callTool(ctx.app, ctx.alice.secret, "finish_run", {
      run_id,
      outcome,
      summary: "fini",
    }),
  );
  return run_id;
}

// Slice 14.4 (decision 059). Pinned where the decision leaves room:
// - GET /api/me/launcher also gives `autoRelaunch`; PUT /api/me/launcher/auto-relaunch { enabled } answers 200;
// - columns `users.auto_relaunch`, `user_stories.relaunch_count`, `cloud_launches.relaunch`;
// - the item of « À toi de jouer » for exhausted relaunches is { kind: "relaunch_exhausted", storyId, iWant, prNumber, project }.
export const setAutoRelaunch = (ctx: Ctx, enabled = true) =>
  send(ctx.app, ctx.alice.cookie, "PUT", "/api/me/launcher/auto-relaunch", {
    enabled,
  });
/** The story launched, run and finished with a PR (in_review), its CI pending, the launcher ready and the setting on unless said. */
export async function inReview(ctx: Ctx, autoRelaunch = true) {
  if (autoRelaunch)
    expect((await setAutoRelaunch(ctx)).status, "setting").toBe(200);
  expect((await launch(ctx)).status, "launching").toBe(201);
  await finishLaunched(ctx, "succeeded");
  await setStory(ctx, "pr_ci_state = 'pending'");
  return 100 + ctx.storyId;
}
export const setStory = (ctx: Ctx, assignments: string) =>
  ctx.db.execute(
    sql.raw(`update user_stories set ${assignments} where id = ${ctx.storyId}`),
  );
/** The CI of the PR now has these check runs (name, conclusion), and Alice refreshes the PR. */
export async function refreshCi(
  ctx: Ctx,
  pr: number,
  checks: [string, "success" | "failure"][],
) {
  ctx.fetchMock.setCheckRuns(
    "user1000/app",
    `sha-${pr}`,
    checks.map(([name, conclusion]) => ({
      name,
      status: "completed" as const,
      conclusion,
    })),
  );
  const res = await send(
    ctx.app,
    ctx.alice.cookie,
    "POST",
    `/api/stories/${ctx.storyId}/pr/refresh`,
  );
  expect(res.status, "refreshing the PR").toBe(200);
}
export const storyCounts = async (ctx: Ctx) =>
  (
    await sqlRows<{ relaunch_count: number }>(
      ctx,
      sql`select relaunch_count from user_stories where id = ${ctx.storyId}`,
    )
  )[0]?.relaunch_count;
export const relaunches = (ctx: Ctx) =>
  sqlRows<{ branch: string; comment: string; relaunch: boolean }>(
    ctx,
    sql`select branch, comment, relaunch from cloud_launches where relaunch order by id`,
  );

// Slice 14.5 (decision 060). Pinned where the decision leaves room:
// - the launch of FIRE_ANSWER has the session "session_01ABCDEFGHIJ", sent by Claude Code as "cse_01ABCDEFGHIJ";
// - columns `cloud_launches.cost_usd`, `.tokens`, `.budget_usd`; GET /api/runs/:id gives, beside `cloud`, `costUsd` (number or
//   null) and `stopReason` ("budget" or null); GET /api/me/budgets and PUT (200, same shape) give { runUsd, nightUsd, monthUsd };
// - a refused launch answers 409 { error: "monthly_budget_reached" }.
export const CSE = "cse_01ABCDEFGHIJ";
type PointOptions = {
  name?: string;
  temporality?: number;
  session?: string;
  inResource?: boolean;
  tokens?: boolean;
};
/** An OTLP/HTTP JSON body with one point; `tokens` makes it an integer point of claude_code.token.usage. */
export const otlp = (value: number, o: PointOptions = {}) => {
  const attribute = {
    key: "ccr.session.id",
    value: { stringValue: o.session ?? CSE },
  };
  return {
    resourceMetrics: [
      {
        resource: { attributes: o.inResource ? [attribute] : [] },
        scopeMetrics: [
          {
            metrics: [
              {
                name:
                  o.name ??
                  (o.tokens
                    ? "claude_code.token.usage"
                    : "claude_code.cost.usage"),
                unit: o.tokens ? "tokens" : "USD",
                sum: {
                  aggregationTemporality: o.temporality ?? 1,
                  dataPoints: [
                    {
                      ...(o.tokens
                        ? { asInt: String(value) }
                        : { asDouble: value }),
                      attributes: o.inResource ? [] : [attribute],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
};
export const postMetrics = (
  ctx: Ctx,
  body: unknown,
  contentType = "application/json",
) =>
  ctx.app.request("/v1/metrics", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
/** Claude Code reports a point, the answer checked. */
export async function pay(ctx: Ctx, value: number, o: PointOptions = {}) {
  const res = await postMetrics(ctx, otlp(value, o));
  expect(res.status, "receiving a point").toBe(200);
}
/** The last launch's cost, tokens and cap. */
export async function costOf(ctx: Ctx) {
  const [row] = await sqlRows<{
    cost_usd: string | number | null;
    tokens: string | number | null;
    budget_usd: string | number | null;
  }>(
    ctx,
    sql`select cost_usd, tokens, budget_usd from cloud_launches order by id desc limit 1`,
  );
  return {
    cost: Number(row?.cost_usd ?? 0),
    tokens: Number(row?.tokens ?? 0),
    budget: row?.budget_usd == null ? null : Number(row.budget_usd),
  };
}
export const setBudgets = (
  ctx: Ctx,
  body: {
    runUsd?: number | null;
    nightUsd?: number | null;
    monthUsd?: number | null;
  },
) =>
  send(ctx.app, ctx.alice.cookie, "PUT", "/api/me/budgets", {
    runUsd: null,
    nightUsd: null,
    monthUsd: null,
    ...body,
  });

// Slice 14.6 (decision 044 and its amendments of 2026-11-08). Pinned where the decision leaves room:
// - GET and PUT /api/me/night-hours answer { startHour, endHour, timeZone } (PUT: 200, same shape in the body);
// - POST /api/nights { storyIds } -> 201 { id }; errors 409 { error: "night_exists" | "launcher_not_connected" }, 400 without story;
//   GET /api/nights/current -> { night: null | { id, status, startsAt, endsAt, items }, ready, toValidate } where an item is
//   { storyId, iWant, project: { id, name }, estimatedSeconds: number | null, outcome: string | null } and ready / toValidate
//   (items without outcome) are the stories of the ticked projects that are not in the night; PUT /api/nights/current { storyIds }
//   (before the start), POST /api/nights/current/cancel, POST /api/nights/current/stop, POST /api/nights/:id/hide answer 200;
// - tables `nights(id, user_id, starts_at, ends_at, status)` and `night_items(night_id, story_id, position, run_id, outcome)`;
// - entries plan_night, cancel_night, stop_night (human), start_night, finish_night (system);
// - the finish_run outcome `paused` makes the run status `paused`;
// - GET /api/home gives `night`: null or { id, delivered, total, items: [{ storyId, iWant, outcome, startedAt, finishedAt }] }.
export const START = new Date("2026-11-08T22:00:30Z");
export const MINUTE = 60_000;
export const minutesAfter = (from: Date, minutes: number) =>
  new Date(from.getTime() + minutes * MINUTE);
/** The clock is at `date`, then one pass of the minute. */
export const at = (ctx: Ctx, date: Date) => {
  ctx.clock.now = date.getTime();
  return pass(ctx, date);
};
export const nightCall = (
  ctx: Ctx,
  method: string,
  suffix = "",
  body?: unknown,
) => send(ctx.app, ctx.alice.cookie, method, `/api/nights${suffix}`, body);
export const setHours = (
  ctx: Ctx,
  body: unknown = { startHour: 22, endHour: 7, timeZone: "UTC" },
) => send(ctx.app, ctx.alice.cookie, "PUT", "/api/me/night-hours", body);
/** The night planned from NOW (so starting at 22:00 UTC) with these stories, the step checked. */
export async function planStories(ctx: Ctx, ids: number[]) {
  expect((await setHours(ctx)).status, "setting the hours").toBe(200);
  const res = await nightCall(ctx, "POST", "", { storyIds: ids });
  expect(res.status, "planning the night").toBe(201);
  return ((await res.json()) as { id: number }).id;
}
/** n ready stories (the first is ctx.storyId) planned as a night, in that order. */
export async function planned(ctx: Ctx, n: number) {
  const ids = [ctx.storyId];
  while (ids.length < n) ids.push(await readyStory(ctx));
  await planStories(ctx, ids);
  return ids;
}
/** The night planned, then started by the pass: its first launch is fired. */
export async function started(ctx: Ctx, n: number) {
  const ids = await planned(ctx, n);
  await at(ctx, START);
  expect(ctx.calls, "the night starts").toHaveLength(1);
  return ids;
}
export const nightItems = (ctx: Ctx) =>
  sqlRows<{ story_id: number; outcome: string | null; run_id: number | null }>(
    ctx,
    sql`select story_id, outcome, run_id from night_items order by night_id, position`,
  );
export const nightStatus = async (ctx: Ctx) =>
  (
    await sqlRows<{ status: string }>(
      ctx,
      sql`select status from nights order by id desc limit 1`,
    )
  )[0]?.status;
/** Claude asks a question on the last launch, pushes, and pauses (E). */
export async function pauseLaunched(ctx: Ctx) {
  const runId = await finishLaunched(ctx, null);
  const { question_id } = dataOf<{ question_id: number }>(
    await callTool(ctx.app, ctx.alice.secret, "ask_user", {
      run_id: runId,
      question: "Quel nom pour le bouton ?",
    }),
  );
  dataOf(
    await callTool(ctx.app, ctx.alice.secret, "finish_run", {
      run_id: runId,
      outcome: "paused",
      summary: "En pause",
    }),
  );
  return { runId, questionId: question_id };
}
