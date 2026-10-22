import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.ts";

export const migrationsFolder = join(import.meta.dirname, "../../../drizzle");

/** Connects to PostgreSQL and brings the database up to the latest migration. */
export async function openDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url });
  // Without a listener, an idle client lost to a PostgreSQL restart would crash the process.
  pool.on("error", (error) =>
    console.error("PostgreSQL idle client error:", error.message),
  );
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

/** Any PostgreSQL driver: node-postgres in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
