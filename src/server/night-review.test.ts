import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  at,
  finishLaunched,
  launch,
  minutesAfter,
  nightCall,
  nightItems,
  pauseLaunched,
  planned,
  ready,
  refreshCi,
  relaunches,
  START,
  setHours,
  setStory,
} from "./test-launcher.ts";
import { rows } from "./test-mcp.ts";

// Slice 14.6, review findings: the CI retry goes through the slot, only for a story the night launched, the night launches what is ready,
// the answer relaunches as the run's owner and says when the launch is refused.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof ready>>;
const answer = (ctx: Ctx, questionId: number) =>
  send(
    ctx.app,
    ctx.alice.cookie,
    "POST",
    `/api/questions/${questionId}/answer`,
    { answer: "Valider" },
  );

describe("review: the night's CI retry", () => {
  it("given a night of two with the second running, when the first one's CI fails, then nothing is fired until the second is over, then the retry goes", async () => {
    const ctx = await ready();
    await planned(ctx, 2);
    await at(ctx, START);
    await finishLaunched(ctx, "succeeded");
    expect(ctx.calls).toHaveLength(2);
    await setStory(ctx, "pr_ci_state = 'pending'");

    await refreshCi(ctx, 100 + ctx.storyId, [["build", "failure"]]);

    expect(ctx.calls).toHaveLength(2);
    expect(await relaunches(ctx)).toHaveLength(0);
    await finishLaunched(ctx, "failed");
    expect(ctx.calls).toHaveLength(3);
    expect(await relaunches(ctx)).toHaveLength(1);
  });

  it("given a planned night and a story launched by hand, when its CI fails with the auto relaunch off, then nothing is fired", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    expect((await launch(ctx)).status).toBe(201);
    await finishLaunched(ctx, "succeeded");
    await setStory(ctx, "pr_ci_state = 'pending'");
    const fired = ctx.calls.length;

    await refreshCi(ctx, 100 + ctx.storyId, [["build", "failure"]]);

    expect(ctx.calls).toHaveLength(fired);
  });
});

describe("review: the night launches what is ready", () => {
  it("given the second story in review before its turn, when the first run finishes, then it is skipped", async () => {
    const ctx = await ready();
    const [, second] = await planned(ctx, 2);
    await at(ctx, START);
    await ctx.db.execute(
      sql`update user_stories set status = 'in_review' where id = ${second}`,
    );

    await finishLaunched(ctx, "succeeded");

    expect((await nightItems(ctx)).map((i) => i.outcome)).toEqual([
      "pr",
      "skipped",
    ]);
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("review: answering a paused question", () => {
  it("given a paused run, when it is answered, then the relaunch is made by the system for the run's owner", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);
    const { questionId } = await pauseLaunched(ctx);

    expect((await answer(ctx, questionId)).status).toBe(200);

    const [entry] = await rows(
      ctx.db,
      sql`action = 'launch_story' and actor = 'system' and user_id = ${ctx.alice.id}`,
    );
    expect(entry).toBeDefined();
    expect(ctx.calls).toHaveLength(2);
  });

  it("given the launcher removed, when the question is answered, then the answer is saved and the refusal is returned", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);
    const { questionId } = await pauseLaunched(ctx);
    await send(ctx.app, ctx.alice.cookie, "DELETE", "/api/me/launcher");

    const res = await answer(ctx, questionId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "launcher_not_connected" });
    expect(
      await ctx.db.execute(
        sql`select 1 from questions where id = ${questionId} and answer = 'Valider'`,
      ),
    ).toMatchObject({ rows: [expect.anything()] });
  });
});

describe("review: the hours, the stop and the morning", () => {
  it("given the same hour for the start and the end, when the hours are saved, then 400", async () => {
    const ctx = await ready();

    const res = await setHours(ctx, {
      startHour: 7,
      endHour: 7,
      timeZone: "UTC",
    });

    expect(res.status).toBe(400);
  });

  it("given a running night, when it is stopped, then the run's stop request is the system's, with its own reason", async () => {
    const ctx = await ready();
    await planned(ctx, 2);
    await at(ctx, START);
    await finishLaunched(ctx, null);

    await nightCall(ctx, "POST", "/current/stop");

    expect(
      (await rows(ctx.db, sql`action = 'request_stop' and actor = 'system'`))[0]
        ?.detail,
    ).toMatchObject({ reason: "night_stopped" });
  });

  it("given a finished night, when the next start hour has passed, then the home has no night block", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);
    await finishLaunched(ctx, "succeeded");
    const home = async () =>
      (await (
        await send(ctx.app, ctx.alice.cookie, "GET", "/api/home")
      ).json()) as { night: unknown };
    expect((await home()).night).not.toBeNull();

    ctx.clock.now = minutesAfter(START, 24 * 60).getTime();

    expect((await home()).night).toBeNull();
  });
});
