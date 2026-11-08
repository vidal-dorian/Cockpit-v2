import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  answerOk,
  answerStatus,
  at,
  finishLaunched,
  launch,
  launches,
  minutesAfter,
  nightCall,
  nightItems,
  nightStatus,
  pauseLaunched,
  pay,
  planned,
  planStories,
  queued,
  readLauncher,
  ready,
  readyStory,
  refreshCi,
  relaunches,
  START,
  setBudgets,
  setStory,
} from "./test-launcher.ts";
import { callTool, dataOf, rows } from "./test-mcp.ts";
import { runRow } from "./test-run-controls.ts";

// Slice 14.6 (decision 044 and its amendments): the night itself. Names pinned at the top of test-launcher.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof ready>>;
const outcomes = async (ctx: Ctx) =>
  (await nightItems(ctx)).map((i) => i.outcome);
const END_PASSED = new Date("2026-11-09T07:10:00Z");

describe("criterion 3: start and order (D, H', D')", () => {
  it("given a planned night, when the pass runs before then at the start hour, then it starts the night and fires the first story once with its launch_id, whose instructions carry --night", async () => {
    const ctx = await ready();
    const [first] = await planned(ctx, 2);
    await at(ctx, new Date("2026-11-08T21:59:00Z"));
    expect(ctx.calls).toHaveLength(0);

    await at(ctx, START);
    await at(ctx, minutesAfter(START, 5));

    expect(ctx.calls).toHaveLength(1);
    const [launched] = await launches(ctx);
    expect(launched?.story_id).toBe(first);
    expect(ctx.calls[0]?.body).toEqual({ text: `launch_id: ${launched?.id}` });
    expect(await nightStatus(ctx)).toBe("running");
    for (const action of ["launch_story", "start_night"])
      expect(
        await rows(ctx.db, sql`action = ${action} and actor = 'system'`),
        action,
      ).toHaveLength(1);
    const { instructions } = dataOf<{ instructions: string }>(
      await callTool(ctx.app, ctx.alice.secret, "get_launch", {
        launch_id: launched?.id,
      }),
    );
    expect(instructions).toContain("--night");
  });

  it("given a running night of three, when each run finishes, then the next story is fired at once, one at a time", async () => {
    const ctx = await ready();
    const ids = await planned(ctx, 3);
    await at(ctx, START);

    await finishLaunched(ctx, "succeeded");
    expect(ctx.calls).toHaveLength(2);
    await at(ctx, minutesAfter(START, 5));
    expect(ctx.calls).toHaveLength(2);
    await finishLaunched(ctx, "failed");

    expect((await launches(ctx)).map((l) => l.story_id)).toEqual(ids);
    expect(await outcomes(ctx)).toEqual(["pr", "failed", null]);
  });

  it("given a second story no longer ready, when the first run finishes, then it is skipped and the third is fired", async () => {
    const ctx = await ready();
    const [, second, third] = await planned(ctx, 3);
    await at(ctx, START);
    await ctx.db.execute(
      sql`update user_stories set status = 'in_progress' where id = ${second}`,
    );

    await finishLaunched(ctx, "succeeded");

    expect(await outcomes(ctx)).toEqual(["pr", "skipped", null]);
    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([
      ctx.storyId,
      third,
    ]);
  });

  it("given a queued story and a night starting, when the pass runs, then only the night's story is fired", async () => {
    const ctx = await ready();
    await planStories(ctx, [await readyStory(ctx)]);
    await queued(ctx, 1);

    await at(ctx, START);
    await at(ctx, minutesAfter(START, 5));

    expect(ctx.calls).toHaveLength(1);
    expect((await launches(ctx))[0]?.story_id).not.toBe(ctx.storyId);
  });
});

describe("criterion 4: a question at night (E)", () => {
  it("given a running night, when the run pauses on a question, then the run is paused, the item too and the next story is fired; the answer then relaunches the story on its branch with the question and answer", async () => {
    const ctx = await ready();
    const [first, second] = await planned(ctx, 2);
    await at(ctx, START);
    const branch = (await launches(ctx))[0]?.branch;

    const { runId, questionId } = await pauseLaunched(ctx);

    expect((await runRow(ctx.db, runId))?.status).toBe("paused");
    expect(await outcomes(ctx)).toEqual(["paused", null]);
    expect((await launches(ctx)).map((l) => l.story_id)).toEqual([
      first,
      second,
    ]);
    await finishLaunched(ctx, "failed");
    const fired = ctx.calls.length;

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/questions/${questionId}/answer`,
      { answer: "Valider" },
    );

    expect(res.status).toBe(200);
    expect(ctx.calls).toHaveLength(fired + 1);
    const last = (await launches(ctx)).at(-1);
    expect(last).toMatchObject({ story_id: first, branch });
    expect(
      (
        (await ctx.db.execute(
          sql`select comment from cloud_launches order by id desc limit 1`,
        )) as unknown as { rows: { comment: string }[] }
      ).rows[0]?.comment,
    ).toMatch(/Quel nom pour le bouton \?[\s\S]*Valider/);
  });
});

describe("criterion 5: a red CI at night (F')", () => {
  it("given a night item with a PR and the auto relaunch off, when its CI fails, then it is relaunched once on its branch; a second failure leaves ci_failed and fires nothing", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);
    await finishLaunched(ctx, "succeeded");
    await setStory(ctx, "pr_ci_state = 'pending'");
    const pr = 100 + ctx.storyId;

    await refreshCi(ctx, pr, [["build", "failure"]]);

    expect(await relaunches(ctx)).toHaveLength(1);
    expect((await relaunches(ctx))[0]?.branch).toBe(
      (await launches(ctx))[0]?.branch,
    );
    await finishLaunched(ctx, "succeeded");
    await setStory(ctx, "pr_ci_state = 'pending'");
    const fired = ctx.calls.length;

    await refreshCi(ctx, pr, [["build", "failure"]]);

    expect(ctx.calls).toHaveLength(fired);
    expect(await outcomes(ctx)).toEqual(["ci_failed"]);
  });
});

describe("criterion 6: a silent run (G)", () => {
  it("given a night run without a step for 60 minutes, when the pass runs, then it is closed by the system and the next story is fired", async () => {
    const ctx = await ready();
    await planned(ctx, 2);
    await at(ctx, START);
    const runId = await finishLaunched(ctx, null);

    await at(ctx, minutesAfter(START, 59));
    expect((await runRow(ctx.db, runId))?.status).toBe("running");
    await at(ctx, minutesAfter(START, 61));

    expect((await runRow(ctx.db, runId))?.status).toBe("closed_manually");
    expect(
      await rows(ctx.db, sql`action = 'close_run' and actor = 'system'`),
    ).toHaveLength(1);
    expect(ctx.calls).toHaveLength(2);
  });
});

describe("criterion 7: failures and the cap (H', I')", () => {
  let calls = 0;
  beforeEach(() => {
    calls = 0;
  });

  it("given a 401 from /fire, when the night starts, then the launcher is to reconnect, the night is stopped and the second story is never fired", async () => {
    const ctx = await ready(answerStatus(401));
    await planned(ctx, 2);

    await at(ctx, START);
    await at(ctx, minutesAfter(START, 5));

    expect((await readLauncher(ctx)).needsReconnect).toBe(true);
    expect(ctx.calls).toHaveLength(1);
    expect(await nightStatus(ctx)).toBe("finished");
  });

  it("given the monthly cap reached, when the night starts, then nothing is fired and the night is stopped", async () => {
    const ctx = await ready();
    expect((await launch(ctx)).status).toBe(201);
    await finishLaunched(ctx, "failed");
    await pay(ctx, 1);
    await setBudgets(ctx, { monthUsd: 1 });
    const fired = ctx.calls.length;
    await planStories(ctx, [await readyStory(ctx)]);

    await at(ctx, START);

    expect(ctx.calls).toHaveLength(fired);
    expect(await nightStatus(ctx)).toBe("finished");
  });

  it("given another fire failure, when the night starts, then the item is not_started and the next story is fired without a retry", async () => {
    const ctx = await ready((call) =>
      calls++ === 0 ? answerStatus(500)(call) : answerOk(call),
    );
    const [, second] = await planned(ctx, 2);

    await at(ctx, START);

    expect(ctx.calls).toHaveLength(2);
    expect(await outcomes(ctx)).toEqual(["not_started", null]);
    expect((await launches(ctx)).at(-1)?.story_id).toBe(second);
  });

  it("given a night cap of 1, when the night's launch costs 1, then the running run gets a stop request (budget) and nothing more is fired", async () => {
    const ctx = await ready();
    await setBudgets(ctx, { nightUsd: 1 });
    await planned(ctx, 2);
    await at(ctx, START);
    const runId = await finishLaunched(ctx, null);

    await pay(ctx, 1);

    expect((await runRow(ctx.db, runId))?.stop_requested_at).toBeTruthy();
    expect(
      (await rows(ctx.db, sql`action = 'request_stop'`))[0]?.detail,
    ).toMatchObject({ reason: "budget" });
    await callTool(ctx.app, ctx.alice.secret, "finish_run", {
      run_id: runId,
      outcome: "failed",
      summary: "stop",
    });
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("criterion 8: stopping the night (K)", () => {
  it("given a running night, when it is stopped, then the run gets a stop request, stop_night is written and nothing new is fired", async () => {
    const ctx = await ready();
    await planned(ctx, 2);
    await at(ctx, START);
    const runId = await finishLaunched(ctx, null);

    const res = await nightCall(ctx, "POST", "/current/stop");

    expect(res.status).toBe(200);
    expect((await runRow(ctx.db, runId))?.stop_requested_at).toBeTruthy();
    expect(await rows(ctx.db, sql`action = 'stop_night'`)).toHaveLength(1);
    await callTool(ctx.app, ctx.alice.secret, "finish_run", {
      run_id: runId,
      outcome: "failed",
      summary: "stop",
    });
    await at(ctx, minutesAfter(START, 5));
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("criterion 9: finishing the night (D, L')", () => {
  it("given a night of one story, when its run finishes, then the night is finished and finish_night is written by the system", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    await at(ctx, START);

    await finishLaunched(ctx, "succeeded");

    expect(await nightStatus(ctx)).toBe("finished");
    expect(
      await rows(ctx.db, sql`action = 'finish_night' and actor = 'system'`),
    ).toHaveLength(1);
  });

  it("given a run finishing after the end hour, when it is over, then the next story is not fired and the night is finished", async () => {
    const ctx = await ready();
    await planned(ctx, 2);
    await at(ctx, START);
    ctx.clock.now = END_PASSED.getTime();

    await finishLaunched(ctx, "succeeded");

    expect(ctx.calls).toHaveLength(1);
    expect(await nightStatus(ctx)).toBe("finished");
  });
});
