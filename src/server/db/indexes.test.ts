import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openTestDatabase } from "./test-db.ts";

async function indexes(table: string) {
  const db = await openTestDatabase();
  const res = await db.execute(
    sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = ${table}`,
  );
  return (res as unknown as { rows: { indexdef: string }[] }).rows.map(
    (r) => r.indexdef,
  );
}

/** True when a full (non-partial) index of the table starts with this column (a composite starting with it serves the lookup). */
function leadsWith(defs: string[], column: string) {
  return defs.some(
    (d) =>
      !/\swhere\s/i.test(d) &&
      new RegExp(`\\(\\s*"?${column}"?[,)\\s]`).test(d),
  );
}

describe("missing indexes", () => {
  it.each([
    ["user_stories", "ticket_id"],
    ["acceptance_criteria", "story_id"],
    ["run_steps", "run_id"],
    ["runs", "story_id"],
    ["cloud_launches", "session_id"],
    ["cloud_launches", "run_id"],
    ["cloud_launches", "user_id"],
    ["user_stories", "pr_number"],
    ["user_stories", "issue_number"],
  ])(
    "given the migrated database, when its indexes are listed, then %s has one on %s",
    async (table, column) => {
      expect(leadsWith(await indexes(table), column)).toBe(true);
    },
  );

  it("given webhook_deliveries migrated, when its indexes are listed, then a partial index covers the unprocessed deliveries", async () => {
    const defs = await indexes("webhook_deliveries");
    expect(
      defs.some((d) => /where\s+\(?\s*\(?"?processed_at"?\s+is null/i.test(d)),
    ).toBe(true);
  });
});
