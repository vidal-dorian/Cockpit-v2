import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accountRoutes } from "./accounts.ts";
import { authRoutes } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { githubReader } from "./github.ts";
import { historyRoutes } from "./history.ts";
import { instanceReader, WEBHOOK_PATH } from "./instance.ts";
import { mcpRoutes } from "./mcp.ts";
import { oauthRoutes } from "./oauth.ts";
import { projectRoutes } from "./projects.ts";
import { questionRoutes } from "./questions.ts";
import { type FireRoutine, routineRoutes } from "./routines.ts";
import { runRoutes } from "./runs.ts";
import { setupRoutes } from "./setup.ts";
import { storyRoutes } from "./stories.ts";
import { ticketRoutes } from "./tickets.ts";
import { tokenRoutes } from "./tokens.ts";
import { webhookRoutes } from "./webhooks.ts";

export type AppOptions = {
  /** Decrypts the GitHub secrets stored in the database (decision 012 F). */
  encryptionKey: Buffer;
  /** Printed in the server logs at the first start; opens the wizard. */
  setupCode: string;
  /** How many repos' health check the memory cache keeps (decision 013); 1000 when absent. */
  healthCacheSize?: number;
  /** After how many milliseconds a ticket abandon starts no new GitHub issue sync (decision 020 F); 30,000 when absent. */
  issueSyncBudgetMs?: number;
  /** How a client's CIMD document is read (decision 021 B); the global fetch when absent. Cockpit adds the abort signal and enforces the size limit itself. */
  fetchClientMetadata?: (url: string, init?: RequestInit) => Promise<Response>;
  /** The call to a Claude Code routine's `/fire` address (decision 022 E); the global fetch when absent. Cockpit adds the abort signal itself. */
  fireRoutine?: FireRoutine;
  /** The clock in milliseconds, for the life of authorization codes, of the CIMD cache and the next run of a schedule; Date.now when absent. */
  now?: () => number;
};

const apiBodyLimit = bodyLimit({ maxSize: 256 * 1024 });
// The agent and team editors send a file of up to 1 MiB, twice (decision 030 E), which covers realistic agent files (JSON escaping could inflate a worst-case one past it).
const agentsBodyLimit = bodyLimit({ maxSize: 4 * 1024 * 1024 });
const AGENTS_APPLY_PATH = /^\/api\/projects\/[^/]+\/(agents|team)\/apply$/;

export function createApp(
  db: Db,
  version: string,
  {
    encryptionKey,
    setupCode,
    healthCacheSize = 1000,
    issueSyncBudgetMs = 20_000,
    fetchClientMetadata = (url, init) => fetch(url, init),
    fireRoutine = (url, init) => fetch(url, init),
    now = Date.now,
  }: AppOptions,
) {
  const readInstance = instanceReader(db, encryptionKey);
  const readGitHub = githubReader(readInstance);
  return (
    new Hono()
      // Nobody needs to frame Cockpit: every response forbids it, so the Autoriser button cannot be clickjacked under any spelling of its path (decision 021 C).
      .use("*", async (c, next) => {
        await next();
        c.res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
        c.res.headers.set("X-Frame-Options", "DENY");
      })
      // A JSON body is read whole in memory: 256 KiB at most on every API route (the apply routes of the agent and team editors have a larger one), before the session and the validation (decision 014). GitHub's webhook has its own limit (decision 024 A).
      .use("/api/*", (c, next) =>
        c.req.path === WEBHOOK_PATH
          ? next()
          : (AGENTS_APPLY_PATH.test(c.req.path)
              ? agentsBodyLimit
              : apiBodyLimit)(c, next),
      )
      .get("/api/health", async (c) => {
        await db.execute(sql`select 1`);
        return c.json({ status: "ok", version });
      })
      .route("/", setupRoutes(db, readInstance, encryptionKey, setupCode))
      .route("/", authRoutes(db, readInstance, readGitHub))
      .route("/", historyRoutes(db))
      .route("/", accountRoutes(db, readInstance))
      .route("/", webhookRoutes(db, readInstance))
      .route("/", projectRoutes(db, readGitHub, healthCacheSize, now))
      // After projectRoutes: its gate covers the ticket and story routes.
      .route("/", ticketRoutes(db, readGitHub, issueSyncBudgetMs))
      .route("/", storyRoutes(db, readGitHub))
      .route("/", runRoutes(db, readGitHub))
      .route("/", questionRoutes(db))
      .route("/", routineRoutes(db, { encryptionKey, fireRoutine }, now))
      .route("/", tokenRoutes(db))
      .route("/", mcpRoutes(db, readGitHub, readInstance, version))
      .route("/", oauthRoutes(db, readInstance, fetchClientMetadata, now))
      // The three discovery paths of decision 021 A are served above; any other one is a JSON 404, not the page.
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
