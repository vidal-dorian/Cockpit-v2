import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { users } from "./db/schema.ts";
import {
  marketplaceOf,
  pluginInstalled,
  pluginSettings,
} from "./plugin-settings.ts";
import { type Env, projectWrites } from "./project-writes.ts";
import { installedRepos, memberProjects, unauthorized } from "./projects.ts";
import { AGENT_NAME } from "./team.ts";

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

export function pluginRoutes(db: Db) {
  const { record, writeChanges, saveFile } = projectWrites(db);
  return new Hono<Env>()
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
    });
}
