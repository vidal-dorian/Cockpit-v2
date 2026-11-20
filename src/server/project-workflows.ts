import { and, eq, isNull } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { workflowProposals } from "./db/schema.ts";
import { type Env, projectWrites } from "./project-writes.ts";
import {
  isDatabaseId,
  memberProject,
  unauthorized,
  writeAccess,
} from "./projects.ts";
import {
  claudeAsks,
  LANGUAGES,
  pendingProposal,
  STARTER_PATH,
  starterLanguage,
  starterText,
  summarize,
  WORKFLOWS_DIR,
} from "./workflows.ts";

// Decision 067 C: the language of the starter CI, which the server reads again.
const starterBody = z.object({ language: z.enum(LANGUAGES) });

export function workflowRoutes(db: Db, now: () => number) {
  const { record, writeChanges, saveFile } = projectWrites(db);
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
      proposal &&
      (await memberProject(db, user.userId, proposal.projectId, "owner"));
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

  return new Hono<Env>()
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
      const asks = await claudeAsks(
        db,
        project.id,
        user.userId,
        new Date(now()),
      );
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
          workflows: summarize(runs).map((w) => ({
            ...w,
            claude: asks.get(w.path) ?? null,
          })),
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
    );
}
