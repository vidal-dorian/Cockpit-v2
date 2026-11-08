import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Entry } from "./action.ts";
import type { Db } from "./db/db.ts";
import {
  history,
  nightItems,
  nights,
  runs,
  userStories,
  users,
} from "./db/schema.ts";
import { publish } from "./events.ts";
import type { ReadGitHub } from "./github.ts";
import { syncIssue } from "./issues.ts";
import { APP_FILES_KEPT, isTestPath } from "./pr-files.ts";
import { reserveStory } from "./queue.ts";
import { entryOf, type Fire, launchCloud } from "./routines.ts";
import type { memberStory } from "./stories.ts";

type Found = NonNullable<Awaited<ReturnType<typeof memberStory>>>;
type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
};
type Review = { login: string; state: string };

const FAILED = [
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
];

/** The CI of a PR from the check runs of its head commit (decision 038 E): none is null, one waiting is pending, one failed is failure, else success. */
function ciState(runs: CheckRun[]) {
  if (runs.length === 0) return null;
  if (runs.some((r) => r.conclusion && FAILED.includes(r.conclusion)))
    return "failure";
  if (runs.some((r) => r.status !== "completed")) return "pending";
  return "success";
}

/** The review of a PR from the last review of each reviewer, comments aside (decision 038 F). `reviews` is oldest first. */
function reviewState(reviews: Review[]) {
  const last = new Map<string, string>();
  for (const { login, state } of reviews)
    if (state !== "COMMENTED") last.set(login, state);
  const states = [...last.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  return null;
}

const LIVE = ["in_review", "in_progress"];
export const MAX_RELAUNCHES = 3;

/** The extra prompt of a relaunch (decision 059 C): check names are written by whoever owns the repo and reach Claude, so only plain characters are kept. */
const relaunchComment = (prNumber: number, runs: CheckRun[]) =>
  `The CI of pull request #${prNumber} failed: ${runs
    .filter((r) => r.conclusion && FAILED.includes(r.conclusion))
    .slice(0, 10)
    .map((r) => r.name.replace(/[^A-Za-z0-9 ._:/()-]/g, "").slice(0, 100))
    .join(", ")}. Fix it on this branch, then push.`;

/**
 * Reads the PR of a story on GitHub as the App and brings the story up to date (decision 038 B and D): a merge finishes it, a close without merge frees it, anything else only refreshes the CI and review caches.
 * A failed read throws before anything is written. The sync of the issue, the event and the automatic relaunch of a CI gone red (decision 059, only with `fire`) come after the commit.
 * A story of the night (decision 044 F') is relaunched once, whatever the setting, and left `ci_failed` at the second failure.
 */
export async function followPullRequest(
  db: Db,
  readGitHub: ReadGitHub,
  found: Found,
  userId: number,
  origin: "webhook" | "ui",
  fire?: Fire,
) {
  const { story, ticket, project } = found;
  const at = new Date(fire?.now?.() ?? Date.now());
  const prNumber = story.prNumber;
  if (prNumber === null) return;
  const ready = await readGitHub();
  if (!ready) throw new Error("The GitHub App is not configured");
  const pull = await ready.github.readPullFollow(
    project.installationId,
    project.fullName,
    prNumber,
  );
  const ci = ciState(pull.checkRuns);
  const review = reviewState(pull.reviews);
  // Read before the transaction so a failed read writes nothing (decision 050 C, E).
  const appPaths =
    story.kind === "takeover" && (pull.open || pull.merged)
      ? (
          await ready.github.readPullFiles(
            project.installationId,
            project.fullName,
            prNumber,
          )
        ).filter((path) => !isTestPath(path))
      : null;

  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(userStories)
      .where(eq(userStories.id, story.id))
      .for("update");
    // Another delivery got there first, or the PR was unlinked.
    if (!locked || locked.prNumber !== prNumber) return null;
    const set: Partial<typeof userStories.$inferInsert> = {};
    let action: string | null = null;
    if (pull.merged || !pull.open) {
      if (!LIVE.includes(locked.status)) return null;
      action = pull.merged ? "pull_request_merged" : "pull_request_closed";
      if (pull.merged) {
        // The last CI and review seen stay on the done story: no later delivery will update them.
        set.status = "done";
        set.prCiState = ci;
        set.prReviewState = review;
      } else {
        // A relaunch in progress keeps its status, only its PR goes.
        if (locked.status === "in_review") set.status = "ready";
        set.prNumber = null;
        set.prCiState = null;
        set.prReviewState = null;
        set.prAppFiles = null;
        set.prAppFilesCount = null;
      }
    } else {
      set.prCiState = ci;
      set.prReviewState = review;
      if (ci === "success") set.relaunchCount = 0;
    }
    // A merge keeps the list it reads here; a close without merge has just emptied it.
    if (appPaths && (pull.open || pull.merged)) {
      set.prAppFiles = appPaths.slice(0, APP_FILES_KEPT);
      set.prAppFilesCount = appPaths.length;
    }
    await tx
      .update(userStories)
      .set({ ...set, updatedAt: sql`now()` })
      .where(eq(userStories.id, story.id));
    if (action) {
      const entry: Entry = {
        userId,
        actor: "github",
        origin,
        action,
        args: { storyId: story.id, prNumber },
        projectId: project.id,
        ticketId: ticket.id,
        storyId: story.id,
      };
      await tx.insert(history).values({ ...entry, result: "ok" });
    }
    // The count itself moves in the launch (a refused one costs nothing); the owner of the last run is the one who asked for Claude.
    let relaunch: { by: number; branch: string; nightItemId?: number } | null =
      null;
    if (
      fire &&
      pull.open &&
      ci === "failure" &&
      locked.prCiState !== "failure" &&
      locked.status === "in_review" &&
      locked.branch
    ) {
      const [last] = await tx
        .select({
          userId: runs.userId,
          on: users.autoRelaunch,
          blockedAt: users.blockedAt,
        })
        .from(runs)
        .innerJoin(users, eq(users.id, runs.userId))
        .where(eq(runs.storyId, story.id))
        .orderBy(desc(runs.id))
        .limit(1);
      const [item] = await tx
        .select({
          id: nightItems.id,
          relaunched: sql<boolean>`exists (select 1 from cloud_launches where night_item_id = ${nightItems.id} and relaunch)`,
        })
        .from(nightItems)
        .innerJoin(nights, eq(nights.id, nightItems.nightId))
        .where(and(eq(nightItems.storyId, story.id), gt(nights.endsAt, at)))
        .orderBy(desc(nightItems.id))
        .limit(1);
      // A blocked owner is never launched for, as in the queue and the routines.
      if (last && !last.blockedAt) {
        if (item?.relaunched)
          await tx
            .update(nightItems)
            .set({ outcome: "ci_failed" })
            .where(eq(nightItems.id, item.id));
        else if (item)
          relaunch = {
            by: last.userId,
            branch: locked.branch,
            nightItemId: item.id,
          };
        else if (last.on && locked.relaunchCount < MAX_RELAUNCHES)
          relaunch = { by: last.userId, branch: locked.branch };
      }
    }
    return { transitioned: action !== null, relaunch };
  });
  if (!outcome) return;
  // Also when a relaunch keeps its status: the issue still shows the one it had before the PR.
  if (outcome.transitioned) await syncIssue(db, readGitHub, userId, story.id);
  await publish(db, project.id, [`story:${story.id}`]);
  // After the commit, never inside it: `/fire` is a network call. A refusal (a run is active, the project is not ticked) writes its entry and nothing else.
  if (fire && outcome.relaunch) {
    const { by, branch, nightItemId } = outcome.relaunch;
    await launchCloud(
      db,
      fire,
      {
        ...entryOf(by, "launch_story"),
        // Repeated for the type: `launchCloud` needs a user, `Entry` allows none.
        userId: by,
        actor: "system",
        origin: "system",
        projectId: project.id,
        ticketId: ticket.id,
        storyId: story.id,
        args: { storyId: story.id },
      },
      at,
      [project.id],
      async (tx) => {
        const reserved = await reserveStory(tx, at, story.id, project.id, {
          branch,
          comment: relaunchComment(prNumber, pull.checkRuns),
        });
        // The night's one relaunch is not one of the 3 of the setting (044 F').
        if (nightItemId === undefined)
          await tx
            .update(userStories)
            .set({ relaunchCount: sql`${userStories.relaunchCount} + 1` })
            .where(eq(userStories.id, story.id));
        return { ...reserved, relaunch: true, nightItemId };
      },
    );
  }
}
