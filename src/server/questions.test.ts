// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  userWithToken,
} from "./test-mcp.ts";
import {
  all,
  answerRoute,
  ask,
  asked,
  entriesOf,
  finish,
  getAnswer,
  questionRows,
  running,
  withQuestion,
} from "./test-questions.ts";

// Slice 7.4 (decision 036 A to D, H): ask_user and get_answer.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criterion 1: ask_user stores the question", () => {
  it("given a running run, when Claude asks a question with two suggested answers, then a row is stored and the answer is { question_id }", async () => {
    const s = await running();

    const data = dataOf<{ question_id: number }>(
      await ask(s, {
        run_id: s.runId,
        question: "Quel nom pour le bouton ?",
        suggested_answers: ["Valider", "Envoyer"],
      }),
    );

    expect(Object.keys(data)).toEqual(["question_id"]);
    const rows = await questionRows(s.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: data.question_id,
      run_id: s.runId,
      question: "Quel nom pour le bouton ?",
      suggested_answers: ["Valider", "Envoyer"],
      answer: null,
      answered_at: null,
    });
    expect(rows[0]?.asked_at).toBeTruthy();
  });

  it("given the server, when tools/list is called, then ask_user and get_answer are listed with their arguments", async () => {
    const s = await running();

    const tools = await listedTools(s.app, s.alice.secret);

    const keys = (name: string) =>
      Object.keys(
        tools.find((t) => t.name === name)?.inputSchema?.properties ?? {},
      ).sort();
    expect(keys("ask_user")).toEqual([
      "question",
      "run_id",
      "suggested_answers",
    ]);
    expect(keys("get_answer")).toEqual(["question_id"]);
  });
});

describe("criterion 2: ask_user refusals", () => {
  async function expectUntouched(
    s: Awaited<ReturnType<typeof running>>,
    reason: string,
    rowsBefore = 0,
  ) {
    expect(await questionRows(s.db)).toHaveLength(rowsBefore);
    expect((await entriesOf(s.db, "ask_user")).at(-1)).toMatchObject({
      result: "refused",
      detail: { reason },
    });
  }

  it("given a pending question, when Claude asks another, then it is refused question_pending and the first is untouched", async () => {
    const s = await withQuestion();

    expectRefused(await ask(s, { run_id: s.runId, question: "Une autre ?" }));

    await expectUntouched(s, "question_pending", 1);
    expect((await questionRows(s.db))[0]?.question).toBe(
      "Quel nom pour le bouton ?",
    );
  });

  it("given a pending row forced by SQL, when Claude asks, then it is refused question_pending", async () => {
    const s = await running();
    await s.db.execute(
      sql`insert into questions (run_id, question) values (${s.runId}, 'forcée')`,
    );

    expectRefused(await ask(s, { run_id: s.runId, question: "Une autre ?" }));

    await expectUntouched(s, "question_pending", 1);
  });

  it("given a pending question, when a second pending row is inserted by SQL, then the unique partial index rejects it", async () => {
    const s = await withQuestion();

    await expect(
      s.db.execute(
        sql`insert into questions (run_id, question) values (${s.runId}, 'doublon')`,
      ),
    ).rejects.toThrow();
  });

  it("given a finished run, when Claude asks, then it is refused run_finished", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expectRefused(await ask(s, { run_id: s.runId, question: "Et ?" }));

    await expectUntouched(s, "run_finished");
  });

  it("given an archived project, when Claude asks, then it is refused project_archived", async () => {
    const s = await running();
    await archiveProject(s.db, s.projectId);

    expectRefused(await ask(s, { run_id: s.runId, question: "Et ?" }));

    await expectUntouched(s, "project_archived");
  });

  it("given the run of someone else, when Claude asks, then it is refused not_found", async () => {
    const s = await running();
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(s.app, bob.secret, "ask_user", {
        run_id: s.runId,
        question: "Et ?",
      }),
    );

    await expectUntouched(s, "not_found");
  });

  it.each([
    ["an empty question", { question: "" }],
    ["a question over 2 000 characters", { question: "x".repeat(2001) }],
    ["a question with a NUL character", { question: "a\u0000b" }],
    ["three suggested answers", { suggested_answers: ["a", "b", "c"] }],
    ["an empty suggested answer", { suggested_answers: ["a", ""] }],
    [
      "a suggested answer over 200 characters",
      { suggested_answers: ["x".repeat(201)] },
    ],
  ])(
    "given %s, when Claude asks, then it is refused invalid_arguments",
    async (_label, over) => {
      const s = await running();

      expectRefused(
        await ask(s, { run_id: s.runId, question: "Une question", ...over }),
      );

      await expectUntouched(s, "invalid_arguments");
    },
  );

  it("given a 2 000 characters question and a 200 characters suggested answer, when Claude asks, then it is accepted", async () => {
    const s = await running();

    dataOf(
      await ask(s, {
        run_id: s.runId,
        question: "x".repeat(2000),
        suggested_answers: ["y".repeat(200)],
      }),
    );
  });
});

describe("criterion 3: get_answer", () => {
  it("given a pending question, when Claude reads it, then { answered: false, answer: null, stop_requested: false }", async () => {
    const s = await withQuestion();

    const data = dataOf(await getAnswer(s, { question_id: s.questionId }));

    expect(data).toEqual({
      answered: false,
      answer: null,
      stop_requested: false,
    });
  });

  it("given an answered question, when Claude reads it, then { answered: true, answer: Valider, stop_requested: false }", async () => {
    const s = await withQuestion();
    expect(
      (await answerRoute(s.app, s.alice.cookie, s.questionId)).status,
    ).toBe(200);

    const data = dataOf(await getAnswer(s, { question_id: s.questionId }));

    expect(data).toEqual({
      answered: true,
      answer: "Valider",
      stop_requested: false,
    });
  });

  it("given an answered question and a finished run, when Claude reads it, then the answer is given", async () => {
    const s = await withQuestion();
    await answerRoute(s.app, s.alice.cookie, s.questionId);
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    const data = dataOf(await getAnswer(s, { question_id: s.questionId }));

    expect(data).toMatchObject({ answered: true, answer: "Valider" });
  });

  it("given an archived project, when Claude reads a question, then the read works", async () => {
    const s = await withQuestion();
    await archiveProject(s.db, s.projectId);

    const data = dataOf(await getAnswer(s, { question_id: s.questionId }));

    expect(data).toMatchObject({ answered: false, answer: null });
  });

  it("given the question of someone else or an unknown one, when Claude reads it, then it is refused not_found", async () => {
    const s = await withQuestion();
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(s.app, bob.secret, "get_answer", {
        question_id: s.questionId,
      }),
    );
    expectRefused(await getAnswer(s, { question_id: 99999 }));

    const entries = await entriesOf(s.db, "get_answer");
    expect(entries.map((e) => [e.result, e.detail])).toEqual([
      ["refused", { reason: "not_found" }],
      ["refused", { reason: "not_found" }],
    ]);
  });

  it("given three calls, when the history is read, then each call left an MCP entry with the run_id", async () => {
    const s = await withQuestion();

    for (let i = 0; i < 3; i++)
      dataOf(await getAnswer(s, { question_id: s.questionId }));

    const entries = await entriesOf(s.db, "get_answer");
    expect(entries).toHaveLength(3);
    for (const e of entries)
      expect(e).toMatchObject({
        actor: "claude",
        origin: "mcp",
        result: "ok",
        run_id: s.runId,
        story_id: s.id,
        project_id: s.projectId,
      });
  });
});

describe("history of ask_user (decision 036 H)", () => {
  it("given an accepted and a refused question, when the history is read, then both are MCP entries with the run_id", async () => {
    const s = await running();
    await asked(s);
    expectRefused(await ask(s, { run_id: s.runId, question: "Encore ?" }));

    const entries = await entriesOf(s.db, "ask_user");

    expect(entries.map((e) => e.result)).toEqual(["ok", "refused"]);
    for (const e of entries)
      expect(e).toMatchObject({
        actor: "claude",
        origin: "mcp",
        run_id: s.runId,
      });
  });
});

describe("criterion 4 (end): a new question after the answer", () => {
  it("given an answered question, when Claude asks again, then the new question is accepted", async () => {
    const s = await withQuestion();
    await answerRoute(s.app, s.alice.cookie, s.questionId);

    const second = await asked(s, { question: "Et la couleur ?" });

    expect(second).not.toBe(s.questionId);
    expect(await questionRows(s.db)).toHaveLength(2);
    expect(
      (
        await all<{ n: number }>(
          s.db,
          sql`select count(*)::int as n from questions where answer is null`,
        )
      )[0]?.n,
    ).toBe(1);
  });
});
