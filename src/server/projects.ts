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
import {
  projectMembers,
  projects,
  users,
  workflowProposals,
} from "./db/schema.ts";
import {
  checkWriteFiles,
  type githubClient,
  type ReadGitHub,
  type WriteFile,
} from "./github.ts";
import {
  alertsLine,
  catalogLine,
  type HealthLine,
  healthLines,
  mcpRefusal,
  updatesLine,
  webhookLine,
} from "./health.ts";
import {
  marketplaceOf,
  pluginInstalled,
  pluginSettings,
} from "./plugin-settings.ts";
import { levelFiles, STARTER_LEVELS, STARTER_TEAMS } from "./starter-teams.ts";
import { AGENT_NAME, MAX_TEAM_NAME, parseTeam } from "./team.ts";
import {
  LANGUAGES,
  pendingProposal,
  STARTER_PATH,
  starterLanguage,
  starterText,
  summarize,
  WORKFLOWS_DIR,
} from "./workflows.ts";

const ALREADY_TRACKED = "Ce repo est déjà suivi dans Cockpit";
const GITHUB_DOWN =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";

const importBody = z.object({
  githubRepoId: z.number().int(),
  // Decision 063 D: absent is Standard; anything else than the four levels is refused.
  starterTeam: z.enum(STARTER_TEAMS).default("standard"),
});

// The plan as `planRepoWrite` served it and the page hands it back (decision 027 D); the paths are checked by `checkWriteFiles`.
export const prepareBody = z.object({
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

// Decision 065 B: the path is built by the server from `kind` and `name` (the format of decision 029 B, mandatory for a rule and a skill, forbidden otherwise); only a rule or a skill may be removed.
const CLAUDE_FILES = {
  claude_md: { path: () => "CLAUDE.md", noun: "CLAUDE.md" },
  rule: { path: (n: string) => `.claude/rules/${n}.md`, noun: "the rule" },
  skill: {
    path: (n: string) => `.claude/skills/${n}/SKILL.md`,
    noun: "the skill",
  },
  mcp_json: { path: () => ".mcp.json", noun: ".mcp.json" },
} as const;
// The longest name for which `.claude/skills/<name>/SKILL.md` fits the 255 characters of decision 026 D.
const MAX_SKILL_NAME = 255 - CLAUDE_FILES.skill.path("").length;
const CATALOG_SKILLS = new Set(
  [...CATALOG_FILES, ...ANALYSER_FILES]
    .map((f) => f.path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)?.[1])
    .filter((name) => name !== undefined),
);
const claudeConfigBody = z
  .object({
    kind: z.enum(["claude_md", "rule", "skill", "mcp_json"]),
    name: z.string().max(MAX_SKILL_NAME).regex(AGENT_NAME).optional(),
    before: z.string().nullable(),
    after: z
      .string()
      .refine((text) => Buffer.byteLength(text) <= 1_048_576)
      .nullable(),
  })
  .refine(
    ({ kind, name, before, after }) =>
      before !== after &&
      (kind === "rule" || kind === "skill") === (name !== undefined) &&
      (after !== null || kind === "rule" || kind === "skill") &&
      !(kind === "skill" && CATALOG_SKILLS.has(name ?? "")),
  );

// Decision 066 E: the path is built by the server from `kind` and `name`, in the plugin `commun` of the plugin repo.
const PLUGIN_FILES = {
  agent: (n: string) => `plugins/commun/agents/${n}.md`,
  skill: (n: string) => `plugins/commun/skills/${n}/SKILL.md`,
};
const SETTINGS_PATH = ".claude/settings.json";
const pluginFileBody = z
  .object({
    kind: z.enum(["agent", "skill"]),
    name: z
      .string()
      .max(255 - PLUGIN_FILES.skill("").length)
      .regex(AGENT_NAME),
    before: z.string().nullable(),
    after: z
      .string()
      .refine((text) => Buffer.byteLength(text) <= 1_048_576)
      .nullable(),
  })
  .refine(({ before, after }) => before !== after);
const pluginRepoBody = z.object({
  fullName: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .nullable(),
});
const pluginInstallBody = z.object({
  install: z.boolean(),
  before: z.string().nullable(),
});

// Decision 031 H: `after` is a team that `parseTeam` reads, at most 1 MiB, never null.
// Decision 032 F: an optional `name` picks `.claude/teams/<name>.md`; only then may `after` be null (a removal).
const teamBody = z
  .object({
    name: z.string().max(MAX_TEAM_NAME).regex(AGENT_NAME).nullish(),
    // Decision 063 F: « Repartir d'une équipe de départ » also writes the agents of the level, in the same commit.
    starterTeam: z.enum(STARTER_TEAMS).optional(),
    agents: z
      .array(
        z.object({
          name: z.string().max(MAX_AGENT_NAME).regex(AGENT_NAME),
          before: z.string().nullable(),
          after: z
            .string()
            .refine((text) => Buffer.byteLength(text) <= 1_048_576),
        }),
      )
      .refine(
        (agents) =>
          new Set(agents.map((a) => a.name)).size === agents.length &&
          agents.every((a) => a.before !== a.after),
      )
      .optional(),
    before: z.string().nullable(),
    after: z
      .string()
      .refine(
        (text) =>
          Buffer.byteLength(text) <= 1_048_576 && parseTeam(text) !== null,
      )
      .nullable(),
  })
  // The team file may stay as it is when agents are written with it.
  .refine(({ before, after, agents }) => before !== after || !!agents?.length)
  .refine(({ name, after }) => name != null || after !== null)
  // The level is the one of the default team only.
  .refine(
    ({ starterTeam, name, after }) =>
      starterTeam === undefined || (name == null && after !== null),
  );

// Decision 067 C: the language of the starter CI, which the server reads again.
const starterBody = z.object({ language: z.enum(LANGUAGES) });

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
  starterTeam: p.starterTeam,
});

type GitHub = ReturnType<typeof githubClient>;
type Repo = { installationId: number; fullName: string };
/** A refusal code to answer 409 and record, asked with the repo to write; it reads GitHub, so a failure is a 502. */
type Refuse = (
  repo: Repo,
) => Promise<string | { error: string; at?: string } | null>;
type Env = {
  Variables: {
    github: GitHub;
    installUrl: string;
    appSettingsUrl: string;
    publicUrl: string;
  };
};

/** The repos the user opened to the App on GitHub; null when the App is not installed on their account. */
export async function installedRepos(
  github: GitHub,
  login: string,
  githubId: number,
) {
  const installationId = await github.findUserInstallation(login, githubId);
  if (installationId === null) return null;
  return {
    installationId,
    repos: await github.listInstallationRepos(installationId),
  };
}

/** Tracks a repo of the user's installation, who becomes its owner (decision 011). The unique github_repo_id decides, so two parallel imports cannot both win. */
export async function trackRepo(
  tx: Tx,
  userId: number,
  repo: { id: number; full_name: string; default_branch: string },
  installationId: number,
  starterTeam: (typeof STARTER_TEAMS)[number] = "standard",
) {
  const [created] = await tx
    .insert(projects)
    .values({
      githubRepoId: repo.id,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      installationId,
      starterTeam,
    })
    .onConflictDoNothing({ target: projects.githubRepoId })
    .returning();
  if (!created) throw new Refused("already_tracked");
  await tx
    .insert(projectMembers)
    .values({ projectId: created.id, userId, role: "owner" });
  return created;
}

/** Whether a write permission of the App is granted (decision 067 D, as the alerts of 052): the App is blamed first (an App made before the permission lacks it), then the installation. */
export function writeAccess(
  access: Awaited<ReturnType<GitHub["readAppAccess"]>>,
  permission: string,
  appSettingsUrl: string,
) {
  const appHas = access.app[permission] === "write";
  return {
    granted: appHas && access.installation[permission] === "write",
    installationUrl: appHas
      ? access.installationUrl
      : `${appSettingsUrl}/permissions`,
    ...(!appHas && { appMissing: true as const }),
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
    /** Kept apart: it comes after the lines that are read on each display (decision 052). */
    updates: HealthLine;
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

  const record = async (entry: Entry, error: unknown) => {
    try {
      await act(db, entry, async () => {
        throw error;
      });
    } catch (thrown) {
      if (thrown !== error) throw thrown;
    }
  };

  // The commit of the changes in a repo by a human (decisions 030 E, 031 H, 066 E): the part of `saveFile` that does not depend on a project.
  const writeChanges = async (
    c: Context<Env, string>,
    entry: Entry & { userId: number },
    /** The repo to write, or the refusal code when there is none; it may read GitHub, so a failure is a 502. */
    repo: () => Promise<Repo | string>,
    changes: { path: string; before: string | null; after: string | null }[],
    message: string,
    hooks: {
      refuse?: Refuse;
      /** Run in the transaction of the `ok` entry. */
      onWritten?: (tx: Tx) => Promise<void>;
    } = {},
  ) => {
    let result: Awaited<ReturnType<GitHub["applyRepoChanges"]>>;
    try {
      const target = await repo();
      const code =
        typeof target === "string" ? target : await hooks.refuse?.(target);
      if (code) {
        const refusal = typeof code === "string" ? { error: code } : code;
        await record(entry, new Refused(refusal.error));
        return c.json(refusal, 409);
      }
      result = await c
        .get("github")
        .applyRepoChanges(
          (target as Repo).installationId,
          (target as Repo).fullName,
          changes,
          message,
        );
    } catch (error) {
      await record(entry, error);
      return c.json({ error: "github_unavailable" }, 502);
    }
    if ("refused" in result) {
      await record(entry, new Refused(result.refused));
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
        await hooks.onWritten?.(tx);
      },
    );
    return c.json({
      commitSha: result.commitSha,
      changed: result.changed,
      ...(result.pullRequest && { pullRequest: result.pullRequest }),
    });
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
      /** Run in the transaction of the `ok` entry. */
      onWritten?: (tx: Tx, projectId: number) => Promise<void>;
      refuse?: Refuse;
    } = {},
  ) => {
    const id = Number(c.req.param("id"));
    const project = await memberProject(db, entry.userId, id);
    if (!project) {
      await record(entry, new Refused("not_found"));
      return c.json({ error: "Not found" }, 404);
    }
    entry.projectId = id;
    if (project.archivedAt) {
      await record(entry, new Refused("project_archived"));
      return c.json({ error: "project_archived" }, 409);
    }
    if (hooks.valid && !(await hooks.valid(id)))
      return c.json({ error: "Bad request" }, 400);
    return writeChanges(c, entry, async () => project, changes, message, {
      refuse: hooks.refuse,
      onWritten: (tx) => hooks.onWritten?.(tx, id) ?? Promise.resolve(),
    });
  };

  // Decision 067 F: commits or ignores the proposal of a project the user belongs to; a proposal decided once is never decided again.
  const decideProposal = async (
    c: Context<Env, string>,
    what: "commit" | "ignore",
  ) => {
    const user = await currentUser(db, c);
    if (!user) return c.json(unauthorized, 401);
    const entry: Entry & { userId: number } = {
      userId: user.userId,
      actor: "human",
      origin: "ui",
      action: `${what}_workflow_change`,
      args: {},
    };
    const proposalId = Number(c.req.param("id"));
    const [proposal] = isDatabaseId(proposalId)
      ? await db
          .select()
          .from(workflowProposals)
          .where(eq(workflowProposals.id, proposalId))
      : [];
    const project =
      proposal && (await memberProject(db, user.userId, proposal.projectId));
    if (!proposal || !project) {
      await record(entry, new Refused("not_found"));
      return c.json({ error: "Not found" }, 404);
    }
    entry.projectId = project.id;
    entry.args = { path: proposal.path };
    const refused = proposal.decision
      ? "already_decided"
      : project.archivedAt && "project_archived";
    if (refused) {
      await record(entry, new Refused(refused));
      return c.json({ error: refused }, 409);
    }
    // Never overwrites a decision that landed meanwhile; says whether this one did.
    const decided = async (tx: Tx) =>
      (
        await tx
          .update(workflowProposals)
          .set({ decision: what === "commit" ? "committed" : "ignored" })
          .where(
            and(
              eq(workflowProposals.id, proposal.id),
              isNull(workflowProposals.decision),
            ),
          )
          .returning({ id: workflowProposals.id })
      ).length > 0;
    if (what === "ignore") {
      try {
        await act(db, entry, async (tx) => {
          if (!(await decided(tx))) throw new Refused("already_decided");
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return c.json({ error: error.message }, 409);
      }
      return c.json({});
    }
    return writeChanges(
      c,
      entry,
      async () => project,
      [
        {
          path: proposal.path,
          before: proposal.before,
          after: proposal.content,
        },
      ],
      `feat: ${proposal.before === null ? "add" : "update"} ${proposal.path} (Cockpit)`,
      {
        // The commit is on GitHub whatever the row says.
        onWritten: async (tx) => {
          await decided(tx);
        },
      },
    );
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
    .use("/api/attachments/*", gate)
    .use("/api/stories/*", gate)
    .use("/api/github/*", gate)
    .use("/api/plugins", gate)
    .use("/api/plugins/*", gate)
    .use("/api/installation", gate)
    .use("/api/workflow-proposals/*", gate)
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
    .get("/api/starter-teams", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      return c.json({ teams: STARTER_LEVELS });
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
        const { githubRepoId, starterTeam } = c.req.valid("json");

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
            const created = await trackRepo(
              tx,
              user.userId,
              repo,
              found.installationId,
              starterTeam,
            );
            entry.projectId = created.id;
            entry.args = { projectId: created.id, starterTeam };
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
      // The lines that are not part of the cache: what GitHub says now (decisions 024 F and 052 B).
      const alerts = async () => {
        try {
          return alertsLine(
            await c.get("github").readAppAccess(project.installationId),
            c.get("appSettingsUrl"),
          );
        } catch (error) {
          console.error("GitHub permissions read failed:", error);
          return alertsLine(null, c.get("appSettingsUrl"));
        }
      };
      const live = async () => {
        const [hook, access] = await Promise.all([webhook(), alerts()]);
        return [hook, access];
      };
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
          return c.json({
            lines: [...entry.lines, ...(await live()), entry.updates],
          });
        }
        const lines = healthLines(read.files, publicUrl);
        const updates = updatesLine(read.files);
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
            updates,
          });
        return c.json({ lines: [...lines, ...(await live()), updates] });
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
            levelFiles(PREPARE_FILES, project.starterTeam),
            (path, text) => isOldCopy(path, text, recorded),
            textToWrite,
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
      // A non-member is answered 404 below, before anything that depends on the project is read or checked.
      const member = await memberProject(db, user.userId, id);
      const recorded = member ? await recordedHashes(db, id) : {};
      const allowed = levelFiles(
        PREPARE_FILES,
        member?.starterTeam ?? "standard",
      );
      try {
        if (member) checkWriteFiles(plan.files);
        // Only the catalogue goes through this route (decision 026 D: "the files come from the catalogue").
        for (const file of member ? plan.files : []) {
          const known = allowed.find((f) => f.path === file.path);
          if (
            !known ||
            (file.status === "create" && file.content !== known.content) ||
            // The text of an update keeps the repo's model line (decision 051 L).
            (file.status === "update" &&
              file.content !== textToWrite(file.path, file.current ?? null)) ||
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
        const texts = await readCatalogFiles(inspect, at.sha, true);
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
            content: textToWrite(path, texts[path] ?? null),
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
    .get("/api/projects/:id/claude-config", async (c) => {
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
          .readClaudeConfig(project.installationId, project.fullName);
        if ("refused" in read) return c.json({ error: read.refused }, 409);
        // The catalogue skills are kept up to date by the catalogue (decision 049).
        return c.json({
          ...read,
          skills: read.skills.filter((s) => !CATALOG_SKILLS.has(s.name)),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .get("/api/projects/:id/workflows", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const proposal = await pendingProposal(db, project.id);
      try {
        // A read is not an action: no history entry (decision 013 G).
        const github = c.get("github");
        const { installationId, fullName } = project;
        const files = await github.fileReader(installationId, fullName);
        const tip = await files.head();
        if ("refused" in tip) return c.json({ error: tip.refused }, 409);
        const [access, runs, rootFiles, workflowFiles] = await Promise.all([
          github.readAppAccess(installationId),
          github.readWorkflowRuns(installationId, fullName, tip.branch),
          files.listFiles("", tip.sha),
          files.listFiles(WORKFLOWS_DIR, tip.sha),
        ]);
        const language = starterLanguage(rootFiles);
        const { granted, ...permission } = writeAccess(
          access,
          "workflows",
          c.get("appSettingsUrl"),
        );
        return c.json({
          workflows: summarize(runs),
          // Decision 067 C: offered only when `.github/workflows` holds no file at all.
          starter: workflowFiles.length
            ? null
            : language === null
              ? { language }
              : {
                  language,
                  path: STARTER_PATH,
                  content: starterText(language),
                },
          permission: { workflows: granted, ...permission },
          proposal,
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/workflows/starter/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = starterBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { language } = parsed.data;
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: "add_starter_ci",
          args: { language },
        },
        [{ path: STARTER_PATH, before: null, after: starterText(language) }],
        "feat: add a starter CI (Cockpit)",
        {
          // The language is read again: the page may be older than the repo.
          refuse: async ({ installationId, fullName }) => {
            const files = await c
              .get("github")
              .fileReader(installationId, fullName);
            const tip = await files.head();
            if ("refused" in tip) return tip.refused;
            return starterLanguage(await files.listFiles("", tip.sha)) ===
              language
              ? null
              : "wrong_language";
          },
        },
      );
    })
    .post("/api/workflow-proposals/:id/commit", (c) =>
      decideProposal(c, "commit"),
    )
    .post("/api/workflow-proposals/:id/ignore", (c) =>
      decideProposal(c, "ignore"),
    )
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
    .post("/api/projects/:id/claude-config/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = claudeConfigBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { kind, name = "", before, after } = parsed.data;
      const { path, noun } = CLAUDE_FILES[kind];
      const file = path(name);
      const verb =
        after === null ? "remove" : before === null ? "add" : "update";
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action:
            kind === "rule" || kind === "skill"
              ? `${after === null ? "delete" : "save"}_${kind}`
              : `save_${kind}`,
          args: { path: file },
        },
        [{ path: file, before, after }],
        // A rule or a skill is « added » on creation; CLAUDE.md and .mcp.json are only ever updated.
        `feat: ${kind === "rule" || kind === "skill" ? verb : "update"} ${noun}${name && ` ${name}`} (Cockpit)`,
        {
          // Decision 065 C: a secret never reaches the repo, whatever the server.
          refuse: async () =>
            kind === "mcp_json" && after !== null ? mcpRefusal(after) : null,
        },
      );
    })
    .put("/api/plugins/repo", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = pluginRepoBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { fullName } = parsed.data;
      const entry = {
        userId: user.userId,
        actor: "human" as const,
        origin: "ui" as const,
        action: fullName ? "link_plugin_repo" : "unlink_plugin_repo",
        args: {},
      };
      try {
        // The repo must be one the installation of the user reaches (decision 066 B).
        const found =
          fullName !== null &&
          (await installedRepos(c.get("github"), user.login, user.githubId));
        if (
          found !== false &&
          !found?.repos.some((r) => r.full_name === fullName)
        ) {
          await record(entry, new Refused("repo_unreachable"));
          return c.json({ error: "repo_unreachable" }, 409);
        }
      } catch (error) {
        await record(entry, error);
        return c.json({ error: "github_unavailable" }, 502);
      }
      await act(db, entry, async (tx) => {
        await tx
          .update(users)
          .set({ pluginRepo: fullName })
          .where(eq(users.id, user.userId));
      });
      return c.json({ repo: fullName });
    })
    .get("/api/plugins", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      if (!user.pluginRepo)
        return c.json({ repo: null, agents: [], skills: [] });
      try {
        // A read is not an action: no history entry (decision 013 G).
        const github = c.get("github");
        const installationId = await github.findUserInstallation(
          user.login,
          user.githubId,
        );
        if (installationId === null)
          return c.json({ error: "repo_unreachable" }, 409);
        const read = await github.readPlugins(installationId, user.pluginRepo);
        if ("refused" in read) return c.json({ error: read.refused }, 409);
        return c.json({ repo: user.pluginRepo, ...read });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/plugins/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = pluginFileBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { kind, name, before, after } = parsed.data;
      const path = PLUGIN_FILES[kind](name);
      const verb =
        after === null ? "remove" : before === null ? "add" : "update";
      const changes = [{ path, before, after }];
      const github = c.get("github");
      return writeChanges(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: `${after === null ? "delete" : "save"}_shared_${kind}`,
          args: { path },
        },
        async () => {
          if (!user.pluginRepo) return "no_plugin_repo";
          const installationId = await github.findUserInstallation(
            user.login,
            user.githubId,
          );
          return installationId === null
            ? "repo_unreachable"
            : { installationId, fullName: user.pluginRepo };
        },
        changes,
        `feat: ${verb} the shared ${kind} ${name} (Cockpit)`,
        {
          // Decision 066 C: the two files of the marketplace join the commit when they are missing, and are never rewritten.
          refuse: async ({ installationId, fullName }) => {
            const { inspect, head } = await github.fileReader(
              installationId,
              fullName,
            );
            const at = await head();
            if ("refused" in at) return at.refused;
            const description = `Les agents et skills communs de ${user.login}, écrits par Cockpit`;
            const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
            for (const file of after === null
              ? []
              : [
                  {
                    path: ".claude-plugin/marketplace.json",
                    text: json({
                      name: marketplaceOf(user.login),
                      owner: { name: user.login },
                      plugins: [
                        {
                          name: "commun",
                          source: "./plugins/commun",
                          description,
                        },
                      ],
                    }),
                  },
                  {
                    path: "plugins/commun/.claude-plugin/plugin.json",
                    text: json({ name: "commun", description }),
                  },
                ])
              if ((await inspect(file.path, at.sha)) === null)
                changes.push({
                  path: file.path,
                  before: null,
                  after: file.text,
                });
            return null;
          },
        },
      );
    })
    .get("/api/plugins/projects", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      try {
        // A read is not an action: no history entry (decision 013 G).
        const mine = (await memberProjects(db, user.userId)).filter(
          (p) => !p.archivedAt,
        );
        // Keeps an uninstalled App, or a repo it no longer reaches, from turning the list into a 502: such a project has no settings to read.
        const reached = new Set(
          (
            await installedRepos(c.get("github"), user.login, user.githubId)
          )?.repos.map((r) => r.full_name),
        );
        // shortcut: one GitHub read per project in parallel, unbounded; batch if users have dozens of projects.
        const projects = await Promise.all(
          mine.map(async (p) => {
            let settings: string | null = null;
            if (reached.has(p.fullName)) {
              const { inspect, head } = await c
                .get("github")
                .fileReader(p.installationId, p.fullName);
              const at = await head();
              // null only for no file, as for team.md.
              const found =
                "refused" in at ? null : await inspect(SETTINGS_PATH, at.sha);
              settings = found === null ? null : (found.text ?? "");
            }
            return {
              id: p.id,
              fullName: p.fullName,
              installed: pluginInstalled(settings, user.login),
              settings,
            };
          }),
        );
        return c.json({ projects });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/plugins/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = pluginInstallBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { install, before } = parsed.data;
      // Decision 066 G: the page and the server compute the same text; a file that is not a JSON object is refused below.
      let after = "";
      let invalid = false;
      try {
        after = pluginSettings(
          before,
          { login: user.login, repo: user.pluginRepo ?? "" },
          install,
        );
      } catch {
        invalid = true;
      }
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: `${install ? "install" : "remove"}_shared_plugin`,
          args: { path: SETTINGS_PATH },
        },
        [{ path: SETTINGS_PATH, before, after }],
        `feat: ${install ? "install" : "remove"} the shared plugin (Cockpit)`,
        {
          // No commit that changes nothing: the text is already as it would be written, or a removal where the plugin is not installed.
          valid: async () =>
            invalid ||
            (after !== before &&
              (install || pluginInstalled(before, user.login))),
          refuse: async () =>
            !user.pluginRepo
              ? "no_plugin_repo"
              : invalid
                ? "invalid_settings"
                : null,
        },
      );
    })
    .post("/api/projects/:id/team/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const parsed = teamBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { name, before, after, starterTeam, agents = [] } = parsed.data;
      const path = name ? `.claude/teams/${name}.md` : ".claude/team.md";
      return saveFile(
        c,
        {
          userId: user.userId,
          actor: "human",
          origin: "ui",
          action: after === null ? "delete_team" : "save_team",
          args: { path, ...(starterTeam && { starterTeam }) },
        },
        [
          { path, before, after },
          ...agents.map((a) => ({
            path: `.claude/agents/${a.name}.md`,
            before: a.before,
            after: a.after,
          })),
        ],
        !name
          ? `feat: update the team${agents.length ? " and its agents" : ""} (Cockpit)`
          : `feat: ${after === null ? "remove" : "update"} the team ${name} (Cockpit)`,
        {
          onWritten: async (tx, projectId) => {
            if (starterTeam)
              await tx
                .update(projects)
                .set({ starterTeam })
                .where(eq(projects.id, projectId));
          },
        },
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
