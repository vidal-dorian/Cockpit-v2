import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  BRANCH,
  costOf,
  finishLaunched,
  launch,
  NOW,
  otlp,
  pass,
  pay,
  postMetrics,
  queueCall,
  queued,
  readQueue,
  ready,
  readyStory,
  routineCall,
  routineOf,
  setBudgets,
} from "./test-launcher.ts";
import { callTool, dataOf, rows } from "./test-mcp.ts";
import { runRow } from "./test-run-controls.ts";

// Slice 14.5 (decision 060): the cost of the cloud launches, the caps. Also pinned: GET /api/claude/cost ->
// { monthUsd, runAverageUsd, perMergedPrUsd, budgets: { runUsd, nightUsd, monthUsd }, projects: [{ id, name, costUsd }] }
// (the month, UTC; averages null when there is nothing to divide by).

afterEach(() => {
  vi.unstubAllGlobals();
});

const getRun = async (ctx: Awaited<ReturnType<typeof ready>>, id: number) =>
  (await (
    await send(ctx.app, ctx.alice.cookie, "GET", `/api/runs/${id}`)
  ).json()) as { costUsd: number | null; stopReason: string | null };
const launched = async (body?: unknown) => {
  const ctx = await ready();
  expect((await launch(ctx, body)).status, "launching").toBe(201);
  return ctx;
};

describe("criterion 1: the receiver", () => {
  it("given a launch, when two delta cost points come, then the cost adds up, the answer is 200 {} and no history entry is written", async () => {
    const ctx = await launched();
    const before = (await rows(ctx.db)).length;

    const res = await postMetrics(ctx, otlp(0.42));
    await pay(ctx, 0.42);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect((await costOf(ctx)).cost).toBeCloseTo(0.84);
    expect(await rows(ctx.db)).toHaveLength(before);
  });

  it("given a launch, when one export carries two delta points of the session (two models), then both are added", async () => {
    const ctx = await launched();
    const body = otlp(0.3);
    body.resourceMetrics.push(...otlp(0.2).resourceMetrics);

    expect((await postMetrics(ctx, body)).status).toBe(200);

    expect((await costOf(ctx)).cost).toBeCloseTo(0.5);
  });

  it("given a launch, when a token point comes, then the tokens add up", async () => {
    const ctx = await launched();

    await pay(ctx, 1500, { tokens: true });
    await pay(ctx, 500, { tokens: true });

    expect((await costOf(ctx)).tokens).toBe(2000);
  });

  it("given a cost of 0.5, when cumulative points of 0.3 then 0.9 come, then the cost stays 0.5 then becomes 0.9", async () => {
    const ctx = await launched();
    await pay(ctx, 0.5);

    await pay(ctx, 0.3, { temporality: 2 });
    expect((await costOf(ctx)).cost).toBeCloseTo(0.5);
    await pay(ctx, 0.9, { temporality: 2 });
    expect((await costOf(ctx)).cost).toBeCloseTo(0.9);
  });

  it("given a launch, when the session id sits in the resource attributes, then the cost is added too", async () => {
    const ctx = await launched();

    await pay(ctx, 0.3, { inResource: true });

    expect((await costOf(ctx)).cost).toBeCloseTo(0.3);
  });

  it.each([
    ["an unknown session", 0.4, { session: "cse_UNKNOWN" }],
    ["a negative value", -0.4, {}],
    ["a value over 1000", 1000.01, {}],
  ])(
    "given a launch, when a point has %s, then it is ignored but answered 200",
    async (_name, value, o) => {
      const ctx = await launched();

      await pay(ctx, value, o);

      expect((await costOf(ctx)).cost).toBe(0);
    },
  );

  it("given a bad request, when it is posted, then 415 for another content type, 413 over 1 MiB, 400 for a body that is not OTLP", async () => {
    const ctx = await launched();

    expect((await postMetrics(ctx, otlp(1), "text/plain")).status).toBe(415);
    expect(
      (await postMetrics(ctx, `{"x":"${"a".repeat(1024 * 1024)}"}`)).status,
    ).toBe(413);
    expect((await postMetrics(ctx, { hello: "world" })).status).toBe(400);
    expect((await postMetrics(ctx, "not json")).status).toBe(400);
    expect((await costOf(ctx)).cost).toBe(0);
  });
});

describe("criterion 2: the cost of a run", () => {
  it("given a cloud run and a local run, when each is read, then costUsd is the launch's cost, null for the local one", async () => {
    const ctx = await launched();
    const cloudRun = await finishLaunched(ctx, null);
    await pay(ctx, 0.84);
    const other = await readyStory(ctx);
    const { run_id: localRun } = dataOf<{ run_id: number }>(
      await callTool(ctx.app, ctx.alice.secret, "start_run", {
        story_id: other,
        branch: "us/local",
        model: "claude-x",
      }),
    );

    expect((await getRun(ctx, cloudRun)).costUsd).toBeCloseTo(0.84);
    expect((await getRun(ctx, localRun)).costUsd).toBeNull();
  });
});

describe("criterion 3: the budgets", () => {
  it("given a user, when the budgets are read, set, then they are null, then the values, with a set_budgets entry of args {}; and 400 for a bad value", async () => {
    const ctx = await ready();
    const read = async () =>
      (await send(ctx.app, ctx.alice.cookie, "GET", "/api/me/budgets")).json();
    expect(await read()).toEqual({
      runUsd: null,
      nightUsd: null,
      monthUsd: null,
    });

    expect((await setBudgets(ctx, { runUsd: 2.5, monthUsd: 100 })).status).toBe(
      200,
    );

    expect(await read()).toEqual({
      runUsd: 2.5,
      nightUsd: null,
      monthUsd: 100,
    });
    const [entry] = await rows(ctx.db, sql`action = 'set_budgets'`);
    expect(entry).toMatchObject({ actor: "human", origin: "ui", args: {} });
    for (const bad of [0, -1, "5"])
      expect(
        (await setBudgets(ctx, { runUsd: bad as number })).status,
        String(bad),
      ).toBe(400);
  });
});

describe("criterion 4: the cap of a run", () => {
  it.each([
    ["by hand", false],
    ["by the queue", true],
  ])(
    "given a run budget of 2, when a story is launched %s without budgetUsd, then the launch keeps 2; and an explicit budgetUsd wins",
    async (_name, viaQueue) => {
      const ctx = await ready();
      await setBudgets(ctx, { runUsd: 2 });

      if (viaQueue) {
        await queued(ctx, 1);
        await pass(ctx, NOW);
      } else expect((await launch(ctx)).status).toBe(201);
      expect((await costOf(ctx)).budget).toBe(2);

      if (!viaQueue) {
        const other = await readyStory(ctx);
        await launch(ctx, { branch: "us/other", budgetUsd: 5 }, other);
        expect((await costOf(ctx)).budget).toBe(5);
      }
    },
  );

  it("given a launch capped at 1 and its run, when the cost reaches 1, then the stop is requested once by the system for the budget, and the run says so", async () => {
    const ctx = await launched({ branch: BRANCH, budgetUsd: 1 });
    const runId = await finishLaunched(ctx, null);

    await pay(ctx, 0.6);
    expect((await runRow(ctx.db, runId))?.stop_requested_at).toBeNull();
    await pay(ctx, 0.5);
    await pay(ctx, 0.5);

    expect((await runRow(ctx.db, runId))?.stop_requested_at).toBeTruthy();
    const entries = await rows(ctx.db, sql`action = 'request_stop'`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: "system",
      detail: { reason: "budget" },
    });
    expect((await getRun(ctx, runId)).stopReason).toBe("budget");
  });
});

describe("criterion 5: the cap of the month", () => {
  /** A launch finished that cost 1, and a monthly cap of 1. */
  async function overTheMonth() {
    const ctx = await launched();
    await finishLaunched(ctx, "failed");
    await pay(ctx, 1);
    await setBudgets(ctx, { monthUsd: 1 });
    return ctx;
  }

  it("given the month's cost at the cap, when a story is launched, then 409 monthly_budget_reached and nothing is fired", async () => {
    const ctx = await overTheMonth();
    const other = await readyStory(ctx);

    const res = await launch(ctx, { branch: "us/other" }, other);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "monthly_budget_reached" });
    expect(ctx.calls).toHaveLength(1);
  });

  it("given the month's cost at the cap, when the pass runs, then nothing is launched and the queue is paused launch_failed", async () => {
    const ctx = await overTheMonth();
    await queueCall(ctx, "POST", "", { storyId: await readyStory(ctx) });

    await pass(ctx, NOW);

    expect(ctx.calls).toHaveLength(1);
    expect(await readQueue(ctx)).toMatchObject({
      paused: true,
      pausedReason: "launch_failed",
    });
  });

  it("given the month's cost at the cap, when a routine is run now, then it is refused with 409 and nothing is fired", async () => {
    const ctx = await overTheMonth();
    const id = await routineOf(ctx);

    expect((await routineCall(ctx, "POST", id, "/run")).status).toBe(409);
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("criterion 6: the data of the page Coût", () => {
  it("given a launch of 0.84 this month, when GET /api/claude/cost is read, then the month and the project are there", async () => {
    const ctx = await launched();
    await pay(ctx, 0.84);

    const body = (await (
      await send(ctx.app, ctx.alice.cookie, "GET", "/api/claude/cost")
    ).json()) as {
      monthUsd: number;
      projects: { id: number; name: string; costUsd: number }[];
    };

    expect(body.monthUsd).toBeCloseTo(0.84);
    expect(body.projects).toEqual([
      {
        id: ctx.projectId,
        name: "user1000/app",
        costUsd: expect.closeTo(0.84),
      },
    ]);
  });
});
