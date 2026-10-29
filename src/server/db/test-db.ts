import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, inject, onTestFinished } from "vitest";
import type { Db } from "./db.ts";
import * as schema from "./schema.ts";

// A new PGlite takes seconds (initdb in WASM), loading a migrated one about one, emptying its tables milliseconds.
// So test-db-setup.ts migrates once per run, each test file (vitest gives each its own module) loads that database
// once, and every test gets it back emptied instead of a new one.
let shared:
  | Promise<{ client: PGlite; db: Db; empty: Blob; reset: string }>
  | undefined;
let claimed = false;

async function openShared() {
  const empty = new Blob([await readFile(inject("emptyDatabase"))]);
  const client = new PGlite({ loadDataDir: empty });
  const db = drizzle(client, { schema });
  const { rows } = await client.query<{ tables: string }>(
    "select string_agg(quote_ident(tablename), ', ') as tables from pg_tables where schemaname = 'public'",
  );
  // The replica role skips the triggers that keep `history` append-only, which refuse a TRUNCATE (migration 0003).
  const reset = `set session_replication_role = replica; truncate ${rows[0]?.tables} restart identity cascade; set session_replication_role = origin;`;
  return { client, db, empty, reset };
}

/** An empty in-memory PostgreSQL (PGlite) with all migrations applied; for tests only. */
export async function openTestDatabase(): Promise<Db> {
  shared ??= openShared();
  const { client, db, empty, reset } = await shared;
  // Outside a test (beforeAll) or for a second database in the same test, the shared one is not free: a new one.
  if (claimed || !expect.getState().currentTestName)
    return drizzle(new PGlite({ loadDataDir: empty }), { schema });
  claimed = true;
  onTestFinished(() => {
    claimed = false;
  });
  await client.exec(reset);
  return db;
}
