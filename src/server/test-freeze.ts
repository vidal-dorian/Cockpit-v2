import { sql } from "drizzle-orm";
import type { TestDb } from "./test-mcp.ts";

// Shared by the tests of slice R4 (decision 050). Names pinned here, the developer follows them:
// - user_stories.pr_app_files (text[], null until read) and user_stories.pr_app_files_count (integer, null with it): the paths of the PR outside the tests, 20 at most
//   (in the order GitHub lists them), and the total number of such paths. A takeover PR whose files are all tests reads as [] and 0.
// - isTestPath(path) is exported by src/server/pr-files.ts.
// - verdict() takes `kind` ("feature" | "takeover") and `prAppFiles` (string[] | null) and may answer the reason `app_code_changed`, the LAST of the reasons (after changes_requested).
// - GET /api/runs/:id gives story.kind, story.prAppFiles and story.prAppFilesCount.
// - GET /api/projects/:id/features: a rule of a done story whose criterion is passed has state "frozen" (otherwise "pending" | "kept", as before).

export const asTakeover = (db: TestDb, id: number) =>
  db.execute(sql`update user_stories set kind = 'takeover' where id = ${id}`);

const literal = (paths: string[]) =>
  `{${paths.map((p) => JSON.stringify(p)).join(",")}}`;

/** Writes the cache of the app files as a read of the PR would. */
export const seedAppFiles = (
  db: TestDb,
  id: number,
  paths: string[],
  count = paths.length,
) =>
  db.execute(
    sql`update user_stories set pr_app_files = ${literal(paths)}::text[], pr_app_files_count = ${count} where id = ${id}`,
  );

export async function appFiles(db: TestDb, id: number) {
  const result = await db.execute(
    sql`select to_jsonb(u)->'pr_app_files' as files, to_jsonb(u)->'pr_app_files_count' as count from user_stories u where id = ${id}`,
  );
  return (
    result as unknown as {
      rows: { files: string[] | null; count: number | null }[];
    }
  ).rows[0] as { files: string[] | null; count: number | null };
}
