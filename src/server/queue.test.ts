import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  queueCall,
  queued,
  readQueue,
  ready,
  readyStory,
  tick,
} from "./test-launcher.ts";
import { archiveProject, rows, userWithToken } from "./test-mcp.ts";

// Slice 14.3 (decision 057 A, B, G): the routes of the queue and their history entries.

afterEach(() => {
  vi.unstubAllGlobals();
});

const add = (ctx: Awaited<ReturnType<typeof ready>>, storyId: number) =>
  queueCall(ctx, "POST", "", { storyId });
const entries = (ctx: Awaited<ReturnType<typeof ready>>, action: string) =>
  rows(ctx.db, sql`action = ${action}`);

describe("criterion 1: the queue routes", () => {
  it("given two ready stories, when they are queued, then GET /api/queue lists them in order with their project, and queue_story is journaled", async () => {
    const ctx = await ready();
    const second = await readyStory(ctx, { iWant: "faire la seconde" });

    expect((await add(ctx, ctx.storyId)).status).toBe(201);
    expect((await add(ctx, second)).status).toBe(201);

    expect(await readQueue(ctx)).toEqual({
      paused: false,
      pausedReason: null,
      items: [
        {
          storyId: ctx.storyId,
          iWant: "faire la chose 1",
          projectId: ctx.projectId,
          projectName: "user1000/app",
          waiting: null,
        },
        {
          storyId: second,
          iWant: "faire la seconde",
          projectId: ctx.projectId,
          projectName: "user1000/app",
          waiting: null,
        },
      ],
    });
    const found = await entries(ctx, "queue_story");
    expect(found.map((e) => e.args)).toEqual([
      { storyId: ctx.storyId },
      { storyId: second },
    ]);
    expect(found[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      result: "ok",
      user_id: ctx.alice.id,
    });
  });

  it.each([
    [
      "already_queued",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await queued(ctx, 1);
        return ctx.storyId;
      },
    ],
    [
      "wrong_status",
      async (ctx: Awaited<ReturnType<typeof ready>>) =>
        readyStory(ctx, { status: "to_validate" }),
    ],
    [
      "project_not_in_launcher",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await tick(ctx, ctx.projectId, false);
        return ctx.storyId;
      },
    ],
    [
      "project_archived",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await archiveProject(ctx.db, ctx.projectId);
        return ctx.storyId;
      },
    ],
  ])(
    "given a story that is %s, when it is queued, then 409 with that code and nothing is added",
    async (code, arrange) => {
      const ctx = await ready();
      const storyId = await arrange(ctx);
      const before = (await readQueue(ctx)).items.length;

      const res = await add(ctx, storyId);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
      expect((await readQueue(ctx)).items).toHaveLength(before);
    },
  );

  it("given the story of another user, when it is queued, then 404", async () => {
    const ctx = await ready();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    expect((await add(ctx, ctx.storyId)).status, "her own story").toBe(201);
    await queueCall(ctx, "DELETE", `/${ctx.storyId}`);

    const res = await queueCall(
      ctx,
      "POST",
      "",
      { storyId: ctx.storyId },
      bob.cookie,
    );

    expect(res.status).toBe(404);
  });

  it("given a queued story, when it is removed, then the queue is empty and unqueue_story is journaled with its id", async () => {
    const ctx = await ready();
    await queued(ctx, 1);

    const res = await queueCall(ctx, "DELETE", `/${ctx.storyId}`);

    expect(res.status).toBe(200);
    expect((await readQueue(ctx)).items).toEqual([]);
    expect((await entries(ctx, "unqueue_story")).map((e) => e.args)).toEqual([
      { storyId: ctx.storyId },
    ]);
  });

  it("given two queued stories, when PUT gives the new order, then GET follows it and reorder_queue is journaled; a list that is not exactly the queue is 400", async () => {
    const ctx = await ready();
    const [a, b] = await queued(ctx, 2);
    const other = await readyStory(ctx);

    expect((await queueCall(ctx, "PUT", "", { storyIds: [b, a] })).status).toBe(
      200,
    );

    expect((await readQueue(ctx)).items.map((i) => i.storyId)).toEqual([b, a]);
    expect((await entries(ctx, "reorder_queue")).map((e) => e.args)).toEqual([
      {},
    ]);
    for (const storyIds of [[a], [a, b, other], [a, a]])
      expect((await queueCall(ctx, "PUT", "", { storyIds })).status).toBe(400);
    expect((await readQueue(ctx)).items.map((i) => i.storyId)).toEqual([b, a]);
  });

  it("given a queue, when it is paused then resumed, then GET says so, the reason is cleared, and pause_queue and resume_queue are journaled", async () => {
    const ctx = await ready();

    expect((await queueCall(ctx, "POST", "/pause")).status).toBe(200);
    expect(await readQueue(ctx)).toMatchObject({ paused: true });
    await ctx.db.execute(
      sql`update users set queue_paused_reason = 'run_failed' where id = ${ctx.alice.id}`,
    );
    expect(await readQueue(ctx)).toMatchObject({
      paused: true,
      pausedReason: "run_failed",
    });
    expect((await queueCall(ctx, "POST", "/resume")).status).toBe(200);

    expect(await readQueue(ctx)).toMatchObject({
      paused: false,
      pausedReason: null,
    });
    expect((await entries(ctx, "pause_queue")).map((e) => e.args)).toEqual([
      {},
    ]);
    expect((await entries(ctx, "resume_queue")).map((e) => e.args)).toEqual([
      {},
    ]);
  });
});
