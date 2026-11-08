import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finishLaunched,
  launch,
  launches,
  NOW,
  pass,
  queueCall,
  queued,
  readQueue,
  ready,
  readyStory,
  tick,
} from "./test-launcher.ts";
import {
  archiveProject,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
} from "./test-mcp.ts";
import { runRoute } from "./test-run-controls.ts";

// Slice 14.3 (decision 057 B, C, E): what the acceptance tests leave out: a refusal that is not a failure, the one slot, the owner of a run, who may touch a queue, the data of GET /api/claude.

afterEach(() => {
  vi.unstubAllGlobals();
});

const ids = async (ctx: Awaited<ReturnType<typeof ready>>) =>
  (await readQueue(ctx)).items.map((i) => i.storyId);

describe("the launch of the queue", () => {
  it("given a queued story launched by hand, when the pass runs, then the queue is not paused and the story stays queued", async () => {
    const ctx = await ready();
    await queued(ctx, 1);
    expect((await launch(ctx)).status).toBe(201);

    await pass(ctx, NOW);

    expect((await readQueue(ctx)).paused).toBe(false);
    expect(await ids(ctx)).toEqual([ctx.storyId]);
    expect(ctx.calls).toHaveLength(1);
    expect(await rows(ctx.db, sql`result = 'refused'`)).toEqual([]);
  });

  it("given two passes at once, when they both run, then the first story is fired once (the lock itself needs a real database to show)", async () => {
    const ctx = await ready();
    await queued(ctx, 2);

    await Promise.all([pass(ctx, NOW), pass(ctx, NOW)]);

    expect(ctx.calls).toHaveLength(1);
    expect(await launches(ctx)).toHaveLength(1);
  });

  it("given a skipped story, when its reason goes away, then the next pass launches it by itself", async () => {
    const ctx = await ready();
    await queued(ctx, 1);
    await ctx.db.execute(
      sql`update user_stories set status = 'in_progress' where id = ${ctx.storyId}`,
    );
    await pass(ctx, NOW);
    expect(ctx.calls).toHaveLength(0);

    await ctx.db.execute(
      sql`update user_stories set status = 'ready' where id = ${ctx.storyId}`,
    );
    await pass(ctx, NOW);

    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([ctx.storyId]);
  });

  it("given a queue run whose launch belongs to another user, when it is closed, then the queue of the owner of the launch is paused, not the closer's", async () => {
    const ctx = await ready();
    await queued(ctx, 2);
    await pass(ctx, NOW);
    const runId = await finishLaunched(ctx, null);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    await ctx.db.execute(sql`update cloud_launches set user_id = ${bob.id}`);

    expect(
      (await runRoute(ctx.app, ctx.alice.cookie, runId, "close")).status,
    ).toBe(200);

    expect(
      await (await queueCall(ctx, "GET", "", undefined, bob.cookie)).json(),
    ).toMatchObject({ paused: true, pausedReason: "run_failed" });
    expect(await readQueue(ctx)).toMatchObject({ paused: false });
  });
});

describe("the skips", () => {
  it("given a story of an archived project at the head, when the pass runs, then the next story fires and no refusal is written", async () => {
    const ctx = await ready();
    const project2 = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    const ticket2 = await seedTicket(ctx.db, project2, "Autre", "x");
    const second = await seedStory(ctx.db, ticket2, { status: "ready" });
    await tick(ctx, project2);
    await queued(ctx, 1);
    await queueCall(ctx, "POST", "", { storyId: second });
    await archiveProject(ctx.db, ctx.projectId);

    await pass(ctx, NOW);

    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([second]);
    expect(await rows(ctx.db, sql`result = 'refused'`)).toEqual([]);
  });
});

describe("who may touch a queue", () => {
  it("given the queue of Alice, when Bob removes or reorders, then nothing changes for her", async () => {
    const ctx = await ready();
    const [a] = await queued(ctx, 1);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const removed = await queueCall(
      ctx,
      "DELETE",
      `/${a}`,
      undefined,
      bob.cookie,
    );
    const reordered = await queueCall(
      ctx,
      "PUT",
      "",
      { storyIds: [] },
      bob.cookie,
    );

    expect(removed.status).toBe(404);
    expect(reordered.status).toBe(200);
    expect(await ids(ctx)).toEqual([a]);
  });
});

describe("GET /api/claude", () => {
  it("given runs, a queued and an unticked ready story, when read, then it lists the ready stories of the ticked projects not queued, the questions and the runs finished today, and nothing of another user", async () => {
    const ctx = await ready();
    await queued(ctx, 2);
    const free = await readyStory(ctx, { iWant: "libre" });
    await pass(ctx, NOW);
    const runId = await finishLaunched(ctx, null);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const read = async (cookie: string) =>
      (await (
        await ctx.app.request("/api/claude", { headers: { cookie } })
      ).json()) as {
        running: { runId: number; cloud: boolean }[];
        finishedToday: { outcome: string }[];
        readyStories: { storyId: number }[];
      };
    const mine = await read(ctx.alice.cookie);

    expect(mine.running.map((r) => [r.runId, r.cloud])).toEqual([
      [runId, true],
    ]);
    expect(mine.readyStories.map((s) => s.storyId)).toEqual([free]);
    expect(await read(bob.cookie)).toEqual({
      questions: [],
      running: [],
      finishedToday: [],
      readyStories: [],
    });

    expect(
      (await runRoute(ctx.app, ctx.alice.cookie, runId, "close")).status,
    ).toBe(200);
    expect((await read(ctx.alice.cookie)).finishedToday).toMatchObject([
      { outcome: "failed" },
    ]);
    await tick(ctx, ctx.projectId, false);
    expect((await read(ctx.alice.cookie)).readyStories).toEqual([]);
  });
});
