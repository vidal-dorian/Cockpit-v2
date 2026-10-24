import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { projectMembers, projects } from "./db/schema.ts";
import type { githubClient, ReadGitHub } from "./github.ts";
import { healthLines } from "./health.ts";

const ALREADY_TRACKED = "Ce repo est déjà suivi dans Cockpit";
const GITHUB_DOWN =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";

const importBody = z.object({ githubRepoId: z.number().int() });

const unauthorized = { error: "Unauthorized" };
export const NOT_CONFIGURED =
  "Cockpit n'est pas encore installé : termine l'assistant de démarrage.";

/** The one place that says whether a user belongs to a project; anyone else gets undefined, as if it did not exist (decisions 004 and 011 E). */
export async function memberProject(db: Db, userId: number, projectId: number) {
  // Not a PostgreSQL integer: no such project, and the query must not run (it would fail).
  if (!Number.isInteger(projectId) || projectId < 1 || projectId > 2147483647)
    return undefined;
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
  Variables: { github: GitHub; installUrl: string; publicUrl: string };
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

export function projectRoutes(db: Db, readGitHub: ReadGitHub) {
  /** Before the session check: without the GitHub App there is nothing to answer, whoever asks. */
  const gate = createMiddleware<Env>(async (c, next) => {
    const ready = await readGitHub();
    if (!ready) return c.json({ error: NOT_CONFIGURED }, 503);
    c.set("github", ready.github);
    c.set("installUrl", ready.installUrl);
    c.set("publicUrl", ready.publicUrl);
    await next();
  });

  return new Hono<Env>()
    .use("/api/projects/*", gate)
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
      // Read on each call, nothing is stored (decision 013).
      try {
        const files = await c
          .get("github")
          .readRepoFiles(project.installationId, project.fullName);
        if (!files) return c.json({ error: "repo_unreachable" }, 409);
        return c.json({ lines: healthLines(files, c.get("publicUrl")) });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
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
