import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  at,
  finishLaunched,
  minutesAfter,
  nightCall,
  nightItems,
  nightStatus,
  pauseLaunched,
  planned,
  planStories,
  ready,
  readyStory,
  START,
  setHours,
  setup,
  sqlRows,
} from "./test-launcher.ts";
import { rows, seedStory } from "./test-mcp.ts";

// Slice 14.6 (decision 044 and its amendments): the evening, the plan and the morning. Names pinned at the top of test-launcher.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Current = {
  night: null | {
    id: number;
    status: string;
    items: {
      storyId: number;
      project: { id: number; name: string };
      estimatedSeconds: number | null;
    }[];
  };
  ready: { storyId: number }[];
  toValidate: { storyId: number }[];
};
const current = async (ctx: Awaited<ReturnType<typeof ready>>) =>
  (await (await nightCall(ctx, "GET", "/current")).json()) as Current;

describe("criterion 1: the night hours (C')", () => {
  it("given a user, when the hours are read, set, and read again, then they are 22 and 7 by default, then the new ones", async () => {
    const ctx = await setup();
    const read = async () =>
      (await (
        await send(ctx.app, ctx.alice.cookie, "GET", "/api/me/night-hours")
      ).json()) as Record<string, unknown>;
    expect(await read()).toMatchObject({ startHour: 22, endHour: 7 });

    const res = await setHours(ctx, {
      startHour: 21,
      endHour: 6,
      timeZone: "Europe/Paris",
    });

    expect(res.status).toBe(200);
    expect(await read()).toEqual({
      startHour: 21,
      endHour: 6,
      timeZone: "Europe/Paris",
    });
  });
});

describe("criterion 2: planning the night (C, I, L')", () => {
  it("given ready stories, when the night is planned in an order, then it starts at the next start hour and ends at the end hour, the items follow the order, and plan_night is written", async () => {
    const ctx = await ready();
    const other = await readyStory(ctx);

    const id = await planStories(ctx, [other, ctx.storyId]);

    const [night] = await sqlRows<{
      id: number;
      status: string;
      starts_at: string;
      ends_at: string;
    }>(ctx, sql`select id, status, starts_at, ends_at from nights`);
    expect(night).toMatchObject({ id, status: "planned" });
    expect(new Date(night?.starts_at ?? 0).toISOString()).toBe(
      "2026-11-08T22:00:00.000Z",
    );
    expect(new Date(night?.ends_at ?? 0).toISOString()).toBe(
      "2026-11-09T07:00:00.000Z",
    );
    expect((await nightItems(ctx)).map((i) => i.story_id)).toEqual([
      other,
      ctx.storyId,
    ]);
    const [entry] = await rows(ctx.db, sql`action = 'plan_night'`);
    expect(entry).toMatchObject({ actor: "human", user_id: ctx.alice.id });
  });

  it("given no night, when the current night is read, then it is null with the ready and the to_validate stories of the ticked projects", async () => {
    const ctx = await ready();
    const draft = await seedStory(ctx.db, ctx.ticketId, {
      status: "to_validate",
    });

    const data = await current(ctx);

    expect(data.night).toBeNull();
    expect(data.ready.map((s) => s.storyId)).toEqual([ctx.storyId]);
    expect(data.toValidate.map((s) => s.storyId)).toEqual([draft]);
  });

  it("given a planned night, when it is read, then the items come in order with their project and a null estimate without succeeded run", async () => {
    const ctx = await ready();
    const [first, second] = await planned(ctx, 2);

    const { night } = await current(ctx);

    expect(night?.status).toBe("planned");
    expect(night?.items.map((i) => i.storyId)).toEqual([first, second]);
    expect(night?.items[0]).toMatchObject({
      project: { id: ctx.projectId, name: "user1000/app" },
      estimatedSeconds: null,
    });
  });

  it("given a succeeded run of 30 minutes in the project, when the night is read, then the estimate is 1800 seconds", async () => {
    const ctx = await ready();
    await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/stories/${ctx.storyId}/launch`,
      {
        branch: "us/x",
      },
    );
    await finishLaunched(ctx, "succeeded");
    await ctx.db.execute(
      sql`update runs set started_at = finished_at - interval '30 minutes'`,
    );
    const other = await readyStory(ctx);
    await planStories(ctx, [other]);

    const { night } = await current(ctx);

    expect(night?.items[0]?.estimatedSeconds).toBe(1800);
  });

  it("given a night already planned, when another is planned, then 409 night_exists", async () => {
    const ctx = await ready();
    await planned(ctx, 1);

    const res = await nightCall(ctx, "POST", "", { storyIds: [ctx.storyId] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "night_exists" });
  });

  it("given no connected launcher, when a night is planned, then 409 launcher_not_connected", async () => {
    const ctx = await setup();

    const res = await nightCall(ctx, "POST", "", { storyIds: [ctx.storyId] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "launcher_not_connected" });
  });

  it("given no story, when a night is planned, then 400", async () => {
    const ctx = await ready();

    expect((await nightCall(ctx, "POST", "", { storyIds: [] })).status).toBe(
      400,
    );
  });

  it("given a planned night of three, when it is reordered and one removed before the start, then the items follow", async () => {
    const ctx = await ready();
    const [a, b, c] = await planned(ctx, 3);

    const res = await nightCall(ctx, "PUT", "/current", { storyIds: [c, a] });

    expect(res.status).toBe(200);
    expect((await nightItems(ctx)).map((i) => i.story_id)).toEqual([c, a]);
    expect(b).toBeDefined();
  });

  it("given a planned night, when it is cancelled, then it is cancelled, cancel_night is written and the start hour launches nothing", async () => {
    const ctx = await ready();
    await planned(ctx, 1);

    const res = await nightCall(ctx, "POST", "/current/cancel");
    await at(ctx, START);

    expect(res.status).toBe(200);
    expect(await nightStatus(ctx)).toBe("cancelled");
    expect(await rows(ctx.db, sql`action = 'cancel_night'`)).toHaveLength(1);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("criterion 10: the morning (J), server side", () => {
  /** Night of two: the first pauses on a question, the second delivers a PR; returns the ids. */
  async function morning() {
    const ctx = await ready();
    const [first, second] = await planned(ctx, 2);
    await at(ctx, START);
    const { questionId } = await pauseLaunched(ctx);
    ctx.clock.now = minutesAfter(START, 30).getTime();
    await finishLaunched(ctx, "succeeded");
    const home = async () =>
      (await (
        await send(ctx.app, ctx.alice.cookie, "GET", "/api/home")
      ).json()) as {
        night: Record<string, unknown> | null;
        forYou: { kind: string; questionId?: number }[];
      };
    return { ctx, first, second, questionId, home };
  }

  it("given a finished night, when the home is read, then the night block gives the delivered PR count, the items with their times and outcome, and the paused question comes first in forYou", async () => {
    const { ctx, first, second, questionId, home } = await morning();

    const data = await home();

    expect(await nightStatus(ctx)).toBe("finished");
    expect(data.night).toMatchObject({
      delivered: 1,
      total: 2,
      items: [
        { storyId: first, outcome: "paused" },
        { storyId: second, outcome: "pr" },
      ],
    });
    const items = data.night?.items as { finishedAt: string | null }[];
    expect(items[1]?.finishedAt).toBeTruthy();
    expect(data.forYou[0]).toMatchObject({
      kind: "answer",
      questionId,
    });
  });

  it("given the night block, when it is hidden, then the home has no night block", async () => {
    const { ctx, home } = await morning();
    const { id } = (await home()).night as { id: number };

    const res = await nightCall(ctx, "POST", `/${id}/hide`);

    expect(res.status).toBe(200);
    expect((await home()).night).toBeNull();
  });
});
