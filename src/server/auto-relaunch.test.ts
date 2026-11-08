import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  BRANCH,
  inReview,
  readLauncher,
  ready,
  refreshCi,
  relaunches,
  setAutoRelaunch,
  setStory,
  storyCounts,
  tick,
} from "./test-launcher.ts";
import { callTool, dataOf, rows, seedStory } from "./test-mcp.ts";

// Slice 14.4 (decision 059): Cockpit relaunches Claude on the branch when the CI of the PR of a story fails.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criterion 1: the setting (A)", () => {
  it("given a user, when the setting is read, set and the history read, then it is off by default, on after the PUT, with one set_auto_relaunch entry", async () => {
    const ctx = await ready();
    expect(
      ((await readLauncher(ctx)) as { autoRelaunch?: boolean }).autoRelaunch,
    ).toBe(false);

    expect((await setAutoRelaunch(ctx)).status).toBe(200);

    expect(
      ((await readLauncher(ctx)) as { autoRelaunch?: boolean }).autoRelaunch,
    ).toBe(true);
    const found = await rows(ctx.db, sql`action = 'set_auto_relaunch'`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      args: { enabled: true },
    });
  });
});

describe("criterion 2: the relaunch (B, C)", () => {
  it("given the setting on and a pending CI, when it fails, then Cockpit fires once more with a relaunch on the branch, the failed checks as the comment, a count of 1 and a system entry", async () => {
    const ctx = await ready();
    const pr = await inReview(ctx);
    const fired = ctx.calls.length;

    await refreshCi(ctx, pr, [
      ["build", "failure"],
      ["lint", "success"],
      ["e2e", "failure"],
    ]);

    expect(ctx.calls).toHaveLength(fired + 1);
    const [launched, ...more] = await relaunches(ctx);
    expect(more).toEqual([]);
    expect(launched).toMatchObject({ relaunch: true, branch: BRANCH });
    expect(launched?.comment).toBe(
      `The CI of pull request #${pr} failed: build, e2e. Fix it on this branch, then push.`,
    );
    expect(await storyCounts(ctx)).toBe(1);
    const found = await rows(
      ctx.db,
      sql`action = 'launch_story' and actor = 'system'`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ story_id: ctx.storyId });
  });
});

describe("criterion 3: no relaunch (B)", () => {
  it.each([
    [
      "the setting is off",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await inReview(ctx, false);
      },
    ],
    [
      "the CI was already failing",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await inReview(ctx);
        await setStory(ctx, "pr_ci_state = 'failure'");
      },
    ],
    [
      "a run is active",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await inReview(ctx);
        dataOf(
          await callTool(ctx.app, ctx.alice.secret, "start_run", {
            story_id: ctx.storyId,
            branch: BRANCH,
            model: "claude-x",
          }),
        );
      },
    ],
    [
      "the project is not ticked",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await inReview(ctx);
        await tick(ctx, ctx.projectId, false);
      },
    ],
    [
      "the owner of the last run is blocked",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await inReview(ctx);
        await ctx.db.execute(
          sql`update users set blocked_at = now() where id = ${ctx.alice.id}`,
        );
      },
    ],
    [
      "3 relaunches were made already",
      async (ctx: Awaited<ReturnType<typeof ready>>) => {
        await inReview(ctx);
        await setStory(ctx, "relaunch_count = 3");
      },
    ],
  ])(
    "given %s, when the CI fails, then nothing is fired",
    async (_name, prepare) => {
      const ctx = await ready();
      await prepare(ctx);
      const fired = ctx.calls.length;

      await refreshCi(ctx, 100 + ctx.storyId, [["build", "failure"]]);

      expect(ctx.calls).toHaveLength(fired);
      expect(await relaunches(ctx)).toEqual([]);
    },
  );
});

describe("criterion 4: the check names (C)", () => {
  it("given odd check names, when the CI fails, then the comment keeps 10 names of 100 characters, reduced to letters, digits, spaces and ._:/()-", async () => {
    const ctx = await ready();
    const pr = await inReview(ctx);
    const names = [
      "build<script>$(x)`y`;|&",
      "a".repeat(150),
      ...Array.from({ length: 10 }, (_, i) => `n${String(i).padStart(2, "0")}`),
    ];

    await refreshCi(
      ctx,
      pr,
      names.map((n) => [n, "failure"]),
    );

    const comment = (await relaunches(ctx))[0]?.comment ?? "";
    expect(comment).toContain("build");
    expect(comment).toContain("y");
    expect(comment).not.toMatch(/[<>`;|&]/);
    expect(comment).not.toContain("$");
    expect(comment).toContain("a".repeat(100));
    expect(comment).not.toContain("a".repeat(101));
    expect(comment).toContain("n07");
    expect(comment).not.toContain("n08");
  });
});

describe("criterion 5: the count is reset (D)", () => {
  it("given 2 relaunches, when the CI goes back to success, then relaunch_count is 0", async () => {
    const ctx = await ready();
    const pr = await inReview(ctx);
    await setStory(ctx, "relaunch_count = 2, pr_ci_state = 'failure'");

    await refreshCi(ctx, pr, [["build", "success"]]);

    expect(await storyCounts(ctx)).toBe(0);
  });
});

describe("criterion 7: a failed launch (E)", () => {
  it("given /fire answers 500, when the CI fails, then the relaunch counts and is not retried", async () => {
    let failing = false;
    const ctx = await ready(() =>
      failing
        ? Response.json({ error: "stub" }, { status: 500 })
        : Response.json({
            type: "routine_fire",
            claude_code_session_id: "session_01ABCDEFGHIJ",
            claude_code_session_url:
              "https://claude.ai/code/session_01ABCDEFGHIJ",
          }),
    );
    const pr = await inReview(ctx);
    const fired = ctx.calls.length;
    failing = true;

    await refreshCi(ctx, pr, [["build", "failure"]]);

    expect(ctx.calls).toHaveLength(fired + 1);
    expect(await storyCounts(ctx)).toBe(1);
  });
});

describe("criterion 6: exhausted relaunches (D), server side", () => {
  it("given 3 relaunches and a failing CI, when the home is read, then the story is first with the kind relaunch_exhausted", async () => {
    const ctx = await ready();
    await inReview(ctx);
    await setStory(ctx, "relaunch_count = 3, pr_ci_state = 'failure'");
    const other = await seedStory(ctx.db, ctx.ticketId, {
      status: "to_validate",
    });

    const res = await send(ctx.app, ctx.alice.cookie, "GET", "/api/home");

    const { forYou } = (await res.json()) as {
      forYou: { kind: string; storyId: number }[];
    };
    expect(forYou.map((i) => [i.kind, i.storyId])).toEqual([
      ["relaunch_exhausted", ctx.storyId],
      ["validate", other],
    ]);
  });
});
