import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerStatus,
  DUE,
  finishLaunched,
  launches,
  NOW,
  pass,
  queueCall,
  queued,
  readLauncher,
  readQueue,
  ready,
  readyStory,
} from "./test-launcher.ts";
import { rows } from "./test-mcp.ts";
import { runRoute } from "./test-run-controls.ts";

// Slice 14.3 (decision 057 C, D, E): the launch of the queue by the pass of the minute, the skips and the pauses.

afterEach(() => {
  vi.unstubAllGlobals();
});

const ids = async (ctx: Awaited<ReturnType<typeof ready>>) =>
  (await readQueue(ctx)).items.map((i) => i.storyId);
const MINUTE = 60_000;
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

describe("criterion 2: the launch", () => {
  it("given three queued stories and a ready launcher, when the pass runs, then the first is fired once as a queue launch on its short-title branch, leaves the queue, and a second pass fires nothing while it is in progress", async () => {
    const ctx = await ready();
    const [first, second, third] = await queued(ctx, 3);

    await pass(ctx, NOW);
    await pass(ctx, later(5));

    expect(ctx.calls).toHaveLength(1);
    const [launch] = await launches(ctx);
    expect(ctx.calls[0]?.body).toEqual({ text: `launch_id: ${launch?.id}` });
    expect(launch).toMatchObject({
      story_id: first,
      from_queue: true,
      branch: `us/${first}-faire-la-chose-1`,
    });
    expect(await ids(ctx)).toEqual([second, third]);
    expect(
      await rows(ctx.db, sql`action = 'launch_story' and actor = 'system'`),
    ).toHaveLength(1);
  });

  it("given a queued story that already has a branch, when the pass runs, then it is launched on that branch", async () => {
    const ctx = await ready();
    await ctx.db.execute(
      sql`update user_stories set branch = 'us/mine' where id = ${ctx.storyId}`,
    );
    await queued(ctx, 1);

    await pass(ctx, NOW);

    expect((await launches(ctx))[0]?.branch).toBe("us/mine");
  });

  it("given three queued stories, when the first finishes succeeded, then the second starts at once without a pass, and the third only after the second finishes", async () => {
    const ctx = await ready();
    const [first, second, third] = await queued(ctx, 3);
    await pass(ctx, NOW);
    expect(ctx.calls).toHaveLength(1);

    await finishLaunched(ctx, "succeeded");

    expect(ctx.calls).toHaveLength(2);
    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([
      first,
      second,
    ]);
    await finishLaunched(ctx, "succeeded");
    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([
      first,
      second,
      third,
    ]);
    expect(await ids(ctx)).toEqual([]);
  });
});

describe("criterion 3: the skips", () => {
  it("given a queued story no longer ready and one waiting for a dependency, when the pass runs, then the third launches and the two stay queued with their reason", async () => {
    const ctx = await ready();
    const awaited = await readyStory(ctx);
    const blocked = await readyStory(ctx, { dependsOn: [awaited] });
    const third = await readyStory(ctx);
    await queued(ctx, 1);
    for (const id of [blocked, third])
      await queueCall(ctx, "POST", "", { storyId: id });
    await ctx.db.execute(
      sql`update user_stories set status = 'in_progress' where id = ${ctx.storyId}`,
    );

    await pass(ctx, NOW);

    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([third]);
    expect(
      (await readQueue(ctx)).items.map((i) => [i.storyId, i.waiting]),
    ).toEqual([
      [ctx.storyId, { reason: "not_ready" }],
      [blocked, { reason: "dependency", storyId: awaited }],
    ]);
  });
});

describe("criterion 4: the pauses", () => {
  it.each([
    [500, false],
    [401, true],
  ])(
    "given /fire answers %i, when the pass launches, then the queue is paused launch_failed (reconnect %s) with a system pause_queue entry",
    async (status, reconnect) => {
      const ctx = await ready(answerStatus(status));
      await queued(ctx, 2);

      await pass(ctx, NOW);

      expect(await readQueue(ctx)).toMatchObject({
        paused: true,
        pausedReason: "launch_failed",
      });
      expect((await readLauncher(ctx)).needsReconnect).toBe(reconnect);
      expect(
        (await rows(ctx.db, sql`action = 'pause_queue'`)).map((e) => [
          e.actor,
          e.detail,
        ]),
      ).toEqual([["system", { reason: "launch_failed" }]]);
    },
  );

  it("given a queue run that finishes failed, when it ends, then the queue is paused run_failed and the next story does not start", async () => {
    const ctx = await ready();
    await queued(ctx, 2);
    await pass(ctx, NOW);

    await finishLaunched(ctx, "failed");

    expect(await readQueue(ctx)).toMatchObject({
      paused: true,
      pausedReason: "run_failed",
    });
    expect(ctx.calls).toHaveLength(1);
  });

  it("given a queue run closed by hand, when it is closed, then the queue is paused run_failed", async () => {
    const ctx = await ready();
    await queued(ctx, 2);
    await pass(ctx, NOW);
    const runId = await finishLaunched(ctx, null);

    expect(
      (await runRoute(ctx.app, ctx.alice.cookie, runId, "close")).status,
    ).toBe(200);

    expect(await readQueue(ctx)).toMatchObject({
      paused: true,
      pausedReason: "run_failed",
    });
  });

  it("given a launch with no run after 15 minutes, when the pass runs, then the queue is paused no_session; and a paused queue launches nothing", async () => {
    const ctx = await ready();
    await queued(ctx, 2);
    await pass(ctx, NOW);
    await pass(ctx, later(14));
    expect((await readQueue(ctx)).paused).toBe(false);

    await pass(ctx, later(16));

    expect(await readQueue(ctx)).toMatchObject({
      paused: true,
      pausedReason: "no_session",
    });
    await pass(ctx, DUE);
    expect(ctx.calls).toHaveLength(1);
  });
});
