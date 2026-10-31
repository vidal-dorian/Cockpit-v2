import { readFileSync } from "node:fs";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { projectMembers, projects } from "./db/schema.ts";
import {
  checkWriteFiles,
  type githubClient,
  type ReadGitHub,
} from "./github.ts";
import { type HealthLine, healthLines, webhookLine } from "./health.ts";

const ALREADY_TRACKED = "Ce repo est déjà suivi dans Cockpit";
const GITHUB_DOWN =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";

const importBody = z.object({ githubRepoId: z.number().int() });

// The plan as `planRepoWrite` served it and the page hands it back (decision 027 D); the paths are checked by `checkWriteFiles`.
const prepareBody = z.object({
  plan: z.object({
    baseSha: z.string(),
    signature: z.string().optional(),
    files: z.array(
      z.object({
        path: z.string(),
        content: z.string(),
        status: z.enum(["create", "same", "exists"]),
        current: z.string().optional(),
      }),
    ),
  }),
});

const PREPARE_MESSAGE = "feat: prepare the repo for Claude (Cockpit)";
/** Where each file of `catalog/` goes in a repo (decision 027 B). */
const CATALOG_FILES = [
  "agents/test-writer.md",
  "agents/developer.md",
  "agents/reviewer.md",
  "skills/dev-us/SKILL.md",
  "skills/write-us/SKILL.md",
].map((file) => ({
  path: `.claude/${file}`,
  content: readFileSync(
    new URL(`../../catalog/${file}`, import.meta.url),
    "utf8",
  ),
}));
const CLAUDE_MD = {
  path: "CLAUDE.md",
  content: readFileSync(
    new URL("../../catalog/CLAUDE.md", import.meta.url),
    "utf8",
  ),
  // Never beside a CLAUDE.md of the project (decision 013 C).
  unlessExists: ["CLAUDE.md", ".claude/CLAUDE.md"],
};

const unauthorized = { error: "Unauthorized" };
export const NOT_CONFIGURED =
  "Cockpit n'est pas encore installé : termine l'assistant de démarrage.";

/** Whether a number can be the identity of a row: a PostgreSQL integer from 1 (anything else matches nothing, and a query with it would fail). */
export const isDatabaseId = (id: number) =>
  Number.isInteger(id) && id >= 1 && id <= 2147483647;

/** The one place that says whether a user belongs to a project; anyone else gets undefined, as if it did not exist (decisions 004 and 011 E). */
export async function memberProject(db: Db, userId: number, projectId: number) {
  if (!isDatabaseId(projectId)) return undefined;
  const [project] = await db
    .select({ project: projects })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.projectId, projectId),
      ),
    );
  return project?.project;
}

/** Every project the user belongs to, active ones first (same rule as `memberProject`). */
export async function memberProjects(db: Db, userId: number) {
  const rows = await db
    .select({ project: projects })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId))
    .orderBy(asc(sql`${projects.archivedAt} is not null`), asc(projects.id));
  return rows.map((row) => row.project);
}

const present = (p: typeof projects.$inferSelect) => ({
  id: p.id,
  fullName: p.fullName,
  defaultBranch: p.defaultBranch,
  archived: p.archivedAt !== null,
});

type GitHub = ReturnType<typeof githubClient>;
type Env = {
  Variables: {
    github: GitHub;
    installUrl: string;
    appSettingsUrl: string;
    publicUrl: string;
  };
};

/** The repos the user opened to the App on GitHub; null when the App is not installed on their account. */
async function installedRepos(github: GitHub, login: string, githubId: number) {
  const installationId = await github.findUserInstallation(login, githubId);
  if (installationId === null) return null;
  return {
    installationId,
    repos: await github.listInstallationRepos(installationId),
  };
}

export function projectRoutes(
  db: Db,
  readGitHub: ReadGitHub,
  healthCacheSize: number,
  now: () => number,
) {
  // Decision 013: the health lines of the repos shown lately, by installation and repo, with the commit they were computed from. Least recently used out first (a Map keeps insertion order).
  type HealthEntry = {
    etag: string;
    commitSha: string;
    /** The address the lines were judged against (decision 023 C). */
    publicUrl: string;
    lines: HealthLine[];
  };
  const healthCache = new Map<string, HealthEntry>();
  const remember = (key: string, entry: HealthEntry) => {
    healthCache.delete(key);
    healthCache.set(key, entry);
    for (const oldest of healthCache.keys()) {
      if (healthCache.size <= healthCacheSize) break;
      healthCache.delete(oldest);
    }
  };

  // Decision 024 F: the App's webhook reads are the same for every project, so they are kept one minute, apart from the per-commit cache above. Only successful reads are kept.
  let hook: { at: number; read: Awaited<ReturnType<GitHub["readWebhook"]>> };
  const readWebhook = async (github: GitHub) => {
    if (hook && now() - hook.at <= 60_000) return hook.read;
    try {
      hook = { at: now(), read: await github.readWebhook() };
      return hook.read;
    } catch (error) {
      console.error("GitHub webhook read failed:", error);
      return null;
    }
  };

  /** Before the session check: without the GitHub App there is nothing to answer, whoever asks. */
  const gate = createMiddleware<Env>(async (c, next) => {
    const ready = await readGitHub();
    if (!ready) return c.json({ error: NOT_CONFIGURED }, 503);
    c.set("github", ready.github);
    c.set("installUrl", ready.installUrl);
    c.set("appSettingsUrl", ready.appSettingsUrl);
    c.set("publicUrl", ready.publicUrl);
    await next();
  });

  return new Hono<Env>()
    .use("/api/projects/*", gate)
    .use("/api/tickets/*", gate)
    .use("/api/stories/*", gate)
    .use("/api/github/*", gate)
    .use("/api/installation", gate)
    .get("/api/installation", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      try {
        const installationId = await c
          .get("github")
          .findUserInstallation(user.login, user.githubId);
        return c.json({
          installed: installationId !== null,
          installUrl: c.get("installUrl"),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .get("/api/github/repositories", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const github = c.get("github");
      const installUrl = c.get("installUrl");
      try {
        const found = await installedRepos(github, user.login, user.githubId);
        if (!found)
          return c.json({ installUrl, installed: false, repositories: [] });
        const tracked = new Set(
          (await memberProjects(db, user.userId)).map((p) => p.githubRepoId),
        );
        return c.json({
          installUrl,
          installed: true,
          repositories: found.repos.map((repo) => ({
            githubRepoId: repo.id,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
            imported: tracked.has(repo.id),
          })),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: GITHUB_DOWN }, 502);
      }
    })
    .get("/api/projects", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const mine = await memberProjects(db, user.userId);
      return c.json({ projects: mine.map(present) });
    })
    .post(
      "/api/projects",
      validator("json", (value, c) => {
        const parsed = importBody.safeParse(value);
        if (!parsed.success) return c.json({ error: "Bad request" }, 400);
        return parsed.data;
      }),
      async (c) => {
        const user = await currentUser(db, c);
        if (!user) return c.json(unauthorized, 401);
        const { githubRepoId } = c.req.valid("json");

        // The name, branch and installation come from GitHub, never from the request (decision 011 B).
        let found: Awaited<ReturnType<typeof installedRepos>>;
        try {
          found = await installedRepos(
            c.get("github"),
            user.login,
            user.githubId,
          );
        } catch (error) {
          console.error("GitHub request failed:", error);
          return c.json({ error: GITHUB_DOWN }, 502);
        }
        const repo = found?.repos.find((r) => r.id === githubRepoId);

        const entry: Entry = {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: "import_project",
          args: {},
        };
        try {
          const project = await act(db, entry, async (tx) => {
            if (!found || !repo) throw new Refused("repo_not_available");
            // The unique github_repo_id decides, so two parallel imports cannot both win.
            const [created] = await tx
              .insert(projects)
              .values({
                githubRepoId: repo.id,
                fullName: repo.full_name,
                defaultBranch: repo.default_branch,
                installationId: found.installationId,
              })
              .onConflictDoNothing({ target: projects.githubRepoId })
              .returning();
            if (!created) throw new Refused("already_tracked");
            await tx.insert(projectMembers).values({
              projectId: created.id,
              userId: user.userId,
              role: "owner",
            });
            entry.projectId = created.id;
            entry.args = { projectId: created.id };
            return created;
          });
          return c.json({ project: present(project) }, 201);
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          return error.message === "already_tracked"
            ? c.json({ error: ALREADY_TRACKED }, 409)
            : c.json(
                { error: "Repo introuvable dans ton installation de l'App" },
                404,
              );
        }
      },
    )
    .get("/api/projects/:id/health", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      // The root (the commit of HEAD) is read on each call; the rest only when it changed (decision 013). A failure leaves the cache as it was.
      const key = `${project.installationId}/${project.fullName}`;
      const publicUrl = c.get("publicUrl");
      const found = healthCache.get(key);
      // Lines judged against another address are not valid any more.
      const cached = found?.publicUrl === publicUrl ? found : undefined;
      const webhook = async () =>
        webhookLine(await readWebhook(c.get("github")), publicUrl);
      try {
        const read = await c
          .get("github")
          .readRepoFiles(project.installationId, project.fullName, cached);
        if (!read) return c.json({ error: "repo_unreachable" }, 409);
        if (read.unchanged) {
          // Only asked for with a cached entry, so there is one.
          const entry = { ...(cached as HealthEntry), etag: read.etag };
          remember(key, entry);
          return c.json({ lines: [...entry.lines, await webhook()] });
        }
        const lines = healthLines(read.files, publicUrl);
        // An empty repository has no ETag: nothing to remember.
        if (read.etag)
          remember(key, {
            etag: read.etag,
            commitSha: read.commitSha,
            publicUrl,
            lines,
          });
        return c.json({ lines: [...lines, await webhook()] });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/prepare", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      if (project.archivedAt) return c.json({ error: "project_archived" }, 409);
      try {
        // A read is not an action: no history entry (decision 013 G).
        const plan = await c
          .get("github")
          .planRepoWrite(project.installationId, project.fullName, [
            ...CATALOG_FILES,
            CLAUDE_MD,
          ]);
        if ("refused" in plan) return c.json({ error: plan.refused }, 409);
        return c.json({ plan });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/prepare/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      // By hand, not `validator`: a missing or unreadable body must answer our JSON 400 too.
      const parsed = prepareBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { plan } = parsed.data;
      try {
        checkWriteFiles(plan.files);
      } catch {
        return c.json({ error: "Bad request" }, 400);
      }
      const id = Number(c.req.param("id"));
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "prepare_repo",
        args: {},
      };
      try {
        const done = await act(db, entry, async (tx) => {
          const project = await memberProject(tx, user.userId, id);
          if (!project) throw new Refused("not_found");
          entry.projectId = id;
          if (project.archivedAt) throw new Refused("project_archived");
          const result = await c
            .get("github")
            .applyRepoWrite(
              project.installationId,
              project.fullName,
              plan,
              PREPARE_MESSAGE,
            );
          if ("refused" in result) throw new Refused(result.refused);
          entry.args = { created: result.created.length };
          entry.githubEffects = {
            commitSha: result.commitSha,
            pullRequest: result.pullRequest?.number ?? null,
          };
          return result;
        });
        return c.json(done);
      } catch (error) {
        if (!(error instanceof Refused)) {
          // `act` has logged it.
          return c.json({ error: "github_unavailable" }, 502);
        }
        if (error.message === "not_found")
          return c.json({ error: "Not found" }, 404);
        return error.message === "pull_request_forbidden"
          ? c.json(
              {
                error: error.message,
                appSettingsUrl: c.get("appSettingsUrl"),
              },
              409,
            )
          : c.json({ error: error.message }, 409);
      }
    })
    .post("/api/projects/:id/archive", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const id = Number(c.req.param("id"));
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "archive_project",
        args: {},
      };
      try {
        await act(db, entry, async (tx) => {
          const project = await memberProject(tx, user.userId, id);
          if (!project) throw new Refused("not_found");
          entry.projectId = id;
          entry.args = { projectId: id };
          // Archiving twice keeps the first date.
          await tx
            .update(projects)
            .set({ archivedAt: new Date() })
            .where(and(eq(projects.id, id), isNull(projects.archivedAt)));
        });
        return c.json({ ok: true });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return c.json({ error: "Not found" }, 404);
      }
    });
}
