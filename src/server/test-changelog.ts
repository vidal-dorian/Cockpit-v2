import { sql } from "drizzle-orm";
import { bobsStory, send } from "./test-decisions.ts";
import { type FakePull, type FakeRelease, githubCalls } from "./test-github.ts";
import {
  type StoryStatus,
  seedStory,
  seedTicket,
  withProject,
} from "./test-mcp.ts";

// Shared by the tests of slice 11.5 (decision 062): the changelog and the branches to clean.
//
// Pinned contract (the decision leaves it open):
// - GET /api/projects/:id/changelog -> 200
//   { groups: [{ kind: "unreleased" | "release" | "day", name: string | null, date: string | null,
//                entries: [{ number, title, fix, storyId }] }],
//     branches: [{ storyId, branch, prNumber }] }
//   `groups`: "Pas encore publiée" first (kind "unreleased", name null, date null), then the releases that have at least one PR, newest first
//   (kind "release", name = the name of the release or its tag when it has none, date = its published_at, an instant); a repo with no published
//   release has one group per merge day instead, newest first (kind "day", name null, date "YYYY-MM-DD", the UTC day of the merge).
//   `entries` newest merge first; `title` without its conventional prefix; `fix` true when the conventional type is `fix`; `storyId` the id of
//   the story of the project whose pr_number is the PR, else null.
//   `branches` (decision 062 D): the done stories with a merged PR whose branch is still on GitHub, as { storyId, branch, prNumber }, in the order of the stories' ids.
//   401 { error: "Unauthorized" }, 404 { error: "Not found" } (not a member), 502 { error: "github_unavailable" }. No history entry.
// - POST /api/stories/:id/branch/delete, no body -> 204, no body. Refusals 409 { error: <code> } checked in this order:
//   project_archived (before any call to GitHub), pr_not_merged, branch_gone, branch_protected, branch_has_new_commits, branch_has_open_pr;
//   401 / 404 as above; 502 { error: "github_unavailable" } when the re-check fails (nothing is deleted).
//   History: action delete_branch, actor human, origin ui, args { storyId }, story_id, project_id, user_id, result ok; a refusal leaves
//   one entry with result refused and detail { reason: <code> }. The branch name is never in the history.

export const REPO = "user1000/app";

/** Alice's project with a fake Git repo `user1000/app` (default branch main) so that its pull requests, releases and branches can be seeded. */
export const changelogCtx = () => withProject({ gitRepos: { [REPO]: {} } });
export type CCtx = Awaited<ReturnType<typeof changelogCtx>>;

export const gitOf = (ctx: CCtx) => ctx.fetchMock.git(REPO);

const sha = (n: number) => n.toString(16).padStart(40, "0");

/** A pull request merged into main at `mergedAt` (ISO). */
export function merged(
  ctx: CCtx,
  number: number,
  title: string,
  mergedAt: string,
  over: Partial<FakePull> = {},
) {
  gitOf(ctx).pulls.push({
    number,
    title,
    state: "closed",
    merged: true,
    mergedAt,
    updatedAt: mergedAt,
    base: "main",
    headRef: `us/${number}-x`,
    headSha: sha(number),
    ...over,
  });
}

export const release = (ctx: CCtx, r: FakeRelease) =>
  gitOf(ctx).releases.push(r);

/** A branch on GitHub at `at` (default: the head sha `merged` gave the PR of that number). */
export const branch = (ctx: CCtx, name: string, at: string | number) =>
  gitOf(ctx)._otherBranches.set(name, typeof at === "number" ? sha(at) : at);

/** A done story of Alice's project with its PR and branch recorded (raw SQL: pr_number and branch are columns of user_stories). */
export async function story(
  ctx: CCtx,
  v: {
    status?: StoryStatus;
    pr?: number | null;
    branch?: string | null;
  } = {},
) {
  const ticketId = await seedTicket(ctx.db, ctx.projectId, "Le ticket");
  const id = await seedStory(ctx.db, ticketId, { status: v.status ?? "done" });
  await ctx.db.execute(
    sql`update user_stories set pr_number = ${v.pr ?? null}, branch = ${v.branch ?? null} where id = ${id}`,
  );
  return id;
}

export const changelog = (
  ctx: CCtx,
  projectId = ctx.projectId,
  cookie = ctx.alice.cookie,
) =>
  ctx.app.request(`/api/projects/${projectId}/changelog`, {
    headers: cookie ? { cookie } : {},
  });

export type Group = {
  kind: string;
  name: string | null;
  date: string | null;
  entries: {
    number: number;
    title: string;
    fix: boolean;
    storyId: number | null;
  }[];
};
export type Changelog = {
  groups: Group[];
  branches: { storyId: number; branch: string; prNumber: number }[];
};
export async function read(ctx: CCtx) {
  const res = await changelog(ctx);
  expectOk(res);
  return (await res.json()) as Changelog;
}
function expectOk(res: Response) {
  if (res.status !== 200) throw new Error(`changelog answered ${res.status}`);
}

export const deleteBranch = (
  ctx: CCtx,
  id: number,
  cookie = ctx.alice.cookie,
) => send(ctx.app, cookie, "POST", `/api/stories/${id}/branch/delete`);

export const calls = (ctx: CCtx, method: string, pattern: RegExp) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.method === method && pattern.test(c.path),
  );

export { bobsStory };
