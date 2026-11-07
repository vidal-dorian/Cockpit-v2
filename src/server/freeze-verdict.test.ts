// biome-ignore-all lint/suspicious/noThenProperty: "then" is a Given/When/Then field of the stories (decision 017)
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
import { asTakeover, seedAppFiles } from "./test-freeze.ts";
import { dataOf, seedStory, seedTicket, withProject } from "./test-mcp.ts";
import { verdict } from "./verdict.ts";

// Slice R4 (decision 050 C): the reason « La PR modifie du code de l'app, pas seulement des tests » (code app_code_changed) in the verdict of a run.
// Shapes pinned in src/server/test-freeze.ts. `kind` and `prAppFiles` are optional in the input of verdict(): the tests of slice 7.7 do not give them.

afterEach(() => {
  vi.unstubAllGlobals();
});

const passed = { result: "passed", givenByThisRun: true } as const;
type Input = Parameters<typeof verdict>[0];
const good = {
  runStatus: "succeeded",
  criteria: [passed],
  prNumber: 12,
  prCiState: "success",
  prReviewState: null,
};
const v = (extra: Record<string, unknown>) =>
  verdict({ ...good, ...extra } as Input);

describe("decision 050 C: verdict()", () => {
  it("given a takeover story whose PR has app files, when the verdict is computed, then it is not acceptable, for app_code_changed", () => {
    expect(v({ kind: "takeover", prAppFiles: ["src/a.ts"] })).toEqual({
      acceptable: false,
      reasons: ["app_code_changed"],
    });
  });

  it("given a feature story whose PR has app files, when the verdict is computed, then it is acceptable", () => {
    expect(v({ kind: "feature", prAppFiles: ["src/a.ts"] })).toEqual({
      acceptable: true,
      reasons: [],
    });
  });

  it.each([
    ["an empty list", []],
    ["a list never read (null)", null],
  ])(
    "given a takeover story whose app files are %s, when the verdict is computed, then it is acceptable",
    (_label, prAppFiles) => {
      expect(v({ kind: "takeover", prAppFiles })).toEqual({
        acceptable: true,
        reasons: [],
      });
    },
  );

  it("given every other reason and app files, when the verdict is computed, then app_code_changed comes last, after changes_requested", () => {
    expect(
      v({
        kind: "takeover",
        prAppFiles: ["src/a.ts"],
        runStatus: "failed",
        criteria: [{ result: "failed", givenByThisRun: true }],
        prCiState: "failure",
        prReviewState: "changes_requested",
      }).reasons,
    ).toEqual([
      "run_not_succeeded",
      "criteria_failed",
      "ci_failing",
      "changes_requested",
      "app_code_changed",
    ]);
  });
});

type Ctx = Awaited<ReturnType<typeof running>>;
const PR = 12;

async function finished(s: Ctx) {
  const ids = await criterionIds(s.db, s.id);
  for (const id of ids)
    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: id,
        result: "passed",
        evidence: "preuve",
      }),
    );
  s.fetchMock.addPull(REPO, PR, BRANCH);
  dataOf(await link(s, { run_id: s.runId, pr_number: PR }));
  await s.db.execute(
    sql`update user_stories set pr_ci_state = 'success' where id = ${s.id}`,
  );
  dataOf(
    await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "ok" }),
  );
}

const read = async (s: Ctx) => {
  const res = await s.app.request(`/api/runs/${s.runId}`, {
    headers: { cookie: s.alice.cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    verdict: { acceptable: boolean; reasons: string[] };
    story: Record<string, unknown>;
  };
};

describe("decision 050 C: GET /api/runs/:id", () => {
  it("given a clean takeover run whose PR has app files, when I read the run, then the verdict says app_code_changed and the story gives kind, prAppFiles and prAppFilesCount", async () => {
    const s = await running();
    await finished(s);
    await asTakeover(s.db, s.id);
    await seedAppFiles(s.db, s.id, ["src/a.ts", "src/b.ts"], 25);

    const body = await read(s);

    expect(body.verdict).toEqual({
      acceptable: false,
      reasons: ["app_code_changed"],
    });
    expect(body.story).toMatchObject({
      kind: "takeover",
      prAppFiles: ["src/a.ts", "src/b.ts"],
      prAppFilesCount: 25,
    });
  });

  it("given the same run on an ordinary story, when I read the run, then it is acceptable", async () => {
    const s = await running();
    await finished(s);
    await seedAppFiles(s.db, s.id, ["src/a.ts"]);

    expect((await read(s)).verdict).toEqual({ acceptable: true, reasons: [] });
  });

  it("given a clean takeover run whose PR has only tests, when I read the run, then it is acceptable", async () => {
    const s = await running();
    await finished(s);
    await asTakeover(s.db, s.id);
    await seedAppFiles(s.db, s.id, []);

    expect((await read(s)).verdict).toEqual({ acceptable: true, reasons: [] });
  });
});

describe("decision 050 C: GET /api/home", () => {
  it("given a ready takeover story whose latest run succeeded cleanly but whose PR has app files, when I read the home, then it is a check item with app_code_changed", async () => {
    const ctx = await withProject();
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "t-reprise");
    const id = await seedStory(ctx.db, ticketId, {
      status: "ready",
      iWant: "figer",
    });
    await ctx.db.execute(
      sql`update user_stories set pr_number = 5, pr_ci_state = 'success' where id = ${id}`,
    );
    await asTakeover(ctx.db, id);
    await seedAppFiles(ctx.db, id, ["src/a.ts"]);
    const rows = (await ctx.db.execute(
      sql`insert into runs (story_id, user_id, status, model_actual, finished_at) values (${id}, ${ctx.alice.id}, 'succeeded', 'claude-x', now()) returning id`,
    )) as unknown as { rows: { id: number }[] };
    const runId = (rows.rows[0] as { id: number }).id;
    await ctx.db.execute(
      sql`update acceptance_criteria set result = 'passed', evidence = 'ok', result_run_id = ${runId} where story_id = ${id}`,
    );

    const res = await ctx.app.request("/api/home", {
      headers: { cookie: ctx.alice.cookie },
    });

    const { forYou } = (await res.json()) as { forYou: unknown[] };
    expect(forYou).toHaveLength(1);
    expect(forYou[0]).toMatchObject({
      kind: "check",
      runId,
      reasons: ["app_code_changed"],
    });
  });
});
