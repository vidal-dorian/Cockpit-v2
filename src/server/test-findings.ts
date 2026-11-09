import { sql } from "drizzle-orm";
import { type Ctx, cite, readyPro as ready } from "./test-code-map.ts";
import { callTool, dataOf, type TestDb } from "./test-mcp.ts";

// Shared by the tests of slice R5 (decision 051): the arguments of `submit_findings` and `list_findings`, and the tables read with raw SQL
// (so no test depends on the Drizzle export of a column).
//
// Pinned names (decision 051 and 007 give the columns and the arguments; the rest is the choice of these tests, the developer follows them):
// - findings(id, project_id, kind, source, title, body_md, severity, effort, status, ticket_id, dismiss_reason, commit_sha, created_at);
//   code_sources gains finding_id (criterion_id and finding_id: exactly one filled, CHECK).
// - submit_findings({ project_id, commit_sha, findings: [{ kind, title, body_md, severity, effort?, sources: [{ path, start_line, end_line }] }] }) answers { findings: [{ id }] }, in order.
// - list_findings({ project_id, kind?, status? }) answers { findings: [{ id, title, kind, severity, status, files: [path] }] } ordered by id, `files` being the distinct
//   cited paths in the order of citation; never `body_md`.

export { type Ctx, cite, ready };

export const finding = (n: number, over: Record<string, unknown> = {}) => ({
  kind: "bug",
  title: `constat-${n}`,
  body_md: `texte-${n}\n\n- étape ${n}`,
  severity: "medium",
  sources: [cite("api/src/db.ts", 5, 9)],
  ...over,
});

/** A `submit_findings` call on the project of `ctx`; `args` overrides any argument. */
export const submitFindings = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId" | "sha">,
  findings: unknown[] = [finding(1)],
  args: Record<string, unknown> = {},
) =>
  callTool(ctx.app, ctx.alice.secret, "submit_findings", {
    project_id: ctx.projectId,
    commit_sha: ctx.sha,
    findings,
    ...args,
  });

export const listFindings = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId">,
  args: Record<string, unknown> = {},
) =>
  callTool(ctx.app, ctx.alice.secret, "list_findings", {
    project_id: ctx.projectId,
    ...args,
  });

export type Submitted = { findings: { id: number }[] };
export const submitted = async (
  ctx: Parameters<typeof submitFindings>[0],
  findings?: unknown[],
  args?: Record<string, unknown>,
) => dataOf<Submitted>(await submitFindings(ctx, findings, args));

const all = async <T>(db: TestDb, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

export type FindingRow = {
  id: number;
  project_id: number;
  kind: string;
  source: string;
  title: string;
  body_md: string;
  severity: string;
  effort: string | null;
  status: string;
  ticket_id: number | null;
  dismiss_reason: string | null;
  commit_sha: string;
};
export const findingRows = (db: TestDb) =>
  all<FindingRow>(
    db,
    sql`select id, project_id, kind, source, title, body_md, severity, effort, status, ticket_id, dismiss_reason, commit_sha from findings order by id`,
  );

export type FindingSourceRow = {
  finding_id: number | null;
  criterion_id: number | null;
  position: number;
  path: string;
  start_line: number;
  end_line: number;
  commit_sha: string;
};
export const findingSourceRows = (db: TestDb) =>
  all<FindingSourceRow>(
    db,
    sql`select finding_id, criterion_id, position, path, start_line, end_line, commit_sha from code_sources where finding_id is not null order by finding_id, position`,
  );

/** What a refused call must leave as it was, read from tables that exist before the slice would exist (so a refusal test fails on the tool, not on a missing table). */
export const sourceCount = async (db: TestDb) =>
  (
    await all<{ n: number }>(
      db,
      sql`select count(*)::int as n from code_sources`,
    )
  )[0]?.n;

/** Puts a finding in any status by hand: only the human routes decide, and these are tested apart. */
export const setStatus = (
  db: TestDb,
  id: number,
  status: string,
  extra: { reason?: string } = {},
) =>
  db.execute(
    sql`update findings set status = ${status}, dismiss_reason = ${extra.reason ?? null} where id = ${id}`,
  );
