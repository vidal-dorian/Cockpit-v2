import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser, exchangeCode, sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { templateRequests, users } from "./db/schema.ts";
import type { githubClient, ReadGitHub } from "./github.ts";
import { healthLines } from "./health.ts";
import type { InstanceSettings, ReadInstance } from "./instance.ts";
import { overQuota } from "./plans.ts";
import {
  installedRepos,
  NOT_CONFIGURED,
  trackRepo,
  writeAccess,
} from "./projects.ts";

// The login's callback is the only redirect address the App declares (decision 068 D); the creation's own cookie tells the two returns apart.
const CALLBACK = "/api/auth/callback";
const STATE_COOKIE = "cockpit_template_state";
const REQUEST_MS = 10 * 60_000;
const failed = (code: string) => `/projets/nouveau?erreur=${code}`;

// Decision 068 C: the characters GitHub accepts in a repo name, 100 at most; "." and ".." are reserved.
const repoName = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/)
  .refine((name) => name !== "." && name !== "..");
const createBody = z.object({
  template: z.string().min(1),
  owner: z.string().min(1),
  name: repoName,
  description: z.string().max(350).optional(),
  private: z.boolean(),
});

type Ready = NonNullable<Awaited<ReturnType<ReadGitHub>>>;
// `github` is set by the gate of the project routes, which covers /api/projects/*.
type Env = {
  Variables: { ready: Ready; github: ReturnType<typeof githubClient> };
};
type Landed =
  | {
      installationId: number;
      repo: { id: number; full_name: string; default_branch: string };
    }
  | { refused: string }
  | { outside: true }
  | { overQuota: true }
  | { failure: unknown };

export function templateRoutes(
  db: Db,
  readInstance: ReadInstance,
  readGitHub: ReadGitHub,
) {
  /** Without the GitHub App there is nothing to answer, whoever asks (as the gate of the project routes). */
  const gate = createMiddleware<Env>(async (c, next) => {
    const ready = await readGitHub();
    if (!ready) return c.json({ error: NOT_CONFIGURED }, 503);
    c.set("ready", ready);
    await next();
  });

  return new Hono<Env>()
    .use("/api/templates", gate)
    .use("/api/templates/*", gate)
    .get("/api/templates", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const ready = c.get("ready");
      const { github } = ready;
      try {
        const found = await installedRepos(github, user.login, user.githubId);
        if (!found)
          return c.json({
            installed: false,
            installUrl: ready.installUrl,
            owners: [],
            templates: [],
            permission: {
              repositoryCreation: false,
              installationUrl: ready.installUrl,
            },
          });
        const { installationId, repos } = found;
        const [access, templates] = await Promise.all([
          github.readAppAccess(installationId),
          // A read is not an action: no history entry (decision 013 G). The lines are read as for a project, without its cache.
          Promise.all(
            repos
              .filter((repo) => repo.is_template)
              .map(async (repo) => {
                const read = await github.readRepoFiles(
                  installationId,
                  repo.full_name,
                );
                return {
                  githubRepoId: repo.id,
                  fullName: repo.full_name,
                  defaultBranch: repo.default_branch,
                  lines:
                    read && !read.unchanged
                      ? healthLines(read.files, ready.publicUrl)
                      : [],
                };
              }),
          ),
        ]);
        const { granted, ...permission } = writeAccess(
          access,
          "repository_creation",
          ready.appSettingsUrl,
        );
        return c.json({
          installed: true,
          installUrl: ready.installUrl,
          owners: [user.login],
          templates,
          permission: { repositoryCreation: granted, ...permission },
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .get("/api/templates/name", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { owner } = c.req.query();
      const name = repoName.safeParse(c.req.query("name"));
      if (owner !== user.login || !name.success)
        return c.json({ error: "Bad request" }, 400);
      try {
        const { github } = c.get("ready");
        const installationId = await github.findUserInstallation(
          user.login,
          user.githubId,
        );
        if (installationId === null)
          return c.json({ error: "not_installed" }, 409);
        return c.json({
          available: !(await github.repoExists(
            installationId,
            owner,
            name.data,
          )),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/from-template", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const parsed = createBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || parsed.data.owner !== user.login)
        return c.json({ error: "Bad request" }, 400);
      const { template, owner, name, description } = parsed.data;
      const config = await readInstance();
      if (!config) return c.json({ error: NOT_CONFIGURED }, 503);
      // Before GitHub is asked anything: a refused 4th repo creates nothing (decision 077 C).
      if (await overQuota(db, user.userId))
        return act(
          db,
          {
            userId: user.userId,
            actor: "human",
            origin: "ui",
            action: "create_from_template",
            args: {},
          },
          () => Promise.reject(new Refused("plan")),
        ).catch(() => c.json({ error: "plan" }, 403));
      try {
        const github = c.get("github");
        const found = await installedRepos(github, user.login, user.githubId);
        // A template of the installation of the user only, never any repo that is named.
        if (
          !found?.repos.some((r) => r.full_name === template && r.is_template)
        )
          return c.json({ error: "not_a_template" }, 409);
        // shortcut: read as the installation, so the user's own private repo, not opened to an installation limited to chosen repos, reads as free; GitHub's `generate` then refuses and the user lands on `refusee`; read with the user's token if users report it.
        if (await github.repoExists(found.installationId, owner, name))
          return c.json({ error: "name_taken" }, 409);
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
      const state = randomBytes(32).toString("hex");
      const now = Date.now();
      // Requests nobody came back for are dropped as new ones are made.
      await db
        .delete(templateRequests)
        .where(lt(templateRequests.createdAt, new Date(now - REQUEST_MS)));
      await db.insert(templateRequests).values({
        stateHash: sha256(state),
        userId: user.userId,
        template,
        owner,
        name,
        description,
        private: parsed.data.private,
        createdAt: new Date(now),
      });
      setCookie(c, STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.publicUrl.startsWith("https:"),
        path: CALLBACK,
        // Outlives the row on purpose: an expired creation reaches the server and gets `demande-expiree`, not a login failure (decision 068 G).
        maxAge: 60 * 60,
      });
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.search = new URLSearchParams({
        client_id: config.githubClientId,
        redirect_uri: `${config.publicUrl}${CALLBACK}`,
        state,
      }).toString();
      return c.json({ authorizeUrl: authorize.href });
    });
}

/** The creation's return from GitHub, handed over by the login's callback: null when the request is not a creation's (no creation cookie, or another state), so the login runs. */
export function templateReturn(db: Db, readGitHub: ReadGitHub) {
  return async (c: Context, config: InstanceSettings) => {
    const expected = getCookie(c, STATE_COOKIE);
    const { code, state, error } = c.req.query();
    if (!expected || state !== expected) return null;
    // The state is single-use: whatever happens next, it is gone.
    deleteCookie(c, STATE_COOKIE, { path: CALLBACK });
    const ready = await readGitHub();
    const user = await currentUser(db, c);
    if (!ready || !user) return c.redirect("/");
    // Deleting decides, so a second return with the same state finds nothing.
    const [request] = await db
      .delete(templateRequests)
      .where(
        and(
          eq(templateRequests.stateHash, sha256(expected)),
          eq(templateRequests.userId, user.userId),
          gt(templateRequests.createdAt, new Date(Date.now() - REQUEST_MS)),
        ),
      )
      .returning();
    if (!request) return c.redirect(failed("demande-expiree"));
    if (error || !code) return c.redirect(failed("annulee"));

    const fullName = `${request.owner}/${request.name}`;
    const entry: Entry = {
      userId: user.userId,
      actor: "human",
      origin: "ui",
      action: "create_from_template",
      args: { template: request.template, fullName },
    };
    let created = false;
    // The GitHub calls run with no transaction open (decisions 016 and 020 F): only the import and its entry are written in one. The token goes out of scope here and is never stored.
    const land = async (): Promise<Landed> => {
      const token = await exchangeCode(config, code, CALLBACK);
      // Before the repo exists: the quota may have been reached since the request was made (decision 077 C).
      if (await overQuota(db, user.userId)) return { overQuota: true };
      // From here the repo may exist, whatever happens to the call.
      created = true;
      const generated = await ready.github.generateRepo(
        token,
        request.template,
        {
          owner: request.owner,
          name: request.name,
          description: request.description ?? undefined,
          private: request.private,
        },
      );
      if ("refused" in generated) return { refused: generated.refused };
      const found = await installedRepos(
        ready.github,
        user.login,
        user.githubId,
      );
      const repo = found?.repos.find((r) => r.id === generated.repo.id);
      return found && repo
        ? { installationId: found.installationId, repo }
        : { outside: true };
    };
    const landed = await land().catch((failure: unknown) => ({ failure }));
    try {
      const project = await act(db, entry, async (tx) => {
        if ("failure" in landed) throw landed.failure;
        // Fixed codes only: GitHub's message goes to the page, never to the history.
        if ("refused" in landed) throw new Refused("generate_refused");
        if ("outside" in landed) throw new Refused("outside_installation");
        if ("overQuota" in landed) throw new Refused("plan");
        // The user row is locked, so two imports at once cannot both pass.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, user.userId))
          .for("update");
        if (await overQuota(tx, user.userId)) throw new Refused("plan");
        const project = await trackRepo(
          tx,
          user.userId,
          landed.repo,
          landed.installationId,
        );
        entry.projectId = project.id;
        return project;
      });
      return c.redirect(`/projets/${project.id}`);
    } catch (failure) {
      if ("refused" in landed)
        return c.redirect(
          `${failed("refusee")}&raison=${encodeURIComponent(landed.refused.slice(0, 200))}`,
        );
      if ("outside" in landed) return c.redirect(failed("hors-installation"));
      if ("overQuota" in landed) return c.redirect(failed("quota"));
      console.error("Creation from a template failed:", failure);
      // The repo may exist on GitHub already: the page says to import it.
      return c.redirect(
        failed(created ? "creee-non-importee" : "github-injoignable"),
      );
    }
  };
}
