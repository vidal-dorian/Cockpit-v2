import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  pass as deliveries,
  deliveryRow,
  seedDelivery,
} from "./test-issue-edit.ts";
import {
  at,
  type Ctx,
  launches,
  NOW,
  nightItems,
  pass,
  planned,
  queued,
  readQueue,
  ready,
  START,
} from "./test-launcher.ts";
import { callTool, dataOf } from "./test-mcp.ts";
import { runRoute } from "./test-run-controls.ts";

// Decision 094 F: a run that ends pr_to_open is not a failure for the night nor for the launch queue.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Starts the run of the last launch, then finishes it pr_to_open (the PR could not be opened). */
async function finishPrToOpen(ctx: Ctx) {
  const launch = (await launches(ctx)).at(-1);
  expect(launch, "a launch to run").toBeDefined();
  const { run_id } = dataOf<{ run_id: number }>(
    await callTool(ctx.app, ctx.alice.secret, "start_run", {
      story_id: launch?.story_id,
      branch: launch?.branch,
      model: "claude-x",
      launch_id: launch?.id,
    }),
  );
  dataOf(
    await callTool(ctx.app, ctx.alice.secret, "finish_run", {
      run_id,
      outcome: "pr_to_open",
      summary: "fini",
    }),
  );
  return run_id;
}

describe("criterion F1: the night", () => {
  it("given a night run that ends pr_to_open, when its item is read, then the outcome is pr_to_open and the morning recap counts no failure", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);

    const runId = await finishPrToOpen(ctx);

    expect((await nightItems(ctx)).map((i) => [i.run_id, i.outcome])).toEqual([
      [runId, "pr_to_open"],
    ]);
    const res = await send(ctx.app, ctx.alice.cookie, "GET", "/api/home");
    const { night } = (await res.json()) as {
      night: { failures: number; delivered: number } | null;
    };
    expect(night?.failures).toBe(0);
    expect(night?.delivered).toBe(0);
  });
});

describe("criterion F1b: a night run closed by hand or linked afterwards", () => {
  it("given a night run that ended pr_to_open, when it is closed by hand, then its item stays pr_to_open and the recap counts no failure", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);
    const runId = await finishPrToOpen(ctx);

    const res = await runRoute(ctx.app, ctx.alice.cookie, runId, "close");

    expect(res.status).toBe(200);
    expect((await nightItems(ctx)).map((i) => [i.run_id, i.outcome])).toEqual([
      [runId, "pr_to_open"],
    ]);
    const home = await send(ctx.app, ctx.alice.cookie, "GET", "/api/home");
    const { night } = (await home.json()) as {
      night: { failures: number; delivered: number } | null;
    };
    expect(night?.failures).toBe(0);
  });

  it("given a night run that ended pr_to_open, when the PR opened on its branch is linked, then its item becomes pr and counts as delivered", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);
    const runId = await finishPrToOpen(ctx);
    const branch = (await launches(ctx)).at(-1)?.branch as string;
    const repo = "user1000/app";
    ctx.fetchMock.addPull(repo, 31, branch);
    const id = await seedDelivery(ctx.db, {
      event: "pull_request",
      action: "opened",
      repoId: 1,
      payload: {
        action: "opened",
        number: 31,
        repository: { id: 1, full_name: repo },
        pull_request: {
          number: 31,
          head: { ref: branch, repo: { full_name: repo } },
        },
      },
    });

    await deliveries(ctx.db);

    expect((await deliveryRow(ctx.db, id)).processed_at).not.toBeNull();
    expect((await nightItems(ctx)).map((i) => [i.run_id, i.outcome])).toEqual([
      [runId, "pr"],
    ]);
    const home = await send(ctx.app, ctx.alice.cookie, "GET", "/api/home");
    const { night } = (await home.json()) as {
      night: { failures: number; delivered: number } | null;
    };
    expect(night?.failures).toBe(0);
    expect(night?.delivered).toBe(1);
  });
});

describe("criterion F2: the launch queue", () => {
  it("given a queue run that ends pr_to_open, when it ends, then the queue is not paused and the next story is launched by a later pass", async () => {
    const ctx = await ready();
    await queued(ctx, 2);
    await pass(ctx, NOW);
    expect(ctx.calls).toHaveLength(1);

    await finishPrToOpen(ctx);
    await pass(ctx, new Date(NOW.getTime() + 5 * 60_000));

    expect(await readQueue(ctx)).toMatchObject({
      paused: false,
      pausedReason: null,
    });
    expect(
      await ctx.db.execute(
        sql`select queue_paused_at from users where id = ${ctx.alice.id}`,
      ),
    ).toMatchObject({ rows: [{ queue_paused_at: null }] });
    expect(ctx.calls).toHaveLength(2);
  });
});

describe("criterion F2b: closing a pr_to_open queue run by hand", () => {
  it("given a queue of three whose first run ended pr_to_open, when it is closed by hand, then the queue stays unpaused and the third story still launches", async () => {
    const ctx = await ready();
    await queued(ctx, 3);
    await pass(ctx, NOW);
    const runId = await finishPrToOpen(ctx);

    const res = await runRoute(ctx.app, ctx.alice.cookie, runId, "close");

    expect(res.status).toBe(200);
    expect(await readQueue(ctx)).toMatchObject({
      paused: false,
      pausedReason: null,
    });
    expect(
      await ctx.db.execute(
        sql`select queue_paused_at from users where id = ${ctx.alice.id}`,
      ),
    ).toMatchObject({ rows: [{ queue_paused_at: null }] });
    await pass(ctx, new Date(NOW.getTime() + 5 * 60_000));
    expect(ctx.calls).toHaveLength(2);
    await finishPrToOpen(ctx);
    await pass(ctx, new Date(NOW.getTime() + 10 * 60_000));
    expect(ctx.calls).toHaveLength(3);
  });
});
