import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, migrationsFolder } from "./db.ts";
import * as schema from "./schema.ts";

// Booting PGlite and applying the migrations takes seconds; loading a dump of an already
// migrated database takes a fraction of that. So it is done once per test file.
let migratedDump: Promise<File | Blob> | undefined;

async function dumpMigratedDatabase(): Promise<File | Blob> {
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder });
  const dump = await pg.dumpDataDir("none");
  await pg.close();
  return dump;
}

/** An empty in-memory PostgreSQL (PGlite) with all migrations applied; for tests only. */
export async function openTestDatabase(): Promise<Db> {
  migratedDump ??= dumpMigratedDatabase();
  return drizzle(await PGlite.create({ loadDataDir: await migratedDump }), {
    schema,
  });
}
