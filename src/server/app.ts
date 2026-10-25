import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accountRoutes } from "./accounts.ts";
import { authRoutes } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { githubReader } from "./github.ts";
import { historyRoutes } from "./history.ts";
import { instanceReader } from "./instance.ts";
import { mcpRoutes } from "./mcp.ts";
import { projectRoutes } from "./projects.ts";
import { setupRoutes } from "./setup.ts";
import { ticketRoutes } from "./tickets.ts";
import { tokenRoutes } from "./tokens.ts";

export type AppOptions = {
  /** Decrypts the GitHub secrets stored in the database (decision 012 F). */
  encryptionKey: Buffer;
  /** Printed in the server logs at the first start; opens the wizard. */
  setupCode: string;
  /** How many repos' health check the memory cache keeps (decision 013); 1000 when absent. */
  healthCacheSize?: number;
};

export function createApp(
  db: Db,
  version: string,
  { encryptionKey, setupCode, healthCacheSize = 1000 }: AppOptions,
) {
  const readInstance = instanceReader(db, encryptionKey);
  const readGitHub = githubReader(readInstance);
  return (
    new Hono()
      // A JSON body is read whole in memory: 256 KiB at most on every API route, before the session and the validation (decision 014).
      .use("/api/*", bodyLimit({ maxSize: 256 * 1024 }))
      .get("/api/health", async (c) => {
        await db.execute(sql`select 1`);
        return c.json({ status: "ok", version });
      })
      .route("/", setupRoutes(db, readInstance, encryptionKey, setupCode))
      .route("/", authRoutes(db, readInstance, readGitHub))
      .route("/", historyRoutes(db))
      .route("/", accountRoutes(db, readInstance))
      .route("/", projectRoutes(db, readGitHub, healthCacheSize))
      // After projectRoutes: its gate covers the ticket routes.
      .route("/", ticketRoutes(db))
      .route("/", tokenRoutes(db))
      .route("/", mcpRoutes(db, readGitHub, version))
      // OAuth discovery (006, after the MVP) is not offered yet: a JSON 404, not the page, tells a client so.
      .all("/.well-known/*", (c) => c.json({ error: "Not found" }, 404))
      // An unknown API route is an error, not a reason to send the page.
      .all("/api/*", (c) => c.json({ error: "Not found" }, 404))
      // The page built by Vite; every other path gets index.html so the React router can handle it.
      .use("/*", serveStatic({ root: "./dist/web" }))
      .get("*", serveStatic({ path: "./dist/web/index.html" }))
  );
}

/** The type of the routes, shared with the web client (src/web/api.ts). */
export type AppType = ReturnType<typeof createApp>;
