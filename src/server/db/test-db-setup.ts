import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { TestProject } from "vitest/node";
import { migrationsFolder } from "./db.ts";

declare module "vitest" {
  interface ProvidedContext {
    emptyDatabase: string;
  }
}

/** Vitest global setup: initdb and the migrations run once for the whole run, each test file loads the result. */
export default async function setup(project: TestProject) {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder });
  const dir = await mkdtemp(join(tmpdir(), "cockpit-test-db-"));
  const file = join(dir, "empty.tar");
  await writeFile(file, await (await client.dumpDataDir("none")).bytes());
  await client.close();
  project.provide("emptyDatabase", file);
  return () => rm(dir, { recursive: true, force: true });
}
