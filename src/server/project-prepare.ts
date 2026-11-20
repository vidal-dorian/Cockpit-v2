import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
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
import { checkWriteFiles, type WriteFile } from "./github.ts";
import { type Env, type GitHub, projectWrites } from "./project-writes.ts";
import { memberProject, prepareBody, unauthorized } from "./projects.ts";
import { levelFiles } from "./starter-teams.ts";

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

// Decision 049 F: the files to update with the text each had in the repo when the plan was read; the texts written are the catalogue's.
const catalogBody = z.object({
  files: z
    .array(z.object({ path: z.string(), before: z.string().nullable() }))
    .min(1),
});

export function prepareRoutes(db: Db) {
  const { saveFile } = projectWrites(db);
  return new Hono<Env>()
    .post("/api/projects/:id/prepare", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
        "owner",
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
      const member = await memberProject(db, user.userId, id, "owner");
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
        "owner",
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
    });
}
