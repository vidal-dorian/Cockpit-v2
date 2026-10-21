import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

const migrationsFolder = join(import.meta.dirname, "../../../drizzle");

/** Opens the SQLite file (or ":memory:") and brings it up to the latest migration. */
export function openDatabase(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  // SQLite ignores foreign keys unless asked; decision 002 relies on them.
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

export type Db = ReturnType<typeof openDatabase>;
