// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Ctx,
  criterionIds,
  criterionRows,
  finish,
  report,
  running,
  startRun,
} from "./test-criteria.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  userWithToken,
} from "./test-mcp.ts";

// Slice 7.3 (decision 035 B, E, G): report_criterion and what reads the result.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criterion 1: report_criterion records the result", () => {
  it("given a running run, when Claude reports passed with evidence, then the criterion stores result, evidence and result_run_id and the answer is { criterion_id, result }", async () => {
    const s = await running();
    const [first] = await criterionIds(s.db, s.id);

    const data = dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "passed",
        evidence: "src/a.test.ts > logs in",
      }),
    );

    expect(data).toEqual({ criterion_id: first, result: "passed" });
    expect(await criterionRows(s.db)).toContainEqual({
      id: first,
      result: "passed",
      evidence: "src/a.test.ts > logs in",
      result_run_id: s.runId,
    });
  });

  it("given a reported criterion, when it is reported again, then the second report replaces the first", async () => {
    const s = await running();
    const [first] = await criterionIds(s.db, s.id);
    const base = { run_id: s.runId, criterion_id: first };
    dataOf(await report(s, { ...base, result: "failed", evidence: "premier" }));

    dataOf(await report(s, { ...base, result: "passed", evidence: "second" }));

    expect(await criterionRows(s.db)).toContainEqual({
      id: first,
      result: "passed",
      evidence: "second",
      result_run_id: s.runId,
    });
  });

  it("given the server, when tools/list is called, then report_criterion is listed with run_id, criterion_id, result and evidence", async () => {
    const s = await running();

    const tool = (await listedTools(s.app, s.alice.secret)).find(
      (t) => t.name === "report_criterion",
    );

    expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual([
      "criterion_id",
      "evidence",
      "result",
      "run_id",
    ]);
  });
});

describe("criterion 2: report_criterion refusals", () => {
  async function expectUntouched(s: Ctx, reason: string) {
    for (const r of await criterionRows(s.db)) {
      expect(r.result).toBeNull();
      expect(r.evidence).toBeNull();
      expect(r.result_run_id).toBeNull();
    }
    expect((await mcpRows(s.db)).at(-1)).toMatchObject({
      action: "report_criterion",
      result: "refused",
      detail: { reason },
    });
  }
  const good = (runId: number, criterionId: number | undefined) => ({
    run_id: runId,
    criterion_id: criterionId,
    result: "passed",
    evidence: "preuve",
  });

  it("given a criterion of another story, when it is reported, then it is refused wrong_criterion", async () => {
    const s = await running();
    const [foreign] = await criterionIds(s.db, s.base);

    expectRefused(await report(s, good(s.runId, foreign)));

    await expectUntouched(s, "wrong_criterion");
  });

  it("given a finished run, when a criterion is reported, then it is refused run_finished", async () => {
    const s = await running();
    const [first] = await criterionIds(s.db, s.id);
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expectRefused(await report(s, good(s.runId, first)));

    await expectUntouched(s, "run_finished");
  });

  it("given an archived project, when a criterion is reported, then it is refused project_archived", async () => {
    const s = await running();
    const [first] = await criterionIds(s.db, s.id);
    await archiveProject(s.db, s.projectId);

    expectRefused(await report(s, good(s.runId, first)));

    await expectUntouched(s, "project_archived");
  });

  it("given the run of someone else, when a criterion is reported, then it is refused not_found", async () => {
    const s = await running();
    const [first] = await criterionIds(s.db, s.id);
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(
        s.app,
        bob.secret,
        "report_criterion",
        good(s.runId, first),
      ),
    );

    await expectUntouched(s, "not_found");
  });

  it.each([
    ["a result other than passed or failed", { result: "ok" }],
    ["an empty evidence", { evidence: "" }],
    ["an evidence over 10 000 characters", { evidence: "x".repeat(10_001) }],
    ["an evidence with a NUL character", { evidence: "a\u0000b" }],
  ])(
    "given %s, when a criterion is reported, then it is refused invalid_arguments",
    async (_label, over) => {
      const s = await running();
      const [first] = await criterionIds(s.db, s.id);

      expectRefused(await report(s, { ...good(s.runId, first), ...over }));

      await expectUntouched(s, "invalid_arguments");
    },
  );
});

describe("history of report_criterion (decision 035 G)", () => {
  it("given an accepted and a refused report, when the history is read, then both are MCP entries of the run and the story", async () => {
    const s = await running();
    const [first] = await criterionIds(s.db, s.id);
    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "passed",
        evidence: "preuve",
      }),
    );
    expectRefused(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "ok",
        evidence: "x",
      }),
    );

    const entries = (await mcpRows(s.db)).filter(
      (e) => e.action === "report_criterion",
    );

    expect(entries.map((e) => e.result)).toEqual(["ok", "refused"]);
    expect(entries[0]).toMatchObject({
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
      run_id: s.runId,
    });
  });
});

describe("criterion 6: the reads give the results", () => {
  it("given a reported criterion, when get_user_story is called, then each criterion has result and evidence (null when not reported)", async () => {
    const s = await running();
    const [first, second] = await criterionIds(s.db, s.id);
    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "failed",
        evidence: "src/a.test.ts > logs in",
      }),
    );

    const read = dataOf<{ criteria: Record<string, unknown>[] }>(
      await callTool(s.app, s.alice.secret, "get_user_story", {
        story_id: s.id,
      }),
    );

    expect(read.criteria).toMatchObject([
      { id: first, result: "failed", evidence: "src/a.test.ts > logs in" },
      { id: second, result: null, evidence: null },
    ]);
  });

  it("given a reported criterion, when GET /api/stories/:id is called, then each criterion has result, evidence and resultRunId", async () => {
    const s = await running();
    const [first, second] = await criterionIds(s.db, s.id);
    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "passed",
        evidence: "preuve",
      }),
    );

    const res = await s.app.request(`/api/stories/${s.id}`, {
      headers: { cookie: s.alice.cookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { story: { criteria: unknown[] } };
    expect(body.story.criteria).toMatchObject([
      { id: first, result: "passed", evidence: "preuve", resultRunId: s.runId },
      { id: second, result: null, evidence: null, resultRunId: null },
    ]);
  });

  it("given two runs that each reported a criterion, when GET /api/runs/:id is called, then each run shows only the results it gave", async () => {
    const s = await running();
    const [first, second] = await criterionIds(s.db, s.id);
    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "passed",
        evidence: "preuve un",
      }),
    );
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );
    const second_run = await startRun(s);
    dataOf(
      await report(s, {
        run_id: second_run,
        criterion_id: second,
        result: "failed",
        evidence: "preuve deux",
      }),
    );
    const criteriaOf = async (runId: number) =>
      (
        (await (
          await s.app.request(`/api/runs/${runId}`, {
            headers: { cookie: s.alice.cookie },
          })
        ).json()) as { criteria: unknown[] }
      ).criteria;

    expect(await criteriaOf(s.runId)).toMatchObject([
      {
        id: first,
        given: "g1",
        when: "w1",
        then: "t1",
        result: "passed",
        evidence: "preuve un",
      },
      { id: second, given: "g2", result: null, evidence: null },
    ]);
    expect(await criteriaOf(second_run)).toMatchObject([
      { id: first, result: null, evidence: null },
      { id: second, result: "failed", evidence: "preuve deux" },
    ]);
  });

  it("given a story never reported, when GET /api/stories/:id is called, then story.prNumber is null", async () => {
    const s = await running();

    const body = (await (
      await s.app.request(`/api/stories/${s.id}`, {
        headers: { cookie: s.alice.cookie },
      })
    ).json()) as { story: { prNumber: number | null } };

    expect(body.story.prNumber).toBeNull();
  });
});
