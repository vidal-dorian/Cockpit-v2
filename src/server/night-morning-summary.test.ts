import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { send } from "./test-decisions.ts";
import {
  at,
  type Ctx,
  finishLaunched,
  nightItems,
  planned,
  ready,
  sqlRows,
} from "./test-launcher.ts";

// Slice 14.7 (decision 070 A to D): GET /api/home gives night.workSeconds, night.criteriaProven and night.failures.

const T0 = "2026-11-08 22:00:00+00";
const minutes = (n: number) =>
  sql.raw(`'2026-11-08 22:00:00+00'::timestamptz + interval '${n} minutes'`);

/** A night of two stories, both delivered (so finished), the runs lasting 70 and 50 minutes; returns their run ids. */
async function finishedNight() {
  const ctx = await ready();
  await planned(ctx, 2);
  await at(ctx, new Date("2026-11-08T22:00:30Z"));
  const first = await finishLaunched(ctx, "succeeded");
  const second = await finishLaunched(ctx, "succeeded");
  await ctx.db.execute(
    sql`update runs set started_at = ${sql.raw(`'${T0}'`)}, finished_at = ${minutes(70)} where id = ${first}`,
  );
  await ctx.db.execute(
    sql`update runs set started_at = ${sql.raw(`'${T0}'`)}, finished_at = ${minutes(50)} where id = ${second}`,
  );
  return { ctx, first, second };
}

/** A run launched for the first night item (a CI retry), `lasting` minutes or still running when null. */
async function ciRetry(ctx: Ctx, lasting: number | null) {
  const [item] = await nightItems(ctx);
  const [found] = await sqlRows<{ id: number }>(
    ctx,
    sql`select id from night_items order by id limit 1`,
  );
  const [run] = await sqlRows<{ id: number }>(
    ctx,
    sql`insert into runs (story_id, user_id, status, model_actual, started_at, finished_at)
      values (${item?.story_id}, ${ctx.alice.id}, ${lasting === null ? "running" : "succeeded"}, 'claude-x',
        ${minutes(100)}, ${lasting === null ? null : minutes(100 + lasting)}) returning id`,
  );
  await ctx.db.execute(
    sql`insert into cloud_launches (user_id, story_id, night_item_id, run_id, relaunch) values (${ctx.alice.id}, ${item?.story_id}, ${found?.id}, ${run?.id}, true)`,
  );
}

const night = async (ctx: Ctx) => {
  const res = await send(ctx.app, ctx.alice.cookie, "GET", "/api/home");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { night: Record<string, number> | null };
  expect(body.night, "the morning block").not.toBeNull();
  return body.night;
};

describe("slice 14.7: the summary of the night, server side", () => {
  it("given a finished night of two stories (70 and 50 minutes) and a 10 minute CI retry, when the home is read, then night.workSeconds is 7800", async () => {
    const { ctx } = await finishedNight();
    await ciRetry(ctx, 10);

    expect((await night(ctx))?.workSeconds).toBe(7800);
  });

  it("given a finished night whose CI retry still runs, when the home is read, then that run is not in workSeconds and the answer is 200", async () => {
    const { ctx } = await finishedNight();
    await ciRetry(ctx, null);

    expect((await night(ctx))?.workSeconds).toBe(7200);
  });

  it("given 3 passed criteria of night runs, 1 failed of a night run and 1 passed of a run by hand, when the home is read, then night.criteriaProven is 3", async () => {
    const { ctx, first, second } = await finishedNight();
    const [item] = await nightItems(ctx);
    const [hand] = await sqlRows<{ id: number }>(
      ctx,
      sql`insert into runs (story_id, user_id, status, model_actual, finished_at)
        values (${item?.story_id}, ${ctx.alice.id}, 'succeeded', 'claude-x', now()) returning id`,
    );
    const cases: [string, number | undefined][] = [
      ["passed", first],
      ["passed", first],
      ["passed", second],
      ["failed", second],
      ["passed", hand?.id],
    ];
    for (const [i, [result, runId]] of cases.entries())
      await ctx.db.execute(
        sql`insert into acceptance_criteria (story_id, position, given_text, when_text, then_text, result, result_run_id)
          values (${item?.story_id}, ${100 + i}, 'g', 'w', 't', ${result}, ${runId})`,
      );

    expect((await night(ctx))?.criteriaProven).toBe(3);
  });

  it("given items ending pr, paused, skipped, failed, ci_failed and not_started, when the home is read, then night.failures is 3", async () => {
    const { ctx } = await finishedNight();
    for (const outcome of [
      "pr",
      "paused",
      "skipped",
      "failed",
      "ci_failed",
      "not_started",
    ]) {
      const story = await sqlRows<{ id: number }>(
        ctx,
        sql`insert into user_stories (ticket_id, position, as_a, i_want, so_that, notes_md, status)
          values (${ctx.ticketId}, 50, 'a', ${outcome}, 's', '', 'ready') returning id`,
      );
      await ctx.db.execute(
        sql`insert into night_items (night_id, story_id, position, outcome)
          select night_id, ${story[0]?.id}, 50, ${outcome} from night_items limit 1`,
      );
    }
    await ctx.db.execute(sql`update night_items set outcome = 'pr'
      where run_id is not null`);

    expect((await night(ctx))?.failures).toBe(3);
  });
});
