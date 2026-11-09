import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runs } from "./db/schema.ts";
import { withLife } from "./test-data.ts";
import { send } from "./test-decisions.ts";
import { inReview, ready, refreshCi, relaunches } from "./test-launcher.ts";

// Review of slice 13.5 (decision 078 C): a run anonymised by its launcher's deletion has no one to act for.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("078 C: anonymised runs", () => {
  it("given a newer run with no launcher, when the CI of the story's PR fails, then nothing is relaunched in the previous launcher's name", async () => {
    const ctx = await ready();
    const pr = await inReview(ctx);
    await ctx.db.execute(
      sql`insert into runs (story_id, user_id, status, model_actual) values (${ctx.storyId}, null, 'succeeded', 'opus')`,
    );
    const fired = ctx.calls.length;

    await refreshCi(ctx, pr, [["build", "failure"]]);

    expect(await relaunches(ctx)).toEqual([]);
    expect(ctx.calls).toHaveLength(fired);
  });

  it("given her runs still running or paused on Carol's project, when she deletes, then they are closed manually before they lose their launcher", async () => {
    const ctx = await withLife();
    const [story] = (
      (await ctx.db.execute(
        sql`select story_id from runs where id = ${ctx.carolRunId}`,
      )) as unknown as { rows: { story_id: number }[] }
    ).rows;
    await ctx.db.insert(runs).values([
      {
        storyId: story?.story_id ?? 0,
        userId: ctx.alice.id,
        status: "running",
        modelActual: "opus",
      },
      {
        storyId: story?.story_id ?? 0,
        userId: ctx.alice.id,
        status: "paused",
        modelActual: "opus",
      },
    ]);

    await send(ctx.app, ctx.alice.cookie, "DELETE", "/api/me", {
      login: "user1000",
    });

    const left = (await ctx.db.execute(
      sql`select status, user_id, finished_at is not null as ended from runs where story_id = ${story?.story_id} order by id`,
    )) as unknown as {
      rows: { status: string; user_id: number | null; ended: boolean }[];
    };
    expect(left.rows).toEqual([
      { status: "succeeded", user_id: null, ended: false },
      { status: "closed_manually", user_id: null, ended: true },
      { status: "closed_manually", user_id: null, ended: true },
    ]);
  });
});
