import { eq, sql } from "drizzle-orm";
import type { Entry } from "./action.ts";
import type { Db } from "./db/db.ts";
import { history, userStories } from "./db/schema.ts";
import { publish } from "./events.ts";
import type { ReadGitHub } from "./github.ts";
import { syncIssue } from "./issues.ts";
import { APP_FILES_KEPT, isTestPath } from "./pr-files.ts";
import type { memberStory } from "./stories.ts";

type Found = NonNullable<Awaited<ReturnType<typeof memberStory>>>;
type CheckRun = { status: string; conclusion: string | null };
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

/**
 * Reads the PR of a story on GitHub as the App and brings the story up to date (decision 038 B and D): a merge finishes it, a close without merge frees it, anything else only refreshes the CI and review caches.
 * A failed read throws before anything is written. The sync of the issue and the event come after the commit.
 */
export async function followPullRequest(
  db: Db,
  readGitHub: ReadGitHub,
  found: Found,
  userId: number,
  origin: "webhook" | "ui",
) {
  const { story, ticket, project } = found;
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
    return { transitioned: action !== null };
  });
  if (!outcome) return;
  // Also when a relaunch keeps its status: the issue still shows the one it had before the PR.
  if (outcome.transitioned) await syncIssue(db, readGitHub, userId, story.id);
  await publish(db, project.id, [`story:${story.id}`]);
}
