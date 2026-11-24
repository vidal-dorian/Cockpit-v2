import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
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
