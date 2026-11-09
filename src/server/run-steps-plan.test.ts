// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { all } from "./test-criteria.ts";
import { withStory } from "./test-decisions.ts";
import { callTool, dataOf, expectRefused } from "./test-mcp.ts";

// Slice 9.5 (decision 069 A, B, D): start_run({ steps }), upcomingSteps, ask_user({ context }) and the agent of a question.
// Pinned: GET /api/runs/:id -> { upcomingSteps: string[], questions: [{ context, agent, ... }], ... } (upcomingSteps beside `steps`);
// GET /api/home -> forYou[kind "answer"] has context and agent.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withStory>>;
const tool = (s: Ctx, name: string, args: unknown) =>
  callTool(s.app, s.alice.secret, name, args);
const PLAN = ["test-writer", "developer", "reviewer"];

async function started(steps: unknown) {
  const s = await withStory("ready");
  const res = await tool(s, "start_run", {
    story_id: s.id,
    branch: "us/42-login",
    model: "claude-x",
    ...(steps === null ? {} : { steps }),
  });
  return { s, res };
}
async function withPlan(steps: unknown = PLAN) {
  const { s, res } = await started(steps);
  return {
    ...s,
    tool: (n: string, a: unknown) => tool(s, n, a),
    runId: dataOf<{ run_id: number }>(res).run_id,
  };
}
type P = Awaited<ReturnType<typeof withPlan>>;
const report = async (p: P, agent: string, event: "started" | "finished") =>
  dataOf(
    await p.tool("report_step", {
      run_id: p.runId,
      agent,
      event,
      ...(event === "finished" ? { status: "succeeded", summary: "ok" } : {}),
    }),
  );
const readRun = async (p: Ctx & { runId: number }) =>
  (await (
    await p.app.request(`/api/runs/${p.runId}`, {
      headers: { cookie: p.alice.cookie },
    })
  ).json()) as {
    upcomingSteps: string[];
    questions: { context: string | null; agent: string | null }[];
  };
const runCount = async (s: Ctx) =>
  (await all<{ id: number }>(s.db, sql`select id from runs`)).length;

describe("criterion 1: upcomingSteps follows the plan", () => {
  it("given steps test-writer, developer, reviewer, when test-writer is started then finished and developer started, then upcomingSteps is [reviewer]; with nothing reported it is the three", async () => {
    const p = await withPlan();
    expect((await readRun(p)).upcomingSteps).toEqual(PLAN);

    await report(p, "test-writer", "started");
    await report(p, "test-writer", "finished");
    await report(p, "developer", "started");

    expect((await readRun(p)).upcomingSteps).toEqual(["reviewer"]);
  });

  it("given developer redone after reviewer, when the run is read, then reviewer is upcoming again", async () => {
    const p = await withPlan();
    for (const agent of PLAN) {
      await report(p, agent, "started");
      await report(p, agent, "finished");
    }
    await report(p, "developer", "started");

    expect((await readRun(p)).upcomingSteps).toEqual(["reviewer"]);
  });
});

describe("criterion 2: no plan, finished run, invalid steps", () => {
  it("given start_run without steps, or a finished run, when the run is read, then upcomingSteps is []", async () => {
    const bare = await withPlan(null);
    expect((await readRun(bare)).upcomingSteps).toEqual([]);

    const p = await withPlan();
    dataOf(
      await p.tool("finish_run", {
        run_id: p.runId,
        outcome: "failed",
        summary: "x",
      }),
    );
    expect((await readRun(p)).upcomingSteps).toEqual([]);
  });

  it.each([
    ["a bad agent name", ["Dev Eloper"]],
    ["more than 20 names", Array.from({ length: 21 }, (_, i) => `agent-${i}`)],
  ])(
    "given steps with %s, when start_run is called, then it is refused and no run is created",
    async (_name, steps) => {
      const { s, res } = await started(steps);

      expectRefused(res);
      expect(await runCount(s)).toBe(0);
    },
  );
});

describe("criterion 3 and 4: ask_user context and the agent of the question", () => {
  it("given the developer step open, when ask_user has a context, then the run question and the home item carry context and agent developer", async () => {
    const p = await withPlan();
    await report(p, "developer", "started");

    dataOf(
      await p.tool("ask_user", {
        run_id: p.runId,
        question: "Quel nom ?",
        context: "L'envoi de l'e-mail est en place…",
      }),
    );

    expect((await readRun(p)).questions[0]).toMatchObject({
      context: "L'envoi de l'e-mail est en place…",
      agent: "developer",
    });
    const home = (await (
      await p.app.request("/api/home", { headers: { cookie: p.alice.cookie } })
    ).json()) as { forYou: Record<string, unknown>[] };
    expect(home.forYou.find((i) => i.kind === "answer")).toMatchObject({
      context: "L'envoi de l'e-mail est en place…",
      agent: "developer",
    });
  });

  it("given no context and no open step, when ask_user is called, then context and agent are null", async () => {
    const p = await withPlan();

    dataOf(
      await p.tool("ask_user", { run_id: p.runId, question: "Quel nom ?" }),
    );

    expect((await readRun(p)).questions[0]).toMatchObject({
      context: null,
      agent: null,
    });
  });

  it.each([
    ["1001 characters", "x".repeat(1001)],
    ["empty", ""],
  ])(
    "given a context of %s, when ask_user is called, then it is refused and no question is created",
    async (_name, context) => {
      const p = await withPlan();

      expectRefused(
        await p.tool("ask_user", {
          run_id: p.runId,
          question: "Quel nom ?",
          context,
        }),
      );

      expect(
        (await all<{ id: number }>(p.db, sql`select id from questions`)).length,
      ).toBe(0);
    },
  );
});
