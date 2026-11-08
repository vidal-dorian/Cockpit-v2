import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bobsStory,
  branch,
  calls,
  changelog,
  changelogCtx,
  gitOf,
  merged,
  read,
  release,
  story,
} from "./test-changelog.ts";
import { archiveProject, rows } from "./test-mcp.ts";

// Slice 11.5 (decision 062 A, B, C, D): GET /api/projects/:id/changelog. The contract is pinned in test-changelog.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

const numbers = (g: { entries: { number: number }[] }) =>
  g.entries.map((e) => e.number);

describe("A: reading the changelog", () => {
  it("given no session, when the changelog is read, then 401", async () => {
    const ctx = await changelogCtx();
    const res = await ctx.app.request(
      `/api/projects/${ctx.projectId}/changelog`,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("given a project of someone else, when a non-member reads its changelog, then 404 and GitHub is not called", async () => {
    const ctx = await changelogCtx();
    const { project } = await bobsStory(ctx);
    expect((await changelog(ctx)).status, "a member reads it").toBe(200);
    const before = calls(ctx, "GET", /./).length;

    const res = await changelog(ctx, project);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(calls(ctx, "GET", /./).length).toBe(before);
  });

  it("given an archived project, when a member reads the changelog, then 200", async () => {
    const ctx = await changelogCtx();
    merged(ctx, 1, "feat: a", "2026-11-05T10:00:00Z");
    await archiveProject(ctx.db, ctx.projectId);

    expect((await read(ctx)).groups).toHaveLength(1);
  });

  it("given closed PRs, when it is read, then only the merged ones whose base is the default branch are listed", async () => {
    const ctx = await changelogCtx();
    merged(ctx, 1, "feat: kept", "2026-11-05T10:00:00Z");
    merged(ctx, 2, "feat: closed, not merged", "2026-11-05T11:00:00Z", {
      merged: false,
      mergedAt: null,
    });
    merged(ctx, 3, "feat: into develop", "2026-11-05T12:00:00Z", {
      base: "develop",
    });

    const { groups } = await read(ctx);

    expect(groups.flatMap(numbers)).toEqual([1]);
  });

  it("given 350 merged PRs, when it is read, then it asks for the closed PRs of the base 100 per page, 3 pages at most, and lists the 300 most recently updated", async () => {
    const ctx = await changelogCtx();
    for (let n = 1; n <= 350; n++)
      merged(
        ctx,
        n,
        `feat: pr ${n}`,
        new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(),
      );

    const { groups } = await read(ctx);

    const asked = calls(ctx, "GET", /\/pulls$/);
    expect(asked).toHaveLength(3);
    for (const call of asked) {
      expect(new URLSearchParams(call.search).get("state")).toBe("closed");
      expect(new URLSearchParams(call.search).get("per_page")).toBe("100");
    }
    expect(groups.flatMap(numbers).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 300 }, (_, i) => i + 51),
    );
  });

  it("given a failing GitHub, when it is read, then 502 github_unavailable, whichever call fails", async () => {
    for (const tail of ["/pulls", "/releases"]) {
      const ctx = await changelogCtx();
      merged(ctx, 1, "feat: a", "2026-11-05T10:00:00Z");
      ctx.fetchMock.update({ failOn: ({ path }) => path.endsWith(tail) });

      const res = await changelog(ctx);

      expect(res.status, tail).toBe(502);
      expect(await res.json()).toEqual({ error: "github_unavailable" });
    }
  });

  it("given a read, when it is done, then it leaves no history entry", async () => {
    const ctx = await changelogCtx();
    merged(ctx, 1, "feat: a", "2026-11-05T10:00:00Z");
    const before = (await rows(ctx.db)).length;

    await read(ctx);

    expect((await rows(ctx.db)).length).toBe(before);
  });

  it("given nothing merged, when it is read, then there are no groups and no branches", async () => {
    const ctx = await changelogCtx();
    // Review of 11.5: the response also names the repo, for the PR links.
    expect(await read(ctx)).toEqual({
      groups: [],
      branches: [],
      repo: "user1000/app",
    });
  });
});

describe("B: grouping by version", () => {
  it("given two releases and PRs around them, when it is read, then each PR is under the first release published after its merge, the unreleased group is first, and each group is newest first", async () => {
    const ctx = await changelogCtx();
    release(ctx, {
      tag: "v1.9.0",
      name: "1.9.0",
      publishedAt: "2026-11-06T12:00:00Z",
    });
    release(ctx, {
      tag: "v1.8.0",
      name: "1.8.0",
      publishedAt: "2026-11-01T10:00:00Z",
    });
    merged(ctx, 1, "feat: old", "2026-10-30T10:00:00Z");
    merged(ctx, 2, "feat: early", "2026-11-03T10:00:00Z");
    merged(ctx, 3, "feat: late", "2026-11-05T10:00:00Z");
    merged(ctx, 4, "feat: after", "2026-11-07T10:00:00Z");

    const { groups } = await read(ctx);

    expect(groups.map((g) => [g.kind, g.name, g.date === null])).toEqual([
      ["unreleased", null, true],
      ["release", "1.9.0", false],
      ["release", "1.8.0", false],
    ]);
    expect(groups.map(numbers)).toEqual([[4], [3, 2], [1]]);
    expect(new Date(groups[1]?.date as string).getTime()).toBe(
      Date.parse("2026-11-06T12:00:00Z"),
    );
  });

  it("given a release without a name, when it is read, then the group is named after its tag", async () => {
    const ctx = await changelogCtx();
    release(ctx, { tag: "v2.0.0", publishedAt: "2026-11-06T12:00:00Z" });
    merged(ctx, 1, "feat: a", "2026-11-05T10:00:00Z");

    const { groups } = await read(ctx);

    expect(groups[0]).toMatchObject({ kind: "release", name: "v2.0.0" });
  });

  it("given a draft release, when it is read, then it is ignored: its PRs are not yet published, and the releases are asked 100 at most", async () => {
    const ctx = await changelogCtx();
    release(ctx, {
      tag: "v2.0.0",
      name: "2.0.0",
      draft: true,
      publishedAt: "2026-11-08T12:00:00Z",
    });
    release(ctx, {
      tag: "v1.9.0",
      name: "1.9.0",
      publishedAt: "2026-11-06T12:00:00Z",
    });
    merged(ctx, 1, "feat: in 1.9", "2026-11-05T10:00:00Z");
    merged(ctx, 2, "feat: waiting", "2026-11-07T10:00:00Z");

    const { groups } = await read(ctx);

    expect(groups.map((g) => [g.kind, g.name])).toEqual([
      ["unreleased", null],
      ["release", "1.9.0"],
    ]);
    expect(groups.map(numbers)).toEqual([[2], [1]]);
    const asked = calls(ctx, "GET", /\/releases$/);
    expect(asked.length).toBeGreaterThan(0);
    expect(new URLSearchParams(asked[0]?.search).get("per_page")).toBe("100");
  });

  it("given a repo with no release, when it is read, then the PRs are grouped by merge day, newest day first and newest PR first", async () => {
    const ctx = await changelogCtx();
    merged(ctx, 1, "feat: a", "2026-11-06T15:00:00Z");
    merged(ctx, 2, "feat: b", "2026-11-07T08:00:00Z");
    merged(ctx, 3, "feat: c", "2026-11-07T09:00:00Z");

    const { groups } = await read(ctx);

    expect(groups.map((g) => [g.kind, g.name, g.date])).toEqual([
      ["day", null, "2026-11-07"],
      ["day", null, "2026-11-06"],
    ]);
    expect(groups.map(numbers)).toEqual([[3, 2], [1]]);
  });
});

describe("C: one line per PR", () => {
  it.each([
    ["feat(11.1): Add the thing", "Add the thing", false],
    ["fix: Mend the thing", "Mend the thing", true],
    ["fix(ui): Mend the button", "Mend the button", true],
    ["chore(x)!: Drop it", "Drop it", false],
    ["feat: fix the thing", "fix the thing", false],
    ["Plain title", "Plain title", false],
  ])(
    "given the title « %s », when it is read, then the line is « %s » and fix is %s",
    async (title, shown, fix) => {
      const ctx = await changelogCtx();
      merged(ctx, 7, title, "2026-11-05T10:00:00Z");

      const { groups } = await read(ctx);

      expect(groups[0]?.entries).toEqual([
        { number: 7, title: shown, fix, storyId: null },
      ]);
    },
  );

  it("given a story of the project whose PR is 51, when it is read, then the line of PR 51 carries its storyId and the others null", async () => {
    const ctx = await changelogCtx();
    const id = await story(ctx, { pr: 51, branch: "us/40-x" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");
    merged(ctx, 52, "feat: b", "2026-11-05T11:00:00Z");

    const { groups } = await read(ctx);

    expect(
      Object.fromEntries(
        (groups[0]?.entries ?? []).map((e) => [e.number, e.storyId]),
      ),
    ).toEqual({ 51: id, 52: null });
  });
});

describe("D: the branches to clean", () => {
  it("given a done story with a merged PR and its branch on GitHub, when it is read, then the branch is listed with its story and PR", async () => {
    const ctx = await changelogCtx();
    const id = await story(ctx, { pr: 51, branch: "us/40-x" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z", { headRef: "us/40-x" });
    branch(ctx, "us/40-x", 51);

    expect((await read(ctx)).branches).toEqual([
      { storyId: id, branch: "us/40-x", prNumber: 51 },
    ]);
  });

  it("given a branch that is no story's, an unfinished story and a PR not merged, when it is read, then none of them is listed", async () => {
    const ctx = await changelogCtx();
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");
    branch(ctx, "feature/other", 51);
    await story(ctx, { status: "in_review", pr: 51, branch: "us/41-x" });
    branch(ctx, "us/41-x", 51);
    await story(ctx, { pr: 60, branch: "us/42-x" });
    merged(ctx, 60, "feat: closed", "2026-11-05T11:00:00Z", {
      merged: false,
      mergedAt: null,
    });
    branch(ctx, "us/42-x", 60);

    expect((await read(ctx)).branches).toEqual([]);
  });

  it("given a done story whose branch is gone, when it is read, then it is not listed", async () => {
    const ctx = await changelogCtx();
    await story(ctx, { pr: 51, branch: "us/40-x" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");

    expect((await read(ctx)).branches).toEqual([]);
  });

  it("given 250 branches and the story's branch last, when it is read, then the branches are read 100 per page and it is found", async () => {
    const ctx = await changelogCtx();
    const id = await story(ctx, { pr: 51, branch: "us/40-x" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");
    for (let i = 0; i < 250; i++)
      branch(ctx, `b-${String(i).padStart(4, "0")}`, 1);
    branch(ctx, "us/40-x", 51);

    const found = await read(ctx);

    expect(found.branches.map((b) => b.storyId)).toEqual([id]);
    const asked = calls(ctx, "GET", /\/branches$/);
    expect(asked.length).toBeLessThanOrEqual(10);
    expect(asked.length).toBeGreaterThanOrEqual(3);
    expect(new URLSearchParams(asked[0]?.search).get("per_page")).toBe("100");
  });

  it("given 1100 branches and the story's branch after the 1000th, when it is read, then at most 10 pages are read and it is not listed", async () => {
    const ctx = await changelogCtx();
    await story(ctx, { pr: 51, branch: "us/40-x" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");
    for (let i = 0; i < 1100; i++)
      branch(ctx, `b-${String(i).padStart(4, "0")}`, 1);
    branch(ctx, "us/40-x", 51);
    expect(gitOf(ctx)._otherBranches.size).toBe(1101);

    const found = await read(ctx);

    expect(calls(ctx, "GET", /\/branches$/)).toHaveLength(10);
    expect(found.branches).toEqual([]);
  });
});

describe("review: more cases of the changelog", () => {
  it("given a project, when it is read, then the answer names its repo (the page builds its PR links from it)", async () => {
    const ctx = await changelogCtx();
    expect((await read(ctx)).repo).toBe("user1000/app");
  });

  it.each([
    ["Docs: Explain it", "Explain it", false],
    ["docs(api)!: Explain it", "Explain it", false],
    ["FEAT(ui): Shout", "Shout", false],
    ["Fix: crash", "crash", true],
    ["WIP: not done", "WIP: not done", false],
    ["Note: read this", "Note: read this", false],
    ["v2: the next one", "v2: the next one", false],
    // Nothing after the prefix: the title stays, and it is not announced as a fix.
    ["fix:", "fix:", false],
  ])(
    "given the title « %s », when it is read, then only a conventional type (feat, fix, chore, docs, refactor, perf, test, build, ci, style, revert; any case) is stripped: « %s », fix %s",
    async (title, shown, fix) => {
      const ctx = await changelogCtx();
      merged(ctx, 7, title, "2026-11-05T10:00:00Z");

      const { groups } = await read(ctx);

      expect(groups[0]?.entries).toEqual([
        { number: 7, title: shown, fix, storyId: null },
      ]);
    },
  );

  it("given 100 releases (GitHub may have more), when a PR was merged before the oldest one read, then it is not put under that release but in a last group { kind: older }: the release that holds it may not have been read", async () => {
    const ctx = await changelogCtx();
    for (let i = 99; i >= 0; i--)
      release(ctx, {
        tag: `v${i}`,
        publishedAt: new Date(Date.UTC(2026, 6, 1 + i, 12)).toISOString(),
      });
    merged(ctx, 1, "feat: ancient", "2026-06-15T10:00:00Z");
    merged(ctx, 2, "feat: first read", "2026-07-01T05:00:00Z");
    merged(ctx, 3, "feat: unreleased", "2026-11-01T10:00:00Z");

    const { groups } = await read(ctx);

    // Review of 11.5: every PR merged before the oldest release read is unplaceable (the 101st release, unread, may hold it), so 2 is « older » too, not guessed.
    expect(groups.map((g) => g.kind)).toEqual(["unreleased", "older"]);
    expect(groups.map(numbers)).toEqual([[3], [2, 1]]);
    expect(groups[1]).toMatchObject({ name: null, date: null });
  });

  // Review of 11.5: a draft (release-drafter keeps one) fills the page GitHub sends, so 99 published releases can still mean more exist.
  it("given 99 published releases and 1 draft (a full page from GitHub), when a PR was merged before the oldest published one, then it is in « older »", async () => {
    const ctx = await changelogCtx();
    release(ctx, {
      tag: "next",
      draft: true,
      publishedAt: "2026-11-01T00:00:00Z",
    });
    for (let i = 98; i >= 0; i--)
      release(ctx, {
        tag: `v${i}`,
        publishedAt: new Date(Date.UTC(2026, 6, 1 + i, 12)).toISOString(),
      });
    merged(ctx, 1, "feat: ancient", "2026-06-15T10:00:00Z");

    expect((await read(ctx)).groups.map((g) => g.kind)).toEqual(["older"]);
  });

  it("given 99 releases (all of them are known), when a PR was merged before the oldest, then it is under the oldest release", async () => {
    const ctx = await changelogCtx();
    for (let i = 98; i >= 0; i--)
      release(ctx, {
        tag: `v${i}`,
        publishedAt: new Date(Date.UTC(2026, 6, 1 + i, 12)).toISOString(),
      });
    merged(ctx, 1, "feat: ancient", "2026-06-15T10:00:00Z");

    expect((await read(ctx)).groups.map((g) => g.kind)).toEqual(["release"]);
  });

  it("given a story of ANOTHER project with the same PR number, when it is read, then the line carries no storyId", async () => {
    const ctx = await changelogCtx();
    const { storyId } = await bobsStory(ctx);
    await ctx.db.execute(
      sql`update user_stories set pr_number = 51 where id = ${storyId}`,
    );
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");

    expect((await read(ctx)).groups[0]?.entries[0]?.storyId).toBeNull();
  });

  it("given a failing /branches, when it is read, then 502 github_unavailable", async () => {
    const ctx = await changelogCtx();
    await story(ctx, { pr: 51, branch: "us/40-x" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z");
    branch(ctx, "us/40-x", 51);
    ctx.fetchMock.update({ failOn: ({ path }) => path.endsWith("/branches") });

    const res = await changelog(ctx);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });
});
