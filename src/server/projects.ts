import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import { ANALYSER_FILES, CATALOG_FILES } from "./catalog-update.ts";
import type { Db } from "./db/db.ts";
import { projectMembers, projects, users } from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { mcpRefusal } from "./health.ts";
import { overQuota, planOf, planState } from "./plans.ts";
import { type Env, type GitHub, projectWrites } from "./project-writes.ts";
import { STARTER_LEVELS, STARTER_TEAMS } from "./starter-teams.ts";
import { AGENT_NAME, MAX_TEAM_NAME, parseTeam } from "./team.ts";

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

export const unauthorized = { error: "Unauthorized" };
export const NOT_CONFIGURED =
  "Cockpit n'est pas encore installé : termine l'assistant de démarrage.";

/** Whether a number can be the identity of a row: a PostgreSQL integer from 1 (anything else matches nothing, and a query with it would fail). */
export const isDatabaseId = (id: number) =>
  Number.isInteger(id) && id >= 1 && id <= 2147483647;

/** The roles of a project, each with the rights of the one before it (decision 076 A). */
export const ROLES = [
  "read_only",
  "can_validate",
  "can_launch",
  "owner",
] as const;
export type Role = (typeof ROLES)[number];

/** A member whose role is below what the gesture needs: the route answers 403 `role` (`app.onError`), the MCP tool a refusal; both are journaled. */
export class RoleRefused extends Refused {
  userId: number;
  projectId: number;
  /** `plan` when the owner's plan, not the member's role, is what refuses (decision 077). */
  constructor(userId: number, projectId: number, reason = "role") {
    super(reason);
    this.userId = userId;
    this.projectId = projectId;
  }
}

/** The account that owns a project. */
async function ownerOf(db: Db, projectId: number) {
  const [owner] = await db
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.role, "owner"),
      ),
    );
  return owner;
}

/** The one place that says whether a user belongs to a project, and with which role; anyone else gets undefined, as if it did not exist (decisions 004 and 011 E). A member below `min` is refused with a `RoleRefused`: every gesture that writes asks for its role here (decision 076). */
export async function memberProject(
  db: Db,
  userId: number,
  projectId: number,
  min: Role = "read_only",
) {
  if (!isDatabaseId(projectId)) return undefined;
  const [found] = await db
    .select({ project: projects, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.projectId, projectId),
      ),
    );
  if (!found) return undefined;
  // A project the plan of its owner locks is read-only for everyone (decision 077 E).
  const owner = await ownerOf(db, projectId);
  const locked = owner
    ? (await planState(db, owner.id)).locked.has(projectId)
    : false;
  const role = locked ? "read_only" : found.role;
  if (ROLES.indexOf(role) < ROLES.indexOf(min))
    throw new RoleRefused(userId, projectId, locked ? "plan" : "role");
  return { ...found.project, role };
}

/** Refuses a gesture that is Pro only when the owner of the project is Free (decision 077 D). */
export async function proOnly(db: Db, userId: number, projectId: number) {
  const owner = await ownerOf(db, projectId);
  if (owner && (await planOf(db, owner.id)).plan === "free")
    throw new RoleRefused(userId, projectId, "plan");
}

/** Every project the user belongs to, active ones first (same rule as `memberProject`), with their role and, on a shared one, the login of its owner. */
export async function memberProjects(db: Db, userId: number) {
  const rows = await db
    .select({
      project: projects,
      favorite: projectMembers.favorite,
      role: projectMembers.role,
      owner: sql<string>`(select u.login from project_members o join users u on u.id = o.user_id where o.project_id = ${projects.id} and o.role = 'owner')`,
      ownerId: sql<number>`(select o.user_id from project_members o where o.project_id = ${projects.id} and o.role = 'owner')`,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId))
    .orderBy(asc(sql`${projects.archivedAt} is not null`), asc(projects.id));
  const states = new Map(
    await Promise.all(
      [...new Set(rows.map((row) => row.ownerId))].map(
        async (id) => [id, await planState(db, id)] as const,
      ),
    ),
  );
  return rows.map((row) => {
    const state = states.get(row.ownerId);
    const locked = state?.locked.has(row.project.id) ?? false;
    return {
      ...row.project,
      favorite: row.favorite,
      role: locked ? ("read_only" as const) : row.role,
      sharedBy: row.role === "owner" ? null : row.owner,
      lockedBy: locked ? row.owner : null,
      ownerPlan: state?.plan ?? "free",
    };
  });
}

const present = (
  p: typeof projects.$inferSelect & {
    favorite?: boolean;
    role?: Role;
    sharedBy?: string | null;
    lockedBy: string | null;
    ownerPlan: "free" | "pro";
  },
) => ({
  id: p.id,
  favorite: p.favorite ?? false,
  role: p.role ?? "owner",
  sharedBy: p.sharedBy ?? null,
  lockedBy: p.lockedBy,
  ownerPlan: p.ownerPlan,
  fullName: p.fullName,
  defaultBranch: p.defaultBranch,
  archived: p.archivedAt !== null,
  starterTeam: p.starterTeam,
});

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

export function projectRoutes(db: Db, readGitHub: ReadGitHub, key: Buffer) {
  const { saveFile } = projectWrites(db);

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
            // The user row is locked, so two imports at once cannot both pass.
            await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, user.userId))
              .for("update");
            if (await overQuota(tx, key, user.userId))
              throw new Refused("plan");
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
          return c.json(
            {
              project: present({
                ...project,
                lockedBy: null,
                ownerPlan: (await planOf(db, user.userId)).plan,
              }),
            },
            201,
          );
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          if (error.message === "plan") return c.json({ error: "plan" }, 403);
          return error.message === "already_tracked"
            ? c.json({ error: ALREADY_TRACKED }, 409)
            : c.json(
                { error: "Repo introuvable dans ton installation de l'App" },
                404,
              );
        }
      },
    )
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
      // Before `act`, which would journal the refusal of a role as one more entry; `app.onError` answers it.
      await memberProject(db, user.userId, id, "owner");
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
