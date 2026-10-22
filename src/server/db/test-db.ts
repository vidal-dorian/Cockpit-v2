import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, migrationsFolder } from "./db.ts";
import * as schema from "./schema.ts";

/** An empty in-memory PostgreSQL (PGlite) with all migrations applied; for tests only. */
export async function openTestDatabase(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
