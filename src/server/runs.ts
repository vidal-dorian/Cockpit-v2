import { and, asc, desc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  cloudLaunches,
  history,
  questions,
  runSteps,
  runs,
  userStories,
} from "./db/schema.ts";
import { publish, subscribe } from "./events.ts";
import type { ReadGitHub } from "./github.ts";
import { syncIssue } from "./issues.ts";
import { isDatabaseId } from "./projects.ts";
import { queueAfterRun } from "./queue.ts";
import type { Fire } from "./routines.ts";
import {
  changeStory,
  memberStory,
  storyParts,
  WrongStatus,
} from "./stories.ts";
import { assertActive } from "./tickets.ts";
import { runVerdict } from "./verdict.ts";

type Found = NonNullable<Awaited<ReturnType<typeof memberStory>>>;

/** PostgreSQL's unique violation, which drizzle wraps in its own error. */
export const isUniqueViolation = (error: unknown) =>
  [error, (error as { cause?: unknown } | null)?.cause].some(
    (e) => (e as { code?: unknown } | null)?.code === "23505",
  );

/** Tells the project's members, after the commit (decision 033 G). */
export const announce = (db: Db, found: Found, runId: number) =>
  publish(db, found.project.id, [`run:${runId}`, `story:${found.story.id}`]);

/** `start_run` (decision 033 B): a ready or in_review story gets a running run and goes in_progress with its branch. */
export async function startRun(
  db: Db,
  userId: number,
  readGitHub: ReadGitHub,
  entry: Entry,
  found: Found,
  args: { branch: string; model: string; comment?: string; launch_id?: number },
) {
  let runId = 0;
  try {
    const story = await changeStory(
      db,
      entry,
      found,
      ["ready", "in_review"],
      async (tx, locked) => {
        if (locked.branch && locked.branch !== args.branch)
          throw new Refused("branch_mismatch");
        const [run] = await tx
          .insert(runs)
          .values({
            storyId: locked.id,
            userId,
            status: "running",
            modelActual: args.model,
            comment: args.comment,
          })
          .returning({ id: runs.id })
          .catch((error) => {
            // The unique index has the last word, even when two starts race.
            throw isUniqueViolation(error) ? new Refused("run_active") : error;
          });
        if (!run) throw new Error("run not created");
        if (args.launch_id !== undefined) {
          const [launch] = await tx
            .select()
            .from(cloudLaunches)
            .where(
              and(
                eq(cloudLaunches.id, args.launch_id),
                eq(cloudLaunches.userId, userId),
                eq(cloudLaunches.storyId, locked.id),
              ),
            )
            .for("update");
          if (!launch) throw new Refused("launch_mismatch");
          if (launch.runId !== null) throw new Refused("launch_started");
          await tx
            .update(cloudLaunches)
            .set({ runId: run.id })
            .where(eq(cloudLaunches.id, launch.id));
        }
        runId = run.id;
        entry.runId = run.id;
        const [row] = await tx
          .update(userStories)
          .set({
            status: "in_progress",
            branch: args.branch,
            updatedAt: sql`now()`,
          })
          .where(eq(userStories.id, locked.id))
          .returning();
        if (!row) throw new Refused("not_found");
        return row;
      },
    );
    await syncIssue(db, readGitHub, userId, story.id);
    await announce(db, found, runId);
    const { criteria } = await storyParts(db, story.id);
    return { runId, story, criteria };
  } catch (error) {
    // The history already has the code; the text Claude reads must not talk about a rewrite.
    throw error instanceof WrongStatus ? new Refused("wrong_status") : error;
  }
}

/** One of the caller's runs with its story, or a journaled `not_found`; the entry gets every id it learns. */
export async function ownRun(db: Db, userId: number, entry: Entry, id: number) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)));
  const found = run && (await memberStory(db, userId, run.storyId));
  if (!run || !found)
    return act(db, entry, async () => {
      throw new Refused("not_found");
    });
  entry.projectId = found.project.id;
  entry.ticketId = found.ticket.id;
  entry.storyId = found.story.id;
  entry.runId = run.id;
  entry.args = { runId: run.id };
  return found;
}

/** Checks the project and locks the run, which must still run; answers it as locked. */
export async function lockRunning(tx: Tx, projectId: number, runId: number) {
  await assertActive(tx, projectId);
  const [run] = await tx
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .for("update");
  if (!run) throw new Refused("not_found");
  if (run.status !== "running") throw new Refused("run_finished");
  return run;
}

/** `report_step` (decision 033 C). */
export async function reportStep(
  db: Db,
  userId: number,
  entry: Entry,
  args: {
    run_id: number;
    agent: string;
    event: "started" | "finished";
    status?: "succeeded" | "failed";
    summary?: string;
  },
) {
  const found = await ownRun(db, userId, entry, args.run_id);
  const step = await act(db, entry, async (tx) => {
    const run = await lockRunning(tx, found.project.id, args.run_id);
    const stopRequested = run.stopRequestedAt !== null;
    const [open] = await tx
      .select({ id: runSteps.id })
      .from(runSteps)
      .where(
        and(
          eq(runSteps.runId, args.run_id),
          eq(runSteps.agent, args.agent),
          eq(runSteps.status, "running"),
        ),
      );
    if (args.event === "started") {
      if (open) throw new Refused("step_open");
      const [row] = await tx
        .insert(runSteps)
        .values({ runId: args.run_id, agent: args.agent, status: "running" })
        .returning({ id: runSteps.id });
      if (!row) throw new Error("step not created");
      return { ...row, stopRequested };
    }
    if (!open) throw new Refused("no_open_step");
    await tx
      .update(runSteps)
      .set({
        status: args.status ?? "failed",
        summary: args.summary,
        finishedAt: sql`now()`,
      })
      .where(eq(runSteps.id, open.id));
    return { ...open, stopRequested };
  });
  await announce(db, found, args.run_id);
  return { step_id: step.id, stop_requested: step.stopRequested };
}

/** `report_criterion` (decision 035 B): the report replaces the previous one of the criterion. */
export async function reportCriterion(
  db: Db,
  userId: number,
  entry: Entry,
  args: {
    run_id: number;
    criterion_id: number;
    result: "passed" | "failed";
    evidence: string;
  },
) {
  const found = await ownRun(db, userId, entry, args.run_id);
  await act(db, entry, async (tx) => {
    await lockRunning(tx, found.project.id, args.run_id);
    const changed = await tx
      .update(acceptanceCriteria)
      .set({
        result: args.result,
        evidence: args.evidence,
        resultRunId: args.run_id,
      })
      .where(
        and(
          eq(acceptanceCriteria.id, args.criterion_id),
          eq(acceptanceCriteria.storyId, found.story.id),
        ),
      )
      .returning({ id: acceptanceCriteria.id });
    if (changed.length === 0) throw new Refused("wrong_criterion");
  });
  await announce(db, found, args.run_id);
  return { criterion_id: args.criterion_id, result: args.result };
}

/** `link_pull_request` (decision 035 C): the PR is read on GitHub before the transaction, then the story goes in_review. */
export async function linkPullRequest(
  db: Db,
  userId: number,
  readGitHub: ReadGitHub,
  entry: Entry,
  args: { run_id: number; pr_number: number },
) {
  const found = await ownRun(db, userId, entry, args.run_id);
  const { project, story } = found;
  // Read before the transaction; a failure waits for `act`, which writes its one `error` entry.
  let pull: { branch: string; repo: string | null } | null = null;
  let failed: unknown;
  try {
    const ready = await readGitHub();
    if (!ready) throw new Error("The GitHub App is not configured");
    pull = await ready.github.readPullRequest(
      project.installationId,
      project.fullName,
      args.pr_number,
    );
  } catch (error) {
    failed = error;
  }
  const refusal = (code: string) =>
    act(db, entry, async () => {
      throw failed ?? new Refused(code);
    });
  if (failed || !pull) return refusal("pr_not_found");
  if (pull.branch !== story.branch || pull.repo !== project.fullName)
    return refusal("pr_wrong_branch");
  await act(db, entry, async (tx) => {
    await lockRunning(tx, project.id, args.run_id);
    const changed = await tx
      .update(userStories)
      .set({
        prNumber: args.pr_number,
        status: "in_review",
        // Another PR: what was read of the previous one is stale.
        ...(story.prNumber !== args.pr_number && {
          prCiState: null,
          prReviewState: null,
          prAppFiles: null,
          prAppFilesCount: null,
        }),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(userStories.id, story.id),
          eq(userStories.status, "in_progress"),
        ),
      )
      .returning({ id: userStories.id });
    if (changed.length === 0) throw new Refused("wrong_status");
  });
  await syncIssue(db, readGitHub, userId, story.id);
  await announce(db, found, args.run_id);
  return { pr_number: args.pr_number, story_status: "in_review" as const };
}

/** Ends a locked running run (decisions 033 D and 037 B, C): open steps close failed, and a story still in_progress goes back to in_review when it has a PR, else to ready. True when the story moved. */
async function endRun(
  tx: Tx,
  runId: number,
  storyId: number,
  run: Pick<typeof runs.$inferInsert, "status" | "summary">,
) {
  await tx
    .update(runSteps)
    .set({ status: "failed", finishedAt: sql`now()` })
    .where(and(eq(runSteps.runId, runId), eq(runSteps.status, "running")));
  await tx
    .update(runs)
    .set({ ...run, finishedAt: sql`now()` })
    .where(eq(runs.id, runId));
  const changed = await tx
    .update(userStories)
    .set({
      status: sql`case when ${userStories.prNumber} is null then 'ready' else 'in_review' end`,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(userStories.id, storyId), eq(userStories.status, "in_progress")),
    )
    .returning({ id: userStories.id });
  return changed.length > 0;
}

/** `finish_run` (decisions 033 D, 035 D and 037 C): success needs a linked PR; a failure after a stop request is `stopped`. */
export async function finishRun(
  db: Db,
  userId: number,
  readGitHub: ReadGitHub,
  entry: Entry,
  args: { run_id: number; outcome: "succeeded" | "failed"; summary: string },
) {
  const found = await ownRun(db, userId, entry, args.run_id);
  const { moved, status } = await act(db, entry, async (tx) => {
    const run = await lockRunning(tx, found.project.id, args.run_id);
    if (args.outcome === "succeeded") {
      const [row] = await tx
        .select({ prNumber: userStories.prNumber })
        .from(userStories)
        .where(eq(userStories.id, found.story.id));
      if (row?.prNumber == null) throw new Refused("no_pull_request");
    }
    const status =
      args.outcome === "failed" && run.stopRequestedAt
        ? "stopped"
        : args.outcome;
    const moved = await endRun(tx, args.run_id, found.story.id, {
      status,
      summary: args.summary,
    });
    return { moved, status };
  });
  if (moved) await syncIssue(db, readGitHub, userId, found.story.id);
  await announce(db, found, args.run_id);
  return { run_id: args.run_id, status };
}

const CONFLICTS = [
  "run_finished",
  "stop_already_requested",
  "project_archived",
];

/** The running run of a story, for `get_user_story`. */
export async function activeRunId(db: Db, storyId: number) {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.storyId, storyId), eq(runs.status, "running")));
  return run?.id ?? null;
}

/** The runs of a story, most recent first. */
export const storyRuns = (db: Db, storyId: number) =>
  db
    .select({
      id: runs.id,
      status: runs.status,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(eq(runs.storyId, storyId))
    .orderBy(desc(runs.id));

export function runRoutes(
  db: Db,
  readGitHub: ReadGitHub,
  deps: Fire,
  now: () => number,
) {
  /** The human controls of a running run (decision 037 A, B): one `act`, then the members and the issue are told. */
  const control =
    (action: "request_stop" | "close_run") => async (c: Context) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const id = Number(c.req.param("id"));
      const [run] = isDatabaseId(id)
        ? await db.select().from(runs).where(eq(runs.id, id))
        : [];
      const found = run && (await memberStory(db, user.userId, run.storyId));
      if (!found) return c.json({ error: "Not found" }, 404);
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action,
        args: { runId: id },
        projectId: found.project.id,
        ticketId: found.ticket.id,
        storyId: found.story.id,
        runId: id,
      };
      try {
        const { moved, stopRequestedAt, status } = await act(
          db,
          entry,
          async (tx) => {
            const locked = await lockRunning(tx, found.project.id, id);
            if (action === "request_stop") {
              if (locked.stopRequestedAt)
                throw new Refused("stop_already_requested");
              const [row] = await tx
                .update(runs)
                .set({ stopRequestedAt: sql`now()` })
                .where(eq(runs.id, id))
                .returning({ at: runs.stopRequestedAt });
              return {
                moved: false,
                stopRequestedAt: row?.at ?? null,
                status: locked.status,
              };
            }
            const moved = await endRun(tx, id, found.story.id, {
              status: "closed_manually",
            });
            return {
              moved,
              stopRequestedAt: locked.stopRequestedAt,
              status: "closed_manually" as const,
            };
          },
        );
        if (moved) await syncIssue(db, readGitHub, user.userId, found.story.id);
        await announce(db, found, id);
        if (action === "close_run")
          await queueAfterRun(db, deps, id, new Date(now()));
        return c.json({ run: { id, status, stopRequestedAt } });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return CONFLICTS.includes(error.message)
          ? c.json({ error: error.message }, 409)
          : c.json({ error: "Not found" }, 404);
      }
    };
  return new Hono()
    .post("/api/runs/:id/stop", control("request_stop"))
    .post("/api/runs/:id/close", control("close_run"))
    .get("/api/runs/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const id = Number(c.req.param("id"));
      const [run] = isDatabaseId(id)
        ? await db.select().from(runs).where(eq(runs.id, id))
        : [];
      const found = run && (await memberStory(db, user.userId, run.storyId));
      if (!run || !found) return c.json({ error: "Not found" }, 404);
      const steps = await db
        .select({
          id: runSteps.id,
          agent: runSteps.agent,
          status: runSteps.status,
          summary: runSteps.summary,
          startedAt: runSteps.startedAt,
          finishedAt: runSteps.finishedAt,
        })
        .from(runSteps)
        .where(eq(runSteps.runId, run.id))
        .orderBy(asc(runSteps.id));
      const [launch] = await db
        .select({
          sessionUrl: cloudLaunches.sessionUrl,
          costUsd: cloudLaunches.costUsd,
        })
        .from(cloudLaunches)
        .where(eq(cloudLaunches.runId, run.id));
      const [stop] = await db
        .select({ detail: history.detail })
        .from(history)
        .where(
          and(
            eq(history.runId, run.id),
            eq(history.action, "request_stop"),
            eq(history.actor, "system"),
            eq(history.result, "ok"),
          ),
        );
      const asked = await db
        .select({
          id: questions.id,
          question: questions.question,
          suggestedAnswers: questions.suggestedAnswers,
          answer: questions.answer,
          askedAt: questions.askedAt,
          answeredAt: questions.answeredAt,
        })
        .from(questions)
        .where(eq(questions.runId, run.id))
        .orderBy(asc(questions.id));
      // The result and the evidence are those this run gave, nothing of the others (decision 035 E).
      const parts = (await storyParts(db, found.story.id)).criteria;
      const criteria = parts.map((k) => {
        const mine = k.resultRunId === run.id;
        return {
          id: k.id,
          position: k.position,
          given: k.givenText,
          when: k.whenText,
          // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
          then: k.thenText,
          result: mine ? k.result : null,
          evidence: mine ? k.evidence : null,
        };
      });
      return c.json({
        run: {
          id: run.id,
          status: run.status,
          branch: found.story.branch,
          model: run.modelActual,
          comment: run.comment,
          stopRequestedAt: run.stopRequestedAt,
          summary: run.summary,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
        cloud: launch ? { sessionUrl: launch.sessionUrl } : null,
        // A local run has no cost (decision 060 B); 0 is a cloud run no point reached yet, which the page cannot tell from none.
        costUsd: launch && launch.costUsd > 0 ? launch.costUsd : null,
        stopReason: stop?.detail?.reason === "budget" ? "budget" : null,
        steps,
        questions: asked,
        criteria,
        verdict:
          run.status === "running" ? null : runVerdict(run, found.story, parts),
        story: {
          id: found.story.id,
          iWant: found.story.iWant,
          status: found.story.status,
          prNumber: found.story.prNumber,
          prCiState: found.story.prCiState,
          prReviewState: found.story.prReviewState,
          kind: found.story.kind,
          prAppFiles: found.story.prAppFiles,
          prAppFilesCount: found.story.prAppFilesCount,
        },
        project: {
          id: found.project.id,
          name: found.project.fullName,
          archived: found.project.archivedAt !== null,
        },
      });
    })
    .get("/api/events", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      return streamSSE(c, async (stream) => {
        const unsubscribe = subscribe(user.userId, (key) => {
          stream.writeSSE({ event: "change", data: key }).catch(() => {});
        });
        stream.onAbort(unsubscribe);
        // A comment every 25 s keeps the connection open behind Cloudflare (decision 033 G).
        while (!stream.aborted) {
          await stream.sleep(25_000);
          await stream.write(": keep-alive\n\n");
        }
      });
    });
}
