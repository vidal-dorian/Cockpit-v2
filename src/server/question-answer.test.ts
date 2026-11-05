// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveProject, dataOf, userWithToken } from "./test-mcp.ts";
import {
  answerRoute,
  asked,
  entriesOf,
  finish,
  questionRows,
  running,
  withQuestion,
} from "./test-questions.ts";

// Slice 7.4 (decision 036 D, F): the human answers by POST /api/questions/:id/answer, and GET /api/runs/:id lists the questions.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criterion 4: the human answers", () => {
  it("given a pending question, when a member answers, then 200, the question has the answer and answered_at, and one answer_question entry (human, ui, ids filled)", async () => {
    const s = await withQuestion();

    const res = await answerRoute(s.app, s.alice.cookie, s.questionId, {
      answer: "Valider",
    });

    expect(res.status).toBe(200);
    expect((await questionRows(s.db))[0]).toMatchObject({
      id: s.questionId,
      answer: "Valider",
    });
    expect((await questionRows(s.db))[0]?.answered_at).toBeTruthy();
    const entries = await entriesOf(s.db, "answer_question");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      result: "ok",
      user_id: s.alice.id,
      run_id: s.runId,
      story_id: s.id,
      project_id: s.projectId,
    });
  });

  it("given no session, when the answer is posted, then 401 and nothing changes", async () => {
    const s = await withQuestion();

    const res = await answerRoute(s.app, undefined, s.questionId);

    expect(res.status).toBe(401);
    expect((await questionRows(s.db))[0]?.answer).toBeNull();
  });

  it("given a non-member or an unknown question, when the answer is posted, then 404 and nothing changes", async () => {
    const s = await withQuestion();
    const bob = await userWithToken(s.app, s.db, 2000);

    const foreign = await answerRoute(s.app, bob.cookie, s.questionId);
    const unknown = await answerRoute(s.app, s.alice.cookie, 99999);

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect((await questionRows(s.db))[0]?.answer).toBeNull();
    expect(await entriesOf(s.db, "answer_question")).toHaveLength(0);
  });

  it("given an answered question, when it is answered again, then 409 already_answered and the first answer stays", async () => {
    const s = await withQuestion();
    await answerRoute(s.app, s.alice.cookie, s.questionId, {
      answer: "Valider",
    });

    const res = await answerRoute(s.app, s.alice.cookie, s.questionId, {
      answer: "Envoyer",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_answered" });
    expect((await questionRows(s.db))[0]?.answer).toBe("Valider");
  });

  it("given a finished run, when the answer is posted, then 409 run_finished and nothing changes", async () => {
    const s = await withQuestion();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    const res = await answerRoute(s.app, s.alice.cookie, s.questionId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run_finished" });
    expect((await questionRows(s.db))[0]?.answer).toBeNull();
  });

  it("given an archived project, when the answer is posted, then 409 project_archived and nothing changes", async () => {
    const s = await withQuestion();
    await archiveProject(s.db, s.projectId);

    const res = await answerRoute(s.app, s.alice.cookie, s.questionId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect((await questionRows(s.db))[0]?.answer).toBeNull();
  });

  it.each([
    ["an empty answer", { answer: "" }],
    ["an answer over 10 000 characters", { answer: "x".repeat(10_001) }],
    ["an answer with a NUL character", { answer: "a\u0000b" }],
    ["no answer", {}],
  ])(
    "given %s, when it is posted, then 400 and nothing changes",
    async (_l, body) => {
      const s = await withQuestion();

      const res = await answerRoute(s.app, s.alice.cookie, s.questionId, body);

      expect(res.status).toBe(400);
      expect((await questionRows(s.db))[0]?.answer).toBeNull();
    },
  );

  it("given an answer of 10 000 characters, when it is posted, then it is accepted", async () => {
    const s = await withQuestion();

    const res = await answerRoute(s.app, s.alice.cookie, s.questionId, {
      answer: "x".repeat(10_000),
    });

    expect(res.status).toBe(200);
  });
});

describe("criterion 5: GET /api/runs/:id lists the questions", () => {
  it("given an answered and a pending question, when the run is read, then questions are in order with id, question, suggestedAnswers, answer, askedAt, answeredAt", async () => {
    const s = await withQuestion();
    await answerRoute(s.app, s.alice.cookie, s.questionId);
    const second = await asked(s, {
      question: "Et la couleur ?",
      suggested_answers: undefined,
    });

    const res = await s.app.request(`/api/runs/${s.runId}`, {
      headers: { cookie: s.alice.cookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      questions: Record<string, unknown>[];
    };
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0]).toMatchObject({
      id: s.questionId,
      question: "Quel nom pour le bouton ?",
      suggestedAnswers: ["Valider", "Envoyer"],
      answer: "Valider",
    });
    expect(typeof body.questions[0]?.askedAt).toBe("string");
    expect(typeof body.questions[0]?.answeredAt).toBe("string");
    expect(body.questions[1]).toMatchObject({
      id: second,
      question: "Et la couleur ?",
      answer: null,
      answeredAt: null,
    });
    expect(Object.keys(body.questions[1] ?? {}).sort()).toEqual([
      "answer",
      "answeredAt",
      "askedAt",
      "id",
      "question",
      "suggestedAnswers",
    ]);
  });

  it("given a run without question, when it is read, then questions is an empty list", async () => {
    const s = await running();

    const body = (await (
      await s.app.request(`/api/runs/${s.runId}`, {
        headers: { cookie: s.alice.cookie },
      })
    ).json()) as { questions: unknown[] };

    expect(body.questions).toEqual([]);
  });
});
