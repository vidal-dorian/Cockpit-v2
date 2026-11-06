// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { all, type Ctx, finish, running, tool } from "./test-criteria.ts";
import { type App, dataOf, type TestDb } from "./test-mcp.ts";

// Shared by the tests of slice 7.4 (decision 036). Pinned where the decision leaves room:
// - ask_user({ run_id, question, suggested_answers? }) answers { question_id };
// - get_answer({ question_id }) answers { answered, answer, stop_requested };
// - raw SQL reads: questions(id, run_id, question, suggested_answers jsonb | null, answer, asked_at, answered_at),
//   history.run_id;
// - POST /api/questions/:id/answer { answer } -> 200 { question: { id, answer } }; errors are { error: <code> }
//   with 400 "Bad request", 404 "Not found", 409 "already_answered" | "run_finished" | "project_archived";
// - refusal codes of the tools are in history.detail.reason.

export type { Ctx };
export { all, finish, running, tool };

export const ask = (ctx: Ctx, args: unknown) => tool(ctx, "ask_user", args);
export const getAnswer = (ctx: Ctx, args: unknown) =>
  tool(ctx, "get_answer", args);

/** Asks a valid question on the run of the context; returns the question id. */
export async function asked(
  ctx: Ctx & { runId: number },
  over: Record<string, unknown> = {},
) {
  return dataOf<{ question_id: number }>(
    await ask(ctx, {
      run_id: ctx.runId,
      question: "Quel nom pour le bouton ?",
      suggested_answers: ["Valider", "Envoyer"],
      ...over,
    }),
  ).question_id;
}

/** A running run with one pending question. */
export async function withQuestion() {
  const s = await running();
  return { ...s, questionId: await asked(s) };
}

export const questionRows = (db: TestDb) =>
  all<{
    id: number;
    run_id: number;
    question: string;
    suggested_answers: string[] | null;
    answer: string | null;
    asked_at: Date | null;
    answered_at: Date | null;
  }>(
    db,
    sql`select id, run_id, question, suggested_answers, answer, asked_at, answered_at from questions order by id`,
  );

/** The MCP entries of one action, with their run_id. */
export const entriesOf = (db: TestDb, action: string) =>
  all<{
    action: string;
    actor: string;
    origin: string;
    result: string;
    detail: Record<string, string> | null;
    run_id: number | null;
    story_id: number | null;
    project_id: number | null;
    user_id: number | null;
  }>(
    db,
    sql`select action, actor, origin, result, detail, run_id, story_id, project_id, user_id from history where action = ${action} order by id`,
  );

export const answerRoute = (
  app: App,
  cookie: string | undefined,
  id: number | string,
  body: unknown = { answer: "Valider" },
) =>
  app.request(`/api/questions/${id}/answer`, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
