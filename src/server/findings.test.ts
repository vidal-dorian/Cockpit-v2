// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILES, text } from "./test-code-map.ts";
import {
  cite,
  finding,
  findingRows,
  findingSourceRows,
  listFindings,
  ready,
  setStatus,
  sourceCount,
  submitFindings,
  submitted,
} from "./test-findings.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  historyText,
  listedTools,
  onlyEntry,
  shape,
  textOf,
} from "./test-mcp.ts";
import { criterionIds, withRules } from "./test-takeover.ts";

// Slice R5 (decision 051 A, B, C): the MCP tools `submit_findings` and `list_findings`, tested through POST /mcp against the fake GitHub.
//
// Pinned where the decision leaves it open (the developer follows these; see src/server/test-findings.ts for the arguments, the answers and the columns):
// - A call that breaks the schema of A is refused `Refused: invalid arguments (<path>: <why>)` like every tool, the path naming the faulty field; journaled `invalid_arguments`.
//   `kind: "upgrade"` is refused that way too (it waits for R6). The refusals that need the repo or the project say the location with brackets, as `submit_code_map` does:
//   `findings[2].sources[0]` for a citation, `commit_sha` for an unknown commit; journaled `refused` with a closed lowercase code (`project_archived`, `not_found`).
// - The history keeps one entry per call, actions `submit_findings` and `list_findings`, actor claude, origin mcp; submit_findings keeps counts and ids, none of the texts.

afterEach(() => {
  vi.unstubAllGlobals();
});

const text3 = () => text(3, "f");
const manyFiles = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`api/src/f${i}.ts`, text3()]),
  );
/** `count` findings of 5 sources each, citing files f0.. in turn; the file index is capped at `cap` (so `cap + 1` distinct files are cited in all). */
const spread = (count: number, cap: number) =>
  Array.from({ length: count }, (_, s) =>
    finding(s, {
      sources: Array.from({ length: 5 }, (_, k) =>
        cite(`api/src/f${Math.min(s * 5 + k, cap)}.ts`, 1, 3),
      ),
    }),
  );

describe("decision 051 A, C: a valid call stores the findings and their sources", () => {
  it("given two findings that cite real lines, when submit_findings is called, then each is a row of findings, source claude, status open, with the commit, and the answer lists their ids in order", async () => {
    const ctx = await ready();

    const data = await submitted(ctx, [
      finding(1, {
        kind: "security",
        severity: "critical",
        effort: "small",
        title: "Mots de passe en MD5",
      }),
      finding(2, { kind: "architecture", severity: "low" }),
    ]);

    const rows = await findingRows(ctx.db);
    expect(rows).toHaveLength(2);
    expect(data.findings).toEqual([{ id: rows[0]?.id }, { id: rows[1]?.id }]);
    expect(rows[0]).toMatchObject({
      project_id: ctx.projectId,
      kind: "security",
      source: "claude",
      title: "Mots de passe en MD5",
      body_md: "texte-1\n\n- étape 1",
      severity: "critical",
      effort: "small",
      status: "open",
      ticket_id: null,
      dismiss_reason: null,
      commit_sha: ctx.sha,
    });
    expect(rows[1]).toMatchObject({
      kind: "architecture",
      severity: "low",
      effort: null,
      status: "open",
    });
  });

  it("given a finding with two sources, when it is stored, then each source is a row of code_sources with finding_id, no criterion_id, its position from 0 and the commit", async () => {
    const ctx = await ready();

    await submitted(ctx, [
      finding(1, {
        sources: [cite("api/src/db.ts", 5, 9), cite("web/src/types.ts", 3)],
      }),
      finding(2),
    ]);

    const [first, second] = await findingRows(ctx.db);
    const sources = await findingSourceRows(ctx.db);
    expect(
      sources.map((s) => [
        s.finding_id,
        s.criterion_id,
        s.position,
        s.path,
        s.start_line,
        s.end_line,
        s.commit_sha,
      ]),
    ).toEqual([
      [first?.id, null, 0, "api/src/db.ts", 5, 9, ctx.sha],
      [first?.id, null, 1, "web/src/types.ts", 3, 3, ctx.sha],
      [second?.id, null, 0, "api/src/db.ts", 5, 9, ctx.sha],
    ]);
  });

  it.each(["bug", "security", "architecture", "stack"])(
    "given a finding of kind %s with every severity and effort, when it is sent, then it is accepted",
    async (kind) => {
      const ctx = await ready();

      const result = await submitFindings(ctx, [
        finding(1, { kind, severity: "critical", effort: "large" }),
        finding(2, { kind, severity: "high", effort: "medium" }),
        finding(3, { kind, severity: "low" }),
      ]);

      expect(result.isError, textOf(result)).not.toBe(true);
      expect(await findingRows(ctx.db)).toHaveLength(3);
    },
  );

  it("given exactly 50 findings, 5 sources on one, a title of 200 and a body of 20000 characters, when it is sent, then it is accepted", async () => {
    const ctx = await ready();
    const fifty = Array.from({ length: 50 }, (_, i) =>
      finding(i, {
        title: i === 0 ? "t".repeat(200) : `constat-${i}`,
        body_md: i === 0 ? "b".repeat(20_000) : "x",
        sources: Array.from({ length: i === 0 ? 5 : 1 }, () =>
          cite("api/src/db.ts", 1, 2),
        ),
      }),
    );

    const result = await submitFindings(ctx, fifty);

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(await findingRows(ctx.db)).toHaveLength(50);
  });

  it("given a call that cites exactly 100 distinct files, when it is sent, then it is accepted", async () => {
    const ctx = await ready({ ...FILES, ...manyFiles(100) });

    const result = await submitFindings(ctx, spread(20, 99));

    expect(result.isError, textOf(result)).not.toBe(true);
  });

  it("given a valid token, when tools/list is read, then submit_findings and list_findings are listed with an English description and their required arguments", async () => {
    const ctx = await ready();

    const tools = await listedTools(ctx.app, ctx.alice.secret);
    const submit = tools.find((t) => t.name === "submit_findings");
    const list = tools.find((t) => t.name === "list_findings");

    expect(submit?.description).toMatch(/[a-z]{4,}/);
    expect(submit?.description).not.toMatch(/[À-ÿ]/);
    expect(submit?.inputSchema?.required).toEqual(
      expect.arrayContaining(["project_id", "commit_sha", "findings"]),
    );
    expect(list?.description).toMatch(/[a-z]{4,}/);
    expect(list?.inputSchema?.required).toEqual(["project_id"]);
  });

  it("given the tools Claude has, when tools/list is read, then the only ones about findings are submit_findings and list_findings: Claude never triages (decision 007)", async () => {
    const ctx = await ready();

    const names = (await listedTools(ctx.app, ctx.alice.secret)).map(
      (t) => t.name,
    );

    expect(names).toEqual(
      expect.arrayContaining(["submit_findings", "list_findings"]),
    );
    expect(names.filter((n) => /finding/.test(n)).sort()).toEqual([
      "list_findings",
      "submit_findings",
    ]);
  });

  it("given a valid call, when it is journaled, then there is ONE entry of Claude with the action and no text of the findings", async () => {
    const ctx = await ready();

    await submitted(ctx, [
      finding(1, { title: "titre-secret", body_md: "corps-secret" }),
    ]);

    const entry = await onlyEntry(ctx.db);
    expect(shape(entry)).toMatchObject({
      user_id: ctx.alice.id,
      token_id: ctx.alice.tokenId,
      project_id: ctx.projectId,
      actor: "claude",
      origin: "mcp",
      action: "submit_findings",
      result: "ok",
    });
    const journal = await historyText(ctx.db);
    for (const secret of ["titre-secret", "corps-secret", "étape 1"])
      expect(journal).not.toContain(secret);
  });
});

describe("decision 051 A: the bounds of the schema", () => {
  const without = (key: string) => ({ ...finding(1), [key]: undefined });
  const cases: [
    string,
    string | RegExp,
    () => unknown[],
    Record<string, unknown>?,
  ][] = [
    ["no finding", /findings/, () => []],
    [
      "51 findings",
      /findings/,
      () => Array.from({ length: 51 }, (_, i) => finding(i)),
    ],
    [
      "kind upgrade (it waits for R6)",
      /kind/,
      () => [finding(1, { kind: "upgrade" })],
    ],
    ["an unknown kind", /kind/, () => [finding(1, { kind: "style" })]],
    ["no kind", /kind/, () => [without("kind")]],
    ["an empty title", /title/, () => [finding(1, { title: "" })]],
    [
      "a title of 201 characters",
      /title/,
      () => [finding(1, { title: "x".repeat(201) })],
    ],
    ["no title", /title/, () => [without("title")]],
    ["an empty body", /body_md/, () => [finding(1, { body_md: "" })]],
    [
      "a body of 20001 characters",
      /body_md/,
      () => [finding(1, { body_md: "x".repeat(20_001) })],
    ],
    [
      "an unknown severity",
      /severity/,
      () => [finding(1, { severity: "urgent" })],
    ],
    ["no severity", /severity/, () => [without("severity")]],
    ["an unknown effort", /effort/, () => [finding(1, { effort: "huge" })]],
    ["no source", /sources/, () => [finding(1, { sources: [] })]],
    [
      "6 sources on a finding",
      /sources/,
      () => [
        finding(1, {
          sources: Array.from({ length: 6 }, () => cite("api/src/db.ts", 1)),
        }),
      ],
    ],
    [
      "a source whose start_line is after its end_line",
      /start_line|end_line|sources/,
      () => [finding(1, { sources: [cite("api/src/db.ts", 5, 4)] })],
    ],
    [
      "a source of line 0",
      /start_line|sources/,
      () => [finding(1, { sources: [cite("api/src/db.ts", 0, 2)] })],
    ],
    [
      "a commit_sha of 39 characters",
      /commit_sha/,
      () => [finding(1)],
      { commit_sha: "a".repeat(39) },
    ],
  ];

  it.each(cases)(
    "given %s, when submit_findings is called, then Refused naming the faulty field, nothing is stored and one invalid_arguments entry is left",
    async (_name, field, build, args) => {
      const ctx = await ready();
      const sources = await sourceCount(ctx.db);

      const refused = expectRefused(await submitFindings(ctx, build(), args));

      expect(refused.startsWith("Refused: invalid arguments (")).toBe(true);
      expect(refused).toMatch(field);
      expect(await findingRows(ctx.db)).toEqual([]);
      expect(await sourceCount(ctx.db)).toBe(sources);
      expect((await onlyEntry(ctx.db)).detail).toEqual({
        reason: "invalid_arguments",
      });
    },
  );

  it("given a faulty second finding, when it is refused, then the text says which one", async () => {
    const ctx = await ready();

    const refused = expectRefused(
      await submitFindings(ctx, [finding(1), finding(2, { title: "" })]),
    );

    expect(refused).toMatch(/findings[.[]1/);
  });
});

describe("decision 051 A: the refusals say where, and all or nothing", () => {
  const three = (over: Record<string, unknown>) => [
    finding(1),
    finding(2),
    finding(3, { sources: [cite("api/src/db.ts", 1, 2), over] }),
  ];
  const cases: [string, string, () => unknown[], Record<string, unknown>?][] = [
    [
      "a file absent at that commit",
      "findings[2].sources[1]",
      () => three(cite("api/src/missing.ts")),
    ],
    [
      "a source that is a directory",
      "findings[2].sources[1]",
      () => three(cite("api/src")),
    ],
    [
      "lines past the end of the file (31 on a file of 30)",
      "findings[2].sources[1]",
      () => three(cite("api/src/db.ts", 28, 31)),
    ],
    [
      "a first source that is absent",
      "findings[0].sources[0]",
      () => [finding(1, { sources: [cite("nowhere/at/all.ts")] })],
    ],
    [
      "a commit GitHub does not know",
      "commit_sha",
      () => [finding(1)],
      { commit_sha: "f".repeat(40) },
    ],
  ];

  it.each(cases)(
    "given %s, when submit_findings is called, then Refused with the location %s, nothing is stored (the valid findings neither) and one refused entry is left",
    async (_name, where, build, args) => {
      const ctx = await ready();
      const sources = await sourceCount(ctx.db);

      const refused = expectRefused(await submitFindings(ctx, build(), args));

      expect(refused).toContain(where);
      expect(await findingRows(ctx.db)).toEqual([]);
      expect(await sourceCount(ctx.db)).toBe(sources);
      const entry = await onlyEntry(ctx.db);
      expect(entry).toMatchObject({
        action: "submit_findings",
        result: "refused",
      });
      expect(entry.detail?.reason).toMatch(/^[a-z_]+$/);
    },
  );

  it("given a file that exists in a later commit only, when it is cited at the older commit, then Refused at its source", async () => {
    const ctx = await ready();
    ctx.git.push({ "api/src/new.ts": text(5) });

    const refused = expectRefused(
      await submitFindings(ctx, [
        finding(1, { sources: [cite("api/src/new.ts")] }),
      ]),
    );

    expect(refused).toContain("findings[0].sources[0]");
  });

  it("given a call that cites 101 distinct files, when it is sent, then Refused saying the limit of 100 files and nothing is stored", async () => {
    const ctx = await ready({ ...FILES, ...manyFiles(101) });

    const refused = expectRefused(await submitFindings(ctx, spread(21, 100)));

    expect(refused).toMatch(/100/);
    expect(await findingRows(ctx.db)).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail?.reason).toMatch(/^[a-z_]+$/);
  });

  it("given an archived project, when submit_findings is called, then Refused project_archived and nothing is stored", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    expectRefused(await submitFindings(ctx));

    expect(await findingRows(ctx.db)).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail).toEqual({
      reason: "project_archived",
    });
  });

  it("given a project that is not Alice's, when she calls the tool on it, then Refused as not found and nothing is stored", async () => {
    const ctx = await ready();

    const result = await submitFindings(ctx, [finding(1)], {
      project_id: ctx.projectId + 999,
    });

    expectRefused(result);
    expect(await findingRows(ctx.db)).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail).toEqual({ reason: "not_found" });
  });
});

describe("decision 051 B: list_findings", () => {
  async function withThree() {
    const ctx = await ready();
    const { findings } = await submitted(ctx, [
      finding(1, {
        kind: "security",
        severity: "critical",
        body_md: "corps-long-un",
        sources: [
          cite("api/src/db.ts", 5, 9),
          cite("web/src/types.ts", 3),
          cite("api/src/db.ts", 20, 21),
        ],
      }),
      finding(2, { kind: "bug", body_md: "corps-long-deux" }),
      finding(3, { kind: "architecture", severity: "low" }),
    ]);
    return { ...ctx, ids: findings.map((f) => f.id) };
  }
  type Listed = {
    id: number;
    title: string;
    kind: string;
    severity: string;
    status: string;
    files: string[];
  };
  const listed = (result: Awaited<ReturnType<typeof listFindings>>) =>
    dataOf<{ findings: Listed[] }>(result).findings;

  it("given three findings, when list_findings is called, then each comes with id, title, kind, severity, status and the distinct files it cites, in the order of the ids", async () => {
    const ctx = await withThree();

    const found = listed(await listFindings(ctx));

    expect(found).toEqual([
      {
        id: ctx.ids[0],
        title: "constat-1",
        kind: "security",
        severity: "critical",
        status: "open",
        files: ["api/src/db.ts", "web/src/types.ts"],
      },
      {
        id: ctx.ids[1],
        title: "constat-2",
        kind: "bug",
        severity: "medium",
        status: "open",
        files: ["api/src/db.ts"],
      },
      {
        id: ctx.ids[2],
        title: "constat-3",
        kind: "architecture",
        severity: "low",
        status: "open",
        files: ["api/src/db.ts"],
      },
    ]);
  });

  it("given findings with long texts, when list_findings is called, then no body_md and none of the texts come back", async () => {
    const ctx = await withThree();

    const result = await listFindings(ctx);

    expect(textOf(result)).not.toContain("corps-long");
    expect(textOf(result)).not.toContain("body_md");
    expect(textOf(result)).not.toContain("étape");
  });

  it("given findings of three kinds, when list_findings is called with kind security, then only the security one comes back; an unknown kind is refused", async () => {
    const ctx = await withThree();

    expect(
      listed(await listFindings(ctx, { kind: "security" })).map((f) => f.id),
    ).toEqual([ctx.ids[0]]);
    expectRefused(await listFindings(ctx, { kind: "style" }));
  });

  it("given findings in three statuses, when list_findings is called with a status, then only those come back, and a rejected one is still listed under dismissed", async () => {
    const ctx = await withThree();
    await setStatus(ctx.db, ctx.ids[1] as number, "dismissed", {
      reason: "faux positif",
    });
    await setStatus(ctx.db, ctx.ids[2] as number, "later");

    expect(
      listed(await listFindings(ctx, { status: "open" })).map((f) => f.id),
    ).toEqual([ctx.ids[0]]);
    expect(
      listed(await listFindings(ctx, { status: "dismissed" })).map((f) => f.id),
    ).toEqual([ctx.ids[1]]);
    expect(
      listed(await listFindings(ctx, { status: "later" })).map((f) => f.id),
    ).toEqual([ctx.ids[2]]);
    expect(listed(await listFindings(ctx))).toHaveLength(3);
    expect(
      listed(await listFindings(ctx, { kind: "bug", status: "dismissed" })),
    ).toHaveLength(1);
    expect(
      listed(
        await listFindings(ctx, { kind: "security", status: "dismissed" }),
      ),
    ).toEqual([]);
  });

  it("given no finding, when list_findings is called, then it answers an empty list", async () => {
    const ctx = await ready();

    expect(listed(await listFindings(ctx))).toEqual([]);
  });

  it("given the findings of another project of Alice, when this project lists, then it does not see them", async () => {
    const ctx = await withThree();
    const empty = await ready();

    expect(listed(await listFindings(empty))).toEqual([]);
    expect(listed(await listFindings(ctx))).toHaveLength(3);
  });

  it("given a project that is not Alice's, when list_findings is called on it, then Refused as not found", async () => {
    const ctx = await ready();
    dataOf(await listFindings(ctx));

    const result = await callTool(ctx.app, ctx.alice.secret, "list_findings", {
      project_id: ctx.projectId + 999,
    });

    expectRefused(result);
  });
});

describe("decision 051 C: a code source belongs to a rule or to a finding, exactly one", () => {
  const insert = (
    db: Awaited<ReturnType<typeof ready>>["db"],
    criterionId: number | null,
    findingId: number | null,
  ) =>
    db.execute(
      sql`insert into code_sources (criterion_id, finding_id, position, path, start_line, end_line, commit_sha)
          values (${criterionId}, ${findingId}, 5, 'api/src/db.ts', 1, 2, ${"a".repeat(40)})`,
    );

  it("given a finding and a rule, when a source is inserted for the finding alone, then it is accepted; for both, or for neither, the CHECK refuses it", async () => {
    const ctx = await withRules();
    const { findings } = await submitted(ctx, [finding(1)]);
    const id = findings[0]?.id as number;
    const criterion = (await criterionIds(ctx.db))[0] as number;

    await insert(ctx.db, null, id);
    await expect(insert(ctx.db, criterion, id)).rejects.toThrow(
      /check constraint/i,
    );
    await expect(insert(ctx.db, null, null)).rejects.toThrow(
      /check constraint/i,
    );
    await insert(ctx.db, criterion, null);
  });

  it("given a finding with sources, when the finding row is deleted, then its sources go with it (ON DELETE CASCADE)", async () => {
    const ctx = await ready();
    const { findings } = await submitted(ctx, [finding(1)]);

    await ctx.db.execute(
      sql`delete from findings where id = ${findings[0]?.id as number}`,
    );

    expect(await findingSourceRows(ctx.db)).toEqual([]);
  });

  it("given a finding, when it is set to ticketed with no ticket, then the CHECK refuses it (ticket_id is filled if and only if ticketed)", async () => {
    const ctx = await ready();
    const { findings } = await submitted(ctx, [finding(1)]);

    await expect(
      ctx.db.execute(
        sql`update findings set status = 'ticketed' where id = ${findings[0]?.id as number}`,
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
