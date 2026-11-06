import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { inject, onTestFinished } from "vitest";
import type { Db } from "./db.ts";
import * as schema from "./schema.ts";

// A new PGlite takes seconds (initdb in WASM), loading a migrated one about one, emptying its tables milliseconds.
// So test-db-setup.ts migrates once per run, each worker (the server's files share their modules, vitest.config.ts)
// loads that database once, and every test gets it back emptied instead of a new one.
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
  if (!claimed) {
    try {
      // Throws outside a test (beforeAll): such a database outlives the test, the shared one cannot be it.
      onTestFinished(() => {
        claimed = false;
      });
      claimed = true;
    } catch {}
    if (claimed) {
      await client.exec(reset);
      return db;
    }
  }
  // Outside a test, or a second database in the same test: a new one.
  return drizzle(new PGlite({ loadDataDir: empty }), { schema });
}
