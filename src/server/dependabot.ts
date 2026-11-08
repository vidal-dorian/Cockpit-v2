import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import { moduleData } from "./code-map.ts";
import type { Db } from "./db/db.ts";
import { codeMaps } from "./db/schema.ts";
import {
  checkWriteFiles,
  type githubClient,
  type ReadGitHub,
} from "./github.ts";
import { isDatabaseId, memberProject, prepareBody } from "./projects.ts";

// Decision 052 L: the package ecosystem of Dependabot for each manifest file name.
const ECOSYSTEMS: Record<string, string> = {
  "package.json": "npm",
  "composer.json": "composer",
  "requirements.txt": "pip",
  "pyproject.toml": "pip",
  Pipfile: "pip",
  Gemfile: "bundler",
  "go.mod": "gomod",
  "Cargo.toml": "cargo",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
};
type GitHub = ReturnType<typeof githubClient>;
const PATH = ".github/dependabot.yml";
const MESSAGE = "feat: add .github/dependabot.yml (Cockpit)";

/** The text of `.github/dependabot.yml`: one weekly entry per (ecosystem, folder) among the manifests, then GitHub Actions when there are workflows; null when there is nothing to update. */
export function dependabotYaml(manifests: string[], workflows: string[]) {
  const entries = new Set<string>();
  for (const manifest of manifests) {
    const slash = manifest.lastIndexOf("/");
    const ecosystem = ECOSYSTEMS[manifest.slice(slash + 1)];
    if (ecosystem)
      entries.add(
        JSON.stringify([
          ecosystem,
          slash < 0 ? "/" : `/${manifest.slice(0, slash)}`,
        ]),
      );
  }
  if (workflows.some((name) => /\.ya?ml$/.test(name)))
    entries.add(JSON.stringify(["github-actions", "/"]));
  if (entries.size === 0) return null;
  const updates = [...entries].map((entry) => {
    const [ecosystem, directory] = JSON.parse(entry) as [string, string];
    return `  - package-ecosystem: ${JSON.stringify(ecosystem)}\n    directory: ${JSON.stringify(directory)}\n    schedule:\n      interval: "weekly"\n`;
  });
  return `version: 2\nupdates:\n${updates.join("")}`;
}

/** The plan and the write of `.github/dependabot.yml`, the fix of the « Mises à jour automatiques » line (decision 052 L), shown then written as « Préparer pour Claude » is (decision 026). */
export function dependabotRoutes(db: Db, readGitHub: ReadGitHub) {
  /** The file for the repo as it is at its head, null when it has no ecosystem; a refusal code when the repo is out of reach. */
  const contentOf = async (
    project: NonNullable<Awaited<ReturnType<typeof memberProject>>>,
  ) => {
    const ready = await readGitHub();
    if (!ready) throw new Error("Cockpit is not configured");
    const { github } = ready;
    const reader = await github.fileReader(
      project.installationId,
      project.fullName,
    );
    const at = await reader.head();
    if ("refused" in at) return { refused: at.refused };
    const [root, workflows, maps] = await Promise.all([
      reader.listFiles("", at.sha),
      reader.listFiles(".github/workflows", at.sha),
      db.select().from(codeMaps).where(eq(codeMaps.projectId, project.id)),
    ]);
    const mapped = maps.flatMap((m) => {
      const data = moduleData.safeParse(m.data);
      return data.success ? [data.data.manifest] : [];
    });
    return {
      github,
      reader,
      sha: at.sha,
      // A .github/dependabot.yaml is the same file for GitHub.
      hasYaml:
        (await reader.inspect(".github/dependabot.yaml", at.sha)) !== null,
      content: dependabotYaml([...root, ...mapped], workflows),
    };
  };

  return new Hono()
    .get("/api/projects/:id/dependabot/plan", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      if (project.archivedAt) return c.json({ error: "project_archived" }, 409);
      try {
        // A read is not an action: no history entry (decision 013 G).
        const read = await contentOf(project);
        if ("refused" in read) return c.json({ error: read.refused }, 409);
        if (read.content === null)
          return c.json({ error: "no_ecosystem" }, 409);
        const plan = await read.github.planRepoWrite(
          project.installationId,
          project.fullName,
          [{ path: PATH, content: read.content }],
        );
        if ("refused" in plan) return c.json({ error: plan.refused }, 409);
        // A `.github/dependabot.yaml` is the same file for GitHub: never write beside it. The signature no longer matches, which only costs `apply` a second read.
        const [file] = plan.files;
        if (file?.status === "create") {
          const yaml = await read.reader.inspect(
            ".github/dependabot.yaml",
            plan.baseSha,
          );
          if (yaml)
            plan.files = [
              {
                ...file,
                status: "exists",
                ...(yaml.text !== undefined && { current: yaml.text }),
              },
            ];
        }
        return c.json({ plan });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/dependabot/apply", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const parsed = prepareBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { plan } = parsed.data;
      const id = Number(c.req.param("id"));
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "add_dependabot",
        args: {},
      };
      const record = async (error: unknown) => {
        try {
          await act(db, entry, async () => {
            throw error;
          });
        } catch (thrown) {
          if (thrown !== error) throw thrown;
        }
      };
      const project = isDatabaseId(id)
        ? await memberProject(db, user.userId, id)
        : undefined;
      if (!project) {
        await record(new Refused("not_found"));
        return c.json({ error: "Not found" }, 404);
      }
      entry.projectId = project.id;
      if (project.archivedAt) {
        await record(new Refused("project_archived"));
        return c.json({ error: "project_archived" }, 409);
      }
      try {
        checkWriteFiles(plan.files);
        if (
          plan.files.length !== 1 ||
          plan.files[0]?.path !== PATH ||
          !["create", "exists"].includes(plan.files[0].status)
        )
          throw new Error("Not the file of Dependabot");
      } catch {
        return c.json({ error: "Bad request" }, 400);
      }
      let result: Awaited<ReturnType<GitHub["applyRepoWrite"]>>;
      try {
        // The plan went through the browser: what it writes is what the repo gives now.
        const read = await contentOf(project);
        if ("refused" in read) {
          await record(new Refused(read.refused));
          return c.json({ error: read.refused }, 409);
        }
        const [file] = plan.files;
        if (file?.status === "create") {
          // The repo as it is now, against the plan: what no longer matches is a repo that changed if this client signed the plan, a forged plan otherwise.
          const stale = read.hasYaml || file.content !== read.content;
          if (read.content === null) {
            await record(new Refused("no_ecosystem"));
            return c.json({ error: "no_ecosystem" }, 409);
          }
          if (stale && !read.github.isPlanSigned(plan))
            return c.json({ error: "Bad request" }, 400);
          if (stale) {
            await record(new Refused("repo_changed"));
            return c.json({ error: "repo_changed" }, 409);
          }
        }
        result = await read.github.applyRepoWrite(
          project.installationId,
          project.fullName,
          plan,
          MESSAGE,
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
                appSettingsUrl: (await readGitHub())?.appSettingsUrl,
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
        async () => {},
      );
      return c.json(result);
    });
}
