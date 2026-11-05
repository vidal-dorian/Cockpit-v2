// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRANCH,
  criterionIds,
  finish,
  link,
  REPO,
  report,
  running,
} from "./test-criteria.ts";
import { dataOf } from "./test-mcp.ts";

// Slice 7.7 (decision 039 D): GET /api/runs/:id also gives verdict: { acceptable, reasons } | null
// and, on story, prNumber, prCiState, prReviewState.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof running>>;
const PR = 12;

async function read(s: Ctx) {
  const res = await s.app.request(`/api/runs/${s.runId}`, {
    headers: { cookie: s.alice.cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    verdict: { acceptable: boolean; reasons: string[] } | null;
    story: Record<string, unknown>;
  };
}

const setCi = (s: Ctx, ci: string | null) =>
  s.db.execute(
    sql`update user_stories set pr_ci_state = ${ci} where id = ${s.id}`,
  );

async function reportAll(s: Ctx, results: string[]) {
  const ids = await criterionIds(s.db, s.id);
  for (const [i, result] of results.entries())
    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: ids[i],
        result,
        evidence: "preuve",
      }),
    );
}

async function linkPr(s: Ctx) {
  s.fetchMock.addPull(REPO, PR, BRANCH);
  dataOf(await link(s, { run_id: s.runId, pr_number: PR }));
}

describe("criterion 2: GET /api/runs/:id gives the verdict", () => {
  it("given a running run, when I read it, then verdict is null", async () => {
    const s = await running();

    expect((await read(s)).verdict).toBeNull();
  });

  it("given a succeeded run, every criterion passed, a PR and CI success, when I read it, then the verdict is acceptable and the story has prNumber, prCiState, prReviewState", async () => {
    const s = await running();
    await reportAll(s, ["passed", "passed"]);
    await linkPr(s);
    await setCi(s, "success");
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "ok" }),
    );

    const body = await read(s);

    expect(body.verdict).toEqual({ acceptable: true, reasons: [] });
    expect(body.story).toMatchObject({
      prNumber: PR,
      prCiState: "success",
      prReviewState: null,
    });
  });

  it("given a failed criterion and a failing CI on a succeeded run, when I read it, then the verdict is to check with criteria_failed then ci_failing", async () => {
    const s = await running();
    await reportAll(s, ["failed", "passed"]);
    await linkPr(s);
    await setCi(s, "failure");
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "ok" }),
    );

    expect((await read(s)).verdict).toEqual({
      acceptable: false,
      reasons: ["criteria_failed", "ci_failing"],
    });
  });

  it("given a failed run without PR and no report, when I read it, then the reasons are run_not_succeeded, criteria_not_reported, no_pull_request", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect((await read(s)).verdict).toEqual({
      acceptable: false,
      reasons: [
        "run_not_succeeded",
        "criteria_not_reported",
        "no_pull_request",
      ],
    });
  });

  it("given an acceptable run, when the CI then turns failure and review asks changes, then reading again follows them", async () => {
    const s = await running();
    await reportAll(s, ["passed", "passed"]);
    await linkPr(s);
    await setCi(s, "success");
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "ok" }),
    );
    expect((await read(s)).verdict?.acceptable).toBe(true);

    await setCi(s, "failure");
    await s.db.execute(
      sql`update user_stories set pr_review_state = 'changes_requested' where id = ${s.id}`,
    );

    const body = await read(s);
    expect(body.verdict).toEqual({
      acceptable: false,
      reasons: ["ci_failing", "changes_requested"],
    });
    expect(body.story).toMatchObject({
      prCiState: "failure",
      prReviewState: "changes_requested",
    });
  });
});
