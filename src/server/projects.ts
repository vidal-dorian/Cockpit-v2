import { readFileSync } from "node:fs";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import {
  ANALYSER_FILES,
  CATALOG_FILES,
  CATALOG_TEXTS,
  type CatalogState,
  catalogStates,
  DEV_US,
  fileState,
  HISTORY,
  isCatalogPath,
  isOldCopy,
  readCatalogFiles,
  recordedHashes,
  recordWrites,
  textToWrite,
} from "./catalog-update.ts";
import type { Db } from "./db/db.ts";
import { projectMembers, projects } from "./db/schema.ts";
import {
  checkWriteFiles,
  type githubClient,
  type ReadGitHub,
  type WriteFile,
} from "./github.ts";
import {
  catalogLine,
  type HealthLine,
  healthLines,
  webhookLine,
} from "./health.ts";
import { AGENT_NAME, MAX_TEAM_NAME, parseTeam } from "./team.ts";

const ALREADY_TRACKED = "Ce repo est déjà suivi dans Cockpit";
const GITHUB_DOWN =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";

const importBody = z.object({ githubRepoId: z.number().int() });

// The plan as `planRepoWrite` served it and the page hands it back (decision 027 D); the paths are checked by `checkWriteFiles`.
const prepareBody = z.object({
  plan: z.object({
    // A commit sha only: it ends up in the history, which is never edited (010 D).
    baseSha: z.string().regex(/^[0-9a-f]{40}$/),
    signature: z.string().optional(),
    files: z.array(
      z.object({
        path: z.string(),
        content: z.string(),
        status: z.enum(["create", "same", "exists", "update"]),
        current: z.string().optional(),
      }),
    ),
  }),
});

const PREPARE_MESSAGE = "feat: prepare the repo for Claude (Cockpit)";
const UPDATE_MESSAGE = "chore: update the Claude files (Cockpit)";
const CLAUDE_MD = {
  path: "CLAUDE.md",
  content: readFileSync(
    new URL("../../catalog/CLAUDE.md", import.meta.url),
    "utf8",
  ),
  // Never beside a CLAUDE.md of the project (decision 013 C).
  unlessExists: ["CLAUDE.md", ".claude/CLAUDE.md"],
};

/** Every file the prepare routes may write (decision 027 B). */
const PREPARE_FILES: (WriteFile & { unlessExists?: string[] })[] = [
  ...CATALOG_FILES,
  ...ANALYSER_FILES,
  CLAUDE_MD,
];

/** The catalogue agents by name (decision 030 B). */
const CATALOG_AGENTS = CATALOG_FILES.filter((f) =>
  f.path.startsWith(".claude/agents/"),
)
  .map((f) => ({
    name: f.path.slice(".claude/agents/".length, -".md".length),
    text: f.content,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// The longest name for which `.claude/agents/<name>.md` fits the 255 characters of decision 026 D.
const MAX_AGENT_NAME = 255 - ".claude/agents/".length - ".md".length;

// Decision 049 F: the files to update with the text each had in the repo when the plan was read; the texts written are the catalogue's.
const catalogBody = z.object({
  files: z
    .array(z.object({ path: z.string(), before: z.string().nullable() }))
    .min(1),
});

// Decision 030 E: `name` has the format of decision 029 B; `after` is at most 1 MiB, `before` is only compared.
const agentBody = z
  .object({
    name: z.string().max(MAX_AGENT_NAME).regex(AGENT_NAME),
    before: z.string().nullable(),
    after: z
      .string()
      .refine((text) => Buffer.byteLength(text) <= 1_048_576)
      .nullable(),
  })
  .refine(({ before, after }) => before !== after);

// Decision 031 H: `after` is a team that `parseTeam` reads, at most 1 MiB, never null.
// Decision 032 F: an optional `name` picks `.claude/teams/<name>.md`; only then may `after` be null (a removal).
const teamBody = z
  .object({
    name: z.string().max(MAX_TEAM_NAME).regex(AGENT_NAME).nullish(),
    before: z.string().nullable(),
    after: z
      .string()
      .refine(
        (text) =>
          Buffer.byteLength(text) <= 1_048_576 && parseTeam(text) !== null,
      )
      .nullable(),
  })
  .refine(({ before, after }) => before !== after)
  .refine(({ name, after }) => name != null || after !== null);

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

  // The write of one file of the repo by a human, as the agent and team editors do it (decisions 030 E, 031 H).
  const saveFile = async (
    c: Context<Env, string>,
    entry: Entry & { userId: number },
    changes: { path: string; before: string | null; after: string | null }[],
    message: string,
    hooks: {
      /** Whether the request is valid for this project, asked once it is known to be the member's and not archived: no, and it is a 400. */
      valid?: (projectId: number) => Promise<boolean>;
      /** A refusal code to answer 409 and record, asked after `valid` with the member's project; it reads GitHub, so a failure is a 502. */
      refuse?: (project: {
        installationId: number;
        fullName: string;
      }) => Promise<string | null>;
      /** Run in the transaction of the `ok` entry. */
      onWritten?: (tx: Tx, projectId: number) => Promise<void>;
    } = {},
  ) => {
    const record = async (error: unknown) => {
      try {
        await act(db, entry, async () => {
          throw error;
        });
      } catch (thrown) {
        if (thrown !== error) throw thrown;
      }
    };
    const id = Number(c.req.param("id"));
    const project = await memberProject(db, entry.userId, id);
    if (!project) {
      await record(new Refused("not_found"));
      return c.json({ error: "Not found" }, 404);
    }
    entry.projectId = id;
    if (project.archivedAt) {
      await record(new Refused("project_archived"));
      return c.json({ error: "project_archived" }, 409);
    }
    if (hooks.valid && !(await hooks.valid(id)))
      return c.json({ error: "Bad request" }, 400);
    let result: Awaited<ReturnType<GitHub["applyRepoChanges"]>>;
    try {
      const code = await hooks.refuse?.(project);
      if (code) {
        await record(new Refused(code));
        return c.json({ error: code }, 409);
      }
      result = await c
        .get("github")
        .applyRepoChanges(
          project.installationId,
          project.fullName,
          changes,
          message,
        );
    } catch (error) {
      await record(error);
      return c.json({ error: "github_unavailable" }, 502);
    }
    if ("refused" in result) {
      await record(new Refused(result.refused));
      return result.refused === "pull_request_forbidden"
        ? c.json(
            {
              error: result.refused,
              appSettingsUrl: c.get("appSettingsUrl"),
            },
            409,
          )
        : c.json({ error: result.refused }, 409);
    }
    await act(
      db,
      {
        ...entry,
        githubEffects: {
          commitSha: result.commitSha,
          pullRequest: result.pullRequest?.number ?? null,
        },
      },
      async (tx) => {
        await hooks.onWritten?.(tx, id);
      },
    );
    return c.json({
      commitSha: result.commitSha,
      changed: result.changed,
      ...(result.pullRequest && { pullRequest: result.pullRequest }),
    });
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
        // Only a prepared repo has the line (decision 049 E); its files are read at the commit the health was computed from (H).
        if (read.files.devUsSkill.includes("SKILL.md")) {
          const { inspect } = await c
            .get("github")
            .fileReader(project.installationId, project.fullName);
          const states = catalogStates({
            files: await readCatalogFiles(inspect, read.commitSha),
            recorded: await recordedHashes(db, project.id),
          });
          if (states) lines.push(catalogLine(states));
        }
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
        const recorded = await recordedHashes(db, project.id);
        // A read is not an action: no history entry (decision 013 G).
        const plan = await c
          .get("github")
          .planRepoWrite(
            project.installationId,
            project.fullName,
            PREPARE_FILES,
            (path, text) => isOldCopy(path, text, recorded),
          );
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
      const id = Number(c.req.param("id"));
      const recorded = isDatabaseId(id) ? await recordedHashes(db, id) : {};
      try {
        checkWriteFiles(plan.files);
        // Only the catalogue goes through this route (decision 026 D: "the files come from the catalogue").
        for (const file of plan.files) {
          const known = PREPARE_FILES.find((f) => f.path === file.path);
          if (
            !known ||
            ((file.status === "create" || file.status === "update") &&
              file.content !== known.content) ||
            // Decision 049 F: only an old original copy is replaced, never a hand-modified one.
            (file.status === "update" &&
              !isOldCopy(file.path, file.current ?? "", recorded))
          )
            throw new Error("Not a file of the catalogue");
        }
      } catch {
        return c.json({ error: "Bad request" }, 400);
      }
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "prepare_repo",
        args: {},
      };
      // Writes the `refused` or `error` entry on its own (`act` rethrows `error`); a failure of the entry itself propagates.
      const record = async (error: unknown) => {
        try {
          await act(db, entry, async () => {
            throw error;
          });
        } catch (thrown) {
          if (thrown !== error) throw thrown;
        }
      };
      // The GitHub calls (up to ~100 s) run with no transaction open (decisions 016 and 020 F): only the entry is written in one.
      const project = await memberProject(db, user.userId, id);
      if (!project) {
        await record(new Refused("not_found"));
        return c.json({ error: "Not found" }, 404);
      }
      entry.projectId = id;
      if (project.archivedAt) {
        await record(new Refused("project_archived"));
        return c.json({ error: "project_archived" }, 409);
      }
      let result: Awaited<ReturnType<GitHub["applyRepoWrite"]>>;
      try {
        result = await c.get("github").applyRepoWrite(
          project.installationId,
          project.fullName,
          // The plan went through the browser: the CLAUDE.md rule is taken from the catalogue again.
          {
            ...plan,
            files: plan.files.map((file) => ({
              ...file,
              unlessExists: PREPARE_FILES.find((f) => f.path === file.path)
                ?.unlessExists,
            })),
          },
          PREPARE_MESSAGE,
        );
      } catch (error) {
        await record(error);
        return c.json({ error: "github_unavailable" }, 502);
      }
      if ("refused" in result) {
        await record(new Refused(result.refused));
        return result.refused === "pull_request_forbidden"
          ? c.json(
              {
                error: result.refused,
                appSettingsUrl: c.get("appSettingsUrl"),
              },
              409,
            )
          : c.json({ error: result.refused }, 409);
      }
      await act(
        db,
        {
          ...entry,
          args: { created: result.created.length },
          githubEffects: {
            commitSha: result.commitSha,
            pullRequest: result.pullRequest?.number ?? null,
          },
        },
        (tx) => recordWrites(tx, id, result.created),
      );
      return c.json(result);
    })
    .post("/api/projects/:id/catalog/plan", async (c) => {
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
        const { inspect, head } = await c
          .get("github")
          .fileReader(project.installationId, project.fullName);
        const at = await head();
        if ("refused" in at) return c.json({ error: at.refused }, 409);
        const texts = await readCatalogFiles(inspect, at.sha);
        const states = catalogStates({
          files: texts,
          recorded: await recordedHashes(db, project.id),
        });
        if (!states) return c.json({ error: "not_prepared" }, 409);
        const files = states
          .filter((f) => f.state === "old" || f.state === "absent")
          .sort((a, b) => a.path.localeCompare(b.path))
          .map(({ path, state }) => ({
            path,
            state: state as Extract<CatalogState, "old" | "absent">,
            current: texts[path] ?? null,
            content: CATALOG_TEXTS.get(path) as string,
          }));
        return c.json({ plan: { files } });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/catalog/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = catalogBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { files } = parsed.data;
      if (
        new Set(files.map((f) => f.path)).size !== files.length ||
        !files.every((f) => isCatalogPath(f.path))
      )
        return c.json({ error: "Bad request" }, 400);
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: "update_catalog",
          args: { files: files.length },
        },
        files.map(({ path, before }) => ({
          path,
          before,
          after: textToWrite(path, before),
        })),
        UPDATE_MESSAGE,
        {
          // Only a file to update or to add is written: never a hand-modified or current one (decision 049 F).
          valid: async (projectId) => {
            const recorded = await recordedHashes(db, projectId);
            return files.every((f) =>
              ["old", "absent"].includes(
                fileState(f.path, f.before, recorded, HISTORY),
              ),
            );
          },
          // Decision 049 D: a repo with no dev-us skill at the head is not prepared, as the plan says.
          refuse: async ({ installationId, fullName }) => {
            const { inspect, head } = await c
              .get("github")
              .fileReader(installationId, fullName);
            const at = await head();
            if ("refused" in at) return at.refused;
            return (await inspect(DEV_US, at.sha)) ? null : "not_prepared";
          },
          onWritten: (tx, projectId) =>
            recordWrites(
              tx,
              projectId,
              files.map((f) => f.path),
            ),
        },
      );
    })
    .get("/api/projects/:id/agents", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      try {
        // A read is not an action: no history entry (decision 013 G).
        const read = await c
          .get("github")
          .readAgentFiles(project.installationId, project.fullName);
        if ("refused" in read) return c.json({ error: read.refused }, 409);
        const taken = new Set(read.agents.map((agent) => agent.name));
        return c.json({
          agents: read.agents,
          team: read.team,
          teams: read.teams,
          catalog: CATALOG_AGENTS.filter((agent) => !taken.has(agent.name)),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .get("/api/projects/:id/branches", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      try {
        // A read is not an action: no history entry (decision 013 G).
        const branches = await c
          .get("github")
          .readBranches(project.installationId, project.fullName);
        return c.json({ branches });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/agents/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = agentBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { name, before, after } = parsed.data;
      const path = `.claude/agents/${name}.md`;
      const verb =
        after === null ? "remove" : before === null ? "add" : "update";
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: after === null ? "delete_agent" : "save_agent",
          args: { path },
        },
        [{ path, before, after }],
        `feat: ${verb} the agent ${name} (Cockpit)`,
      );
    })
    .post("/api/projects/:id/team/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = teamBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { name, before, after } = parsed.data;
      const path = name ? `.claude/teams/${name}.md` : ".claude/team.md";
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: after === null ? "delete_team" : "save_team",
          args: { path },
        },
        [{ path, before, after }],
        !name
          ? "feat: update the team (Cockpit)"
          : `feat: ${after === null ? "remove" : "update"} the team ${name} (Cockpit)`,
      );
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
