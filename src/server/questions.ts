import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { questions, runs } from "./db/schema.ts";
import { isDatabaseId } from "./projects.ts";
import { announce, isUniqueViolation, lockRunning, ownRun } from "./runs.ts";
import { memberStory } from "./stories.ts";
import { body, noNul } from "./tickets.ts";

/** `ask_user` (decision 036 B): one pending question per run, the unique index having the last word. */
export async function askUser(
  db: Db,
  userId: number,
  entry: Entry,
  args: { run_id: number; question: string; suggested_answers?: string[] },
) {
  const found = await ownRun(db, userId, entry, args.run_id);
  const [row] = await act(db, entry, async (tx) => {
    await lockRunning(tx, found.project.id, args.run_id);
    return tx
      .insert(questions)
      .values({
        runId: args.run_id,
        question: args.question,
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
  const row = await act(db, entry, async (tx) => {
    const [current] = await tx
      .select({ answer: questions.answer })
      .from(questions)
      .where(eq(questions.id, args.question_id));
    return current;
  });
  // Asking for a stop comes with slice 7.5.
  return {
    answered: row?.answer != null,
    answer: row?.answer ?? null,
    stop_requested: false,
  };
}

const answerBody = z.object({
  answer: z.string().min(1).max(10_000).refine(noNul),
});

const CONFLICTS = ["already_answered", "run_finished", "project_archived"];

/** Behind the gate of `projectRoutes` (503 before the session check), which also covers /api/questions/*. */
export function questionRoutes(db: Db) {
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
      try {
        await act(db, entry, async (tx) => {
          await lockRunning(tx, found.project.id, run.id);
          // Locked, so two answers cannot both win.
          const [locked] = await tx
            .select({ answer: questions.answer })
            .from(questions)
            .where(eq(questions.id, id))
            .for("update");
          if (!locked) throw new Refused("not_found");
          if (locked.answer !== null) throw new Refused("already_answered");
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
      return c.json({ question: { id, answer: c.req.valid("json").answer } });
    },
  );
}
