import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cite,
  finding,
  findingRows,
  ready,
  submitFindings,
  submitted,
} from "./test-findings.ts";
import { seedProject, textOf } from "./test-mcp.ts";

// Slice R6 (decision 052 G, K): the storage of the findings of GitHub, written straight into the table with raw SQL (so no test depends on the Drizzle export of a column),
// and `submit_findings` accepting the kind `upgrade`.
//
// Pinned: the columns are github_alert_type, github_alert_number and github_closed_at on `findings`; `commit_sha` becomes nullable; the unique index is over
// (project_id, github_alert_type, github_alert_number); the CHECKs refuse (error text « check constraint ») a source github without its type and number, a type or a number
// on a source claude, a type without a number (or the reverse), and a null commit_sha on a source claude. The unique index is refused as « unique constraint ».

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Drizzle wraps the driver error: the constraint text is in the cause (as findings.test.ts reads it). */
const refusedBy = async (query: Promise<unknown>, what: RegExp) => {
  const error = await query.then(
    () => null,
    (e: unknown) => e,
  );
  const cause = (error as { cause?: unknown } | null)?.cause;
  expect(error, "the insert must be refused").not.toBeNull();
  expect(
    `${(error as Error | null)?.message ?? ""} ${(cause as Error | undefined)?.message ?? ""}`,
  ).toMatch(what);
};

type Ctx = Awaited<ReturnType<typeof ready>>;
const insert = (
  ctx: Ctx,
  v: {
    source?: string;
    type?: string | null;
    number?: number | null;
    commit?: string | null;
    projectId?: number;
  } = {},
) =>
  ctx.db.execute(
    sql`insert into findings (project_id, kind, source, title, body_md, severity, commit_sha, github_alert_type, github_alert_number)
        values (${v.projectId ?? ctx.projectId}, 'security', ${v.source ?? "github"}, 't', 'b', 'high',
                ${v.commit === undefined ? null : v.commit},
                ${v.type === undefined ? "dependabot" : v.type},
                ${v.number === undefined ? 1 : v.number})`,
  );
const SHA = "a".repeat(40);
const CHECK = /check constraint/i;

describe("decision 052 G: the CHECKs of a finding of GitHub", () => {
  it("given a Dependabot alert, when a finding of source github is inserted with its tool and number and no commit, then it is accepted", async () => {
    const ctx = await ready();

    await insert(ctx);

    const row = (
      (await ctx.db.execute(
        sql`select source, github_alert_type, github_alert_number, github_closed_at, commit_sha from findings`,
      )) as unknown as { rows: Record<string, unknown>[] }
    ).rows[0];
    expect(row).toEqual({
      source: "github",
      github_alert_type: "dependabot",
      github_alert_number: 1,
      github_closed_at: null,
      commit_sha: null,
    });
  });

  it.each(["dependabot", "code_scanning", "secret_scanning"])(
    "given the tool %s, when a finding of source github is inserted with a commit, then it is accepted",
    async (type) => {
      const ctx = await ready();

      await insert(ctx, { type, commit: SHA });

      expect(
        (
          (await ctx.db.execute(
            sql`select count(*)::int as n from findings`,
          )) as unknown as {
            rows: { n: number }[];
          }
        ).rows[0]?.n,
      ).toBe(1);
    },
  );

  it.each([
    ["no tool", { type: null }],
    ["no number", { number: null }],
    ["neither", { type: null, number: null }],
  ])(
    "given a source github with %s, when it is inserted, then the CHECK refuses it",
    async (_name, v) => {
      const ctx = await ready();

      await refusedBy(insert(ctx, v), CHECK);
    },
  );

  it.each([
    ["a tool and a number", { type: "dependabot", number: 1 }],
    ["a tool only", { type: "dependabot", number: null }],
    ["a number only", { type: null, number: 1 }],
  ])(
    "given a source claude with %s, when it is inserted, then the CHECK refuses it (the tool and the number go with source github)",
    async (_name, v) => {
      const ctx = await ready();

      await refusedBy(
        insert(ctx, { source: "claude", commit: SHA, ...v }),
        CHECK,
      );
    },
  );

  it("given a source claude with no tool and no number, when it is inserted with a commit, then it is accepted; without a commit the CHECK refuses it", async () => {
    const ctx = await ready();

    await insert(ctx, {
      source: "claude",
      type: null,
      number: null,
      commit: SHA,
    });
    await refusedBy(
      insert(ctx, { source: "claude", type: null, number: null, commit: null }),
      CHECK,
    );
  });

  it("given the tools of Claude, when a finding is submitted, then its source is claude, it has a commit and no github column is filled", async () => {
    const ctx = await ready();
    await submitted(ctx, [finding(1)]);

    const row = (
      (await ctx.db.execute(
        sql`select source, commit_sha, github_alert_type, github_alert_number, github_closed_at from findings`,
      )) as unknown as { rows: Record<string, unknown>[] }
    ).rows[0];

    expect(row).toEqual({
      source: "claude",
      commit_sha: ctx.sha,
      github_alert_type: null,
      github_alert_number: null,
      github_closed_at: null,
    });
    expect((await findingRows(ctx.db))[0]?.commit_sha).toBe(ctx.sha);
  });
});

describe("decision 052 G, E: one finding per alert and per project", () => {
  it("given an alert already stored, when the same tool and number are inserted for the same project, then the unique index refuses it", async () => {
    const ctx = await ready();
    await insert(ctx);

    await refusedBy(insert(ctx), /unique|duplicate/i);
  });

  it("given an alert stored, when the same number is inserted for another tool, or for another project, then both are accepted", async () => {
    const ctx = await ready();
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    await insert(ctx);

    await insert(ctx, { type: "code_scanning" });
    await insert(ctx, { projectId: other });

    expect(
      (
        (await ctx.db.execute(
          sql`select count(*)::int as n from findings`,
        )) as unknown as {
          rows: { n: number }[];
        }
      ).rows[0]?.n,
    ).toBe(3);
  });
});

describe("decision 052 K: submit_findings accepts the kind upgrade", () => {
  it("given a finding of kind upgrade citing a line of the manifest, when submit_findings is called, then it is stored as an upgrade of source claude", async () => {
    const ctx = await ready();

    const result = await submitFindings(ctx, [
      finding(1, {
        kind: "upgrade",
        title: "Passer de Node 20 à Node 22",
        severity: "high",
        effort: "medium",
        sources: [cite("api/package.json", 2)],
      }),
    ]);

    expect(result.isError, textOf(result)).not.toBe(true);
    expect((await findingRows(ctx.db))[0]).toMatchObject({
      kind: "upgrade",
      source: "claude",
      commit_sha: ctx.sha,
    });
  });
});
