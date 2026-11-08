import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { tickets, userStories } from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { memberProject } from "./projects.ts";
import { memberStory } from "./stories.ts";

// Decision 062 (slice 11.5): what the project delivered, read live from GitHub, and the branches of merged stories to clean.

const RELEASES_MAX = 100;
type Pull = { number: number; title: string; mergedAt: number };
type Group = {
  kind: "unreleased" | "release" | "day" | "older";
  name: string | null;
  date: string | null;
  entries: ReturnType<typeof line>[];
};

/** `feat(11.1): Add it` -> `Add it`; a `fix` type is flagged (decision 062 C). */
const TITLE =
  /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(?:\([^)]*\))?!?:\s*(.+)$/is;

const line = (pull: Pull, storyId: number | null) => {
  const [, type, rest] = TITLE.exec(pull.title) ?? [];
  return {
    number: pull.number,
    title: rest || pull.title,
    fix: type?.toLowerCase() === "fix",
    storyId,
  };
};

/** Decision 062 B: under the first release published after the merge, else "unreleased"; with no release at all, by UTC merge day. Newest first everywhere. */
function group(
  pulls: Pull[],
  releases: { tag: string; name: string; publishedAt: number }[],
  storyOf: (number: number) => number | null,
) {
  const groups = new Map<string, Group>();
  const newest = [...pulls].sort((a, b) => b.mergedAt - a.mergedAt);
  const oldestFirst = [...releases].sort(
    (a, b) => a.publishedAt - b.publishedAt,
  );
  for (const pull of newest) {
    const release = oldestFirst.find((r) => r.publishedAt > pull.mergedAt);
    const day = new Date(pull.mergedAt).toISOString().slice(0, 10);
    // With 100 releases the list may be cut: a PR merged before the oldest one read may belong to an older release that was not read, so it is not placed under any.
    const cut =
      releases.length >= RELEASES_MAX &&
      oldestFirst[0] !== undefined &&
      pull.mergedAt < oldestFirst[0].publishedAt;
    const [key, made]: [string, Group] =
      releases.length === 0
        ? [day, { kind: "day", name: null, date: day, entries: [] }]
        : cut
          ? ["older", { kind: "older", name: null, date: null, entries: [] }]
          : release
            ? [
                `tag:${release.tag}`,
                {
                  kind: "release",
                  name: release.name,
                  date: new Date(release.publishedAt).toISOString(),
                  entries: [],
                },
              ]
            : ["", { kind: "unreleased", name: null, date: null, entries: [] }];
    const target = groups.get(key) ?? made;
    groups.set(key, target);
    target.entries.push(line(pull, storyOf(pull.number)));
  }
  // Already in order: the PRs come newest first and the release of a PR never gets older as the merge does (the unreleased group is the newest).
  return [...groups.values()];
}

/** Behind the gate of `projectRoutes` (503 before the session check). */
export function changelogRoutes(db: Db, readGitHub: ReadGitHub) {
  const ready = async () => {
    const found = await readGitHub();
    if (!found) throw new Error("The GitHub App is not configured");
    return found.github;
  };

  return new Hono()
    .get("/api/projects/:id/changelog", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const stories = await db
        .select({
          id: userStories.id,
          prNumber: userStories.prNumber,
          branch: userStories.branch,
          status: userStories.status,
        })
        .from(userStories)
        .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
        .where(
          and(
            eq(tickets.projectId, project.id),
            isNotNull(userStories.prNumber),
          ),
        )
        .orderBy(asc(userStories.id));
      try {
        const github = await ready();
        // One after the other: with Promise.all a failure would leave the others running after the answer.
        const pulls = (
          await github.listMergedPulls(
            project.installationId,
            project.fullName,
            project.defaultBranch,
          )
        ).map((p) => ({
          number: p.number,
          title: p.title,
          mergedAt: Date.parse(p.merged_at as string),
        }));
        const releases = (
          await github.listReleases(project.installationId, project.fullName)
        ).map((r) => ({ ...r, publishedAt: Date.parse(r.publishedAt) }));
        const mergedNumbers = new Set(pulls.map((p) => p.number));
        const toClean = stories.filter(
          (s) =>
            s.status === "done" &&
            s.branch !== null &&
            s.branch !== project.defaultBranch &&
            mergedNumbers.has(s.prNumber as number),
        );
        const onGitHub =
          toClean.length === 0
            ? new Set<string>()
            : new Set(
                (
                  await github.listBranches(
                    project.installationId,
                    project.fullName,
                  )
                ).map((b) => b.name),
              );
        const storyOf = new Map(stories.map((s) => [s.prNumber, s.id]));
        return c.json({
          repo: project.fullName,
          groups: group(pulls, releases, (n) => storyOf.get(n) ?? null),
          branches: toClean
            .filter((s) => onGitHub.has(s.branch as string))
            .map((s) => ({
              storyId: s.id,
              branch: s.branch as string,
              prNumber: s.prNumber as number,
            })),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/stories/:id/branch/delete", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const found = await memberStory(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json({ error: "Not found" }, 404);
      const { story, ticket, project } = found;
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "delete_branch",
        args: { storyId: story.id },
        projectId: project.id,
        ticketId: ticket.id,
        storyId: story.id,
      };
      const record = async (error: unknown) => {
        try {
          await act(db, entry, async () => {
            throw error;
          });
        } catch (thrown) {
          if (thrown !== error) throw thrown;
        }
      };
      // Before any call to GitHub, and outside any transaction.
      if (project.archivedAt) {
        await record(new Refused("project_archived"));
        return c.json({ error: "project_archived" }, 409);
      }
      const { prNumber, branch } = story;
      try {
        if (story.status !== "done" || prNumber === null || branch === null)
          throw new Refused("pr_not_merged");
        // Everything is read again on GitHub: the page is not believed (decision 062 E).
        const github = await ready();
        const live = await github.readBranchToDelete(
          project.installationId,
          project.fullName,
          prNumber,
          branch,
        );
        if (!live.merged) throw new Refused("pr_not_merged");
        if (!live.branch) throw new Refused("branch_gone");
        if (live.branch.protected || branch === project.defaultBranch)
          throw new Refused("branch_protected");
        if (live.branch.sha !== live.pullHeadSha)
          throw new Refused("branch_has_new_commits");
        if (live.hasOpenPull) throw new Refused("branch_has_open_pr");
        // shortcut: a push landing between the re-check and this DELETE loses those commits from the ref (GitHub's REST DELETE takes no expected sha); they stay in the pusher's clone. Nothing to upgrade to.
        await github.deleteBranch(
          project.installationId,
          project.fullName,
          branch,
        );
      } catch (error) {
        await record(error);
        if (error instanceof Refused)
          return c.json({ error: error.message }, 409);
        return c.json({ error: "github_unavailable" }, 502);
      }
      await act(db, entry, async () => {});
      return c.body(null, 204);
    });
}
