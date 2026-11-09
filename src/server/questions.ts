import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { questions, runSteps, runs, users } from "./db/schema.ts";
import { isDatabaseId } from "./projects.ts";
import { reserveStory } from "./queue.ts";
import { entryOf, type LiveFire, launchCloud } from "./routines.ts";
import { announce, isUniqueViolation, lockRunning, ownRun } from "./runs.ts";
import { memberStory } from "./stories.ts";
import { body, noNul } from "./tickets.ts";

/** `ask_user` (decision 036 B): one pending question per run, the unique index having the last word. */
export async function askUser(
  db: Db,
  userId: number,
  entry: Entry,
  args: {
    run_id: number;
    question: string;
    context?: string;
    suggested_answers?: string[];
  },
) {
  const found = await ownRun(db, userId, entry, args.run_id);
  const [row] = await act(db, entry, async (tx) => {
    await lockRunning(tx, found.project.id, args.run_id);
    const [open] = await tx
      .select({ agent: runSteps.agent })
      .from(runSteps)
      .where(
        and(eq(runSteps.runId, args.run_id), eq(runSteps.status, "running")),
      )
      .orderBy(desc(runSteps.id))
      .limit(1);
    return tx
      .insert(questions)
      .values({
        runId: args.run_id,
        question: args.question,
        context: args.context,
        agent: open?.agent,
        suggestedAnswers: args.suggested_answers,
      })
      .returning({ id: questions.id })
      .catch((error) => {
        throw isUniqueViolation(error)
          ? new Refused("question_pending")
          : error;
      });
  });
  if (!row) throw new Error("question not created");
  await announce(db, found, args.run_id);
  return { question_id: row.id };
}

/** `get_answer` (decision 036 C): a read, so no check on the run or the project; every call leaves its entry. */
export async function getAnswer(
  db: Db,
  userId: number,
  entry: Entry,
  args: { question_id: number },
) {
  const [asked] = await db
    .select({ runId: questions.runId })
    .from(questions)
    .where(eq(questions.id, args.question_id));
  if (!asked)
    return act(db, entry, async () => {
      throw new Refused("not_found");
    });
  await ownRun(db, userId, entry, asked.runId);
  const { row, stopped } = await act(db, entry, async (tx) => {
    const [current] = await tx
      .select({ answer: questions.answer })
      .from(questions)
      .where(eq(questions.id, args.question_id));
    const [run] = await tx
      .select({ at: runs.stopRequestedAt })
      .from(runs)
      .where(eq(runs.id, asked.runId));
    return { row: current, stopped: run?.at != null };
  });
  return {
    answered: row?.answer != null,
    answer: row?.answer ?? null,
    stop_requested: stopped,
  };
}

const answerBody = z.object({
  answer: z.string().min(1).max(10_000).refine(noNul),
});

const CONFLICTS = ["already_answered", "run_finished", "project_archived"];

/** Not behind the gate of `projectRoutes`: it never reads GitHub, like /api/runs/:id. The answer to the question of a paused night run relaunches its story by day (decision 044 E). */
export function questionRoutes(db: Db, deps: LiveFire) {
  return new Hono().post(
    "/api/questions/:id/answer",
    body(answerBody),
    async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const id = Number(c.req.param("id"));
      const [asked] = isDatabaseId(id)
        ? await db
            .select({ runId: questions.runId })
            .from(questions)
            .where(eq(questions.id, id))
        : [];
      const [run] = asked
        ? await db.select().from(runs).where(eq(runs.id, asked.runId))
        : [];
      const found = run && (await memberStory(db, user.userId, run.storyId));
      if (!found) return c.json({ error: "Not found" }, 404);
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "answer_question",
        args: { questionId: id },
        projectId: found.project.id,
        ticketId: found.ticket.id,
        storyId: found.story.id,
        runId: run.id,
      };
      let question = "";
      try {
        await act(db, entry, async (tx) => {
          await lockRunning(tx, found.project.id, run.id, [
            "running",
            "paused",
          ]);
          // Locked, so two answers cannot both win.
          const [locked] = await tx
            .select({ answer: questions.answer, question: questions.question })
            .from(questions)
            .where(eq(questions.id, id))
            .for("update");
          if (!locked) throw new Refused("not_found");
          if (locked.answer !== null) throw new Refused("already_answered");
          question = locked.question;
          await tx
            .update(questions)
            .set({ answer: c.req.valid("json").answer, answeredAt: sql`now()` })
            .where(eq(questions.id, id));
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return CONFLICTS.includes(error.message)
          ? c.json({ error: error.message }, 409)
          : c.json({ error: "Not found" }, 404);
      }
      await announce(db, found, run.id);
      const { answer } = c.req.valid("json");
      const { branch } = found.story;
      // A blocked owner is never launched for, as in the queue and the routines.
      const [owner] = await db
        .select({ blockedAt: users.blockedAt })
        .from(users)
        .where(eq(users.id, run.userId));
      if (run.status === "paused" && branch && !owner?.blockedAt) {
        const at = new Date(deps.now());
        // The launcher is the owner of the run's, who may not be the one answering; the answer stays saved when the launch is refused.
        const launched = await launchCloud(
          db,
          deps,
          {
            ...entryOf(run.userId, "launch_story"),
            userId: run.userId,
            actor: "system",
            origin: "system",
            projectId: found.project.id,
            ticketId: found.ticket.id,
            storyId: found.story.id,
            args: { storyId: found.story.id },
          },
          at,
          [found.project.id],
          (tx) =>
            reserveStory(tx, at, found.story.id, found.project.id, {
              branch,
              comment: `You asked: ${question}\nThe user answered: ${answer}`,
            }),
        );
        if ("error" in launched)
          return c.json(
            { error: launched.error, answerSaved: true },
            launched.status,
          );
      }
      return c.json({ question: { id, answer } });
    },
  );
}
