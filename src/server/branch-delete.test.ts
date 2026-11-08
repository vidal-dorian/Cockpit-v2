import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bobsStory,
  branch,
  type CCtx,
  calls,
  changelogCtx,
  deleteBranch,
  gitOf,
  merged,
  story,
} from "./test-changelog.ts";
import { archiveProject, rows } from "./test-mcp.ts";

// Slice 11.5 (decision 062 E): POST /api/stories/:id/branch/delete. The contract is pinned in test-changelog.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

const B = "us/40-x";

/** A done story, its merged PR 51 and its branch still at the head of that PR: nothing stands in the way of the deletion. */
async function ready() {
  const ctx = await changelogCtx();
  const id = await story(ctx, { pr: 51, branch: B });
  merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z", { headRef: B });
  branch(ctx, B, 51);
  return { ctx, id };
}

const refused = async (ctx: CCtx, id: number, code: string, status = 409) => {
  const res = await deleteBranch(ctx, id);
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: code });
  expect(gitOf(ctx).refsDeleted).toEqual([]);
  expect(gitOf(ctx).branch(B)).not.toBeUndefined();
};

describe("E: the members and the project", () => {
  it("given no session, when a branch is deleted, then 401 and nothing is deleted", async () => {
    const { ctx, id } = await ready();
    const res = await deleteBranch(ctx, id, "");
    expect(res.status).toBe(401);
    expect(gitOf(ctx).refsDeleted).toEqual([]);
  });

  it("given a story, when a non-member deletes its branch, then 404 and nothing is deleted, while a member can", async () => {
    const { ctx, id } = await ready();
    const { bob } = await bobsStory(ctx);

    const res = await deleteBranch(ctx, id, bob.cookie);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(gitOf(ctx).refsDeleted).toEqual([]);
    expect((await deleteBranch(ctx, id)).status).toBe(204);
  });

  it("given an archived project, when the branch is deleted, then 409 project_archived without calling GitHub", async () => {
    const { ctx, id } = await ready();
    await archiveProject(ctx.db, ctx.projectId);
    const before = calls(ctx, "GET", /./).length;

    await refused(ctx, id, "project_archived");

    expect(calls(ctx, "GET", /./).length).toBe(before);
  });
});

describe("E: each refusal is re-checked on GitHub, and nothing is deleted", () => {
  it("given a story that is not done, when the branch is deleted, then 409 pr_not_merged", async () => {
    const { ctx } = await ready();
    const id = await story(ctx, {
      status: "in_review",
      pr: 52,
      branch: "us/41-x",
    });
    merged(ctx, 52, "feat: b", "2026-11-05T10:00:00Z", { headRef: "us/41-x" });
    branch(ctx, "us/41-x", 52);
    const res = await deleteBranch(ctx, id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "pr_not_merged" });
    expect(gitOf(ctx).refsDeleted).toEqual([]);
  });

  it("given a done story whose PR GitHub says is not merged, when the branch is deleted, then 409 pr_not_merged", async () => {
    const { ctx, id } = await ready();
    const pull = gitOf(ctx).pulls[0];
    if (pull) Object.assign(pull, { merged: false, mergedAt: null });
    await refused(ctx, id, "pr_not_merged");
  });

  it("given a branch already deleted on GitHub, when the delete is asked, then 409 branch_gone", async () => {
    const { ctx, id } = await ready();
    gitOf(ctx)._otherBranches.delete(B);
    const res = await deleteBranch(ctx, id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "branch_gone" });
    expect(gitOf(ctx).refsDeleted).toEqual([]);
  });

  it("given a protected branch, when the delete is asked, then 409 branch_protected", async () => {
    const { ctx, id } = await ready();
    gitOf(ctx).protectedBranches.add(B);
    await refused(ctx, id, "branch_protected");
  });

  it("given a story whose branch is the default branch, when the delete is asked, then 409 branch_protected", async () => {
    const ctx = await changelogCtx();
    const id = await story(ctx, { pr: 51, branch: "main" });
    merged(ctx, 51, "feat: a", "2026-11-05T10:00:00Z", { headRef: "main" });
    const res = await deleteBranch(ctx, id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "branch_protected" });
    expect(gitOf(ctx).refsDeleted).toEqual([]);
  });

  it("given a commit pushed to the branch after the merge, when the delete is asked, then 409 branch_has_new_commits", async () => {
    const { ctx, id } = await ready();
    branch(ctx, B, "f".repeat(40));
    await refused(ctx, id, "branch_has_new_commits");
  });

  it("given an open PR that starts from the branch, when the delete is asked, then 409 branch_has_open_pr", async () => {
    const { ctx, id } = await ready();
    merged(ctx, 60, "feat: again", "2026-11-06T10:00:00Z", {
      state: "open",
      merged: false,
      mergedAt: null,
      headRef: B,
    });
    await refused(ctx, id, "branch_has_open_pr");
  });

  it("given GitHub failing during the re-check, when the delete is asked, then 502 github_unavailable and nothing is deleted", async () => {
    const { ctx, id } = await ready();
    ctx.fetchMock.update({ failOn: ({ method }) => method === "GET" });
    await refused(ctx, id, "github_unavailable", 502);
  });

  it("given a refusal, when it happens, then one refused entry delete_branch with the reason is left, and never the branch name", async () => {
    const { ctx, id } = await ready();
    gitOf(ctx).protectedBranches.add(B);
    await deleteBranch(ctx, id);
    const entries = (await rows(ctx.db)).filter(
      (r) => r.action === "delete_branch",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      result: "refused",
      story_id: id,
      detail: { reason: "branch_protected" },
    });
    expect(JSON.stringify(await rows(ctx.db))).not.toContain(B);
  });
});

describe("E: the deletion", () => {
  it("given nothing in the way, when the member deletes the branch, then 204 and the reference is deleted on GitHub", async () => {
    const { ctx, id } = await ready();

    const res = await deleteBranch(ctx, id);

    expect(res.status).toBe(204);
    expect(gitOf(ctx).refsDeleted).toEqual([B]);
    expect(gitOf(ctx).branch(B)).toBeUndefined();
  });

  it("given a deletion, when it is done, then one ok entry delete_branch { storyId } is written by the member from the page, and the branch name is nowhere in the history", async () => {
    const { ctx, id } = await ready();

    await deleteBranch(ctx, id);

    const entries = (await rows(ctx.db)).filter(
      (r) => r.action === "delete_branch",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      story_id: id,
      result: "ok",
      args: { storyId: id },
    });
    expect(JSON.stringify(await rows(ctx.db))).not.toContain(B);
  });
});
