import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import {
  citation,
  citationRefusal,
  LocatedRefusal,
  MAX_FILES,
  text,
} from "./code-map.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  codeSources,
  FINDING_EFFORTS,
  FINDING_KINDS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  findings,
  type projects,
  tickets,
  userStories,
} from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { isDatabaseId, memberProject } from "./projects.ts";
import { assertActive, noNul, refusal } from "./tickets.ts";

// Decision 051 A: what Claude files with `submit_findings`.
export const findingsArgs = z.object({
  project_id: z.number().int().min(1).max(2_147_483_647),
  commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  findings: z
    .array(
      z.object({
        kind: z.enum(FINDING_KINDS),
        title: text(200),
        body_md: text(20_000),
        severity: z.enum(FINDING_SEVERITIES),
        effort: z.enum(FINDING_EFFORTS).optional(),
        sources: z.array(citation).min(1).max(5),
      }),
    )
    .min(1)
    .max(50),
});
export const listFindingsArgs = z.object({
  project_id: z.number().int().min(1).max(2_147_483_647),
  kind: z.enum(FINDING_KINDS).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
});
type Args = z.output<typeof findingsArgs>;

/** `submit_findings` (decision 051 A): like `submit_code_map`, GitHub is read before the one transaction that stores every finding and its sources, or nothing. */
export async function submitFindings(
  db: Db,
  readGitHub: ReadGitHub,
  entry: Entry,
  project: typeof projects.$inferSelect,
  args: Args,
) {
  const citations = args.findings.flatMap((f, i) =>
    f.sources.map((source, j) => ({
      where: `findings[${i}].sources[${j}]`,
      ...source,
    })),
  );
  const files = new Set(citations.map((c) => c.path));
  let refused: Refused | undefined = project.archivedAt
    ? new Refused("project_archived")
    : files.size > MAX_FILES
      ? new LocatedRefusal(
          "too_many_files",
          `findings: this call cites ${files.size} distinct files, more than the ${MAX_FILES} allowed in one call. Send the findings in several calls.`,
        )
      : undefined;
  let failed: unknown;
  if (!refused)
    try {
      refused = await citationRefusal(
        readGitHub,
        project,
        args.commit_sha,
        citations,
      );
    } catch (error) {
      failed = error;
    }
  return act(db, entry, async (tx) => {
    if (failed) throw failed;
    if (refused) throw refused;
    await assertActive(tx, project.id);
    const created = await tx
      .insert(findings)
      .values(
        args.findings.map((f) => ({
          projectId: project.id,
          kind: f.kind,
          title: f.title,
          bodyMd: f.body_md,
          severity: f.severity,
          effort: f.effort,
          commitSha: args.commit_sha,
        })),
      )
      .returning({ id: findings.id });
    await tx.insert(codeSources).values(
      args.findings.flatMap((f, i) =>
        f.sources.map((s, position) => ({
          findingId: (created[i] as { id: number }).id,
          position,
          path: s.path,
          startLine: s.start_line,
          endLine: s.end_line,
          commitSha: args.commit_sha,
        })),
      ),
    );
    entry.args = {
      projectId: project.id,
      findings: created.length,
      ids: created.map((c) => c.id).join(","),
    };
    return { findings: created };
  });
}

/** The sources of some findings, in the order of each finding. */
async function sourcesOfFindings(db: Pick<Db, "select">, ids: number[]) {
  const byFinding = new Map<number, (typeof codeSources.$inferSelect)[]>();
  if (ids.length === 0) return byFinding;
  const found = await db
    .select()
    .from(codeSources)
    .where(inArray(codeSources.findingId, ids))
    .orderBy(asc(codeSources.findingId), asc(codeSources.position));
  for (const s of found)
    byFinding.set(s.findingId as number, [
      ...(byFinding.get(s.findingId as number) ?? []),
      s,
    ]);
  return byFinding;
}

/** `list_findings` (decision 051 B): what is known, with no text, so that Claude does not file it twice. */
export function listFindings(
  db: Db,
  entry: Entry,
  projectId: number,
  filters: { kind?: (typeof FINDING_KINDS)[number]; status?: string },
) {
  return act(db, entry, async (tx) => {
    const rows = await tx
      .select({
        id: findings.id,
        title: findings.title,
        kind: findings.kind,
        severity: findings.severity,
        status: findings.status,
      })
      .from(findings)
      .where(
        and(
          eq(findings.projectId, projectId),
          filters.kind ? eq(findings.kind, filters.kind) : undefined,
          filters.status
            ? eq(findings.status, filters.status as "open")
            : undefined,
        ),
      )
      .orderBy(asc(findings.id));
    const sources = await sourcesOfFindings(
      tx,
      rows.map((r) => r.id),
    );
    return {
      findings: rows.map((r) => ({
        ...r,
        files: [...new Set((sources.get(r.id) ?? []).map((s) => s.path))],
      })),
    };
  });
}

/** A permalink to the cited lines, as GitHub writes it. */
export const permalink = (
  fullName: string,
  s: { commitSha: string; path: string; startLine: number; endLine: number },
) =>
  `https://github.com/${fullName}/blob/${s.commitSha}/${s.path.split("/").map(encodeURIComponent).join("/")}#L${s.startLine}${s.endLine > s.startLine ? `-L${s.endLine}` : ""}`;

// A body that is not JSON is as invalid as one of the wrong shape.
const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const dismissBody = z.object({
  reason: z.string().trim().max(1_000).refine(noNul).optional(),
});

/** Decision 051 D and G: the findings of a project and the human choices on them. Claude triages nothing: there is no tool for it. */
export function findingRoutes(db: Db) {
  /** The files cited by a frozen rule of the project (decision 050 F: its story is done and its test passed). */
  const frozenFiles = async (projectId: number) =>
    new Set(
      (
        await db
          .selectDistinct({ path: codeSources.path })
          .from(codeSources)
          .innerJoin(
            acceptanceCriteria,
            eq(acceptanceCriteria.id, codeSources.criterionId),
          )
          .innerJoin(
            userStories,
            eq(userStories.id, acceptanceCriteria.storyId),
          )
          .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
          .where(
            and(
              eq(tickets.projectId, projectId),
              eq(userStories.kind, "takeover"),
              eq(userStories.status, "done"),
              eq(acceptanceCriteria.result, "passed"),
            ),
          )
      ).map((r) => r.path),
    );

  const present = async (projectId: number, status?: string) => {
    const rows = await db
      .select()
      .from(findings)
      .where(
        and(
          eq(findings.projectId, projectId),
          status ? eq(findings.status, status as "open") : undefined,
        ),
      )
      .orderBy(
        sql`case ${findings.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
        desc(findings.createdAt),
        desc(findings.id),
      );
    const sources = await sourcesOfFindings(
      db,
      rows.map((r) => r.id),
    );
    const protectedFiles = await frozenFiles(projectId);
    return rows.map((f) => {
      const own = sources.get(f.id) ?? [];
      return {
        id: f.id,
        kind: f.kind,
        source: f.source,
        title: f.title,
        bodyMd: f.bodyMd,
        severity: f.severity,
        effort: f.effort,
        status: f.status,
        ticketId: f.ticketId,
        dismissReason: f.dismissReason,
        commitSha: f.commitSha,
        createdAt: f.createdAt.toISOString(),
        sources: own.map((s) => ({
          path: s.path,
          startLine: s.startLine,
          endLine: s.endLine,
          commitSha: s.commitSha,
        })),
        // Decision 051 I: files are compared, not lines; computed here, never stored.
        unprotected:
          (f.kind === "architecture" || f.kind === "stack") &&
          !own.some((s) => protectedFiles.has(s.path)),
      };
    });
  };

  /** One choice on one finding that is still to decide (open or later), in one `act`; `change` returns what the answer holds. */
  const decide = async (
    c: Parameters<typeof currentUser>[1],
    action: string,
    change: (
      tx: Tx,
      finding: typeof findings.$inferSelect,
      project: typeof projects.$inferSelect,
      entry: Entry,
    ) => Promise<object>,
  ) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const id = Number(c.req.param("id"));
    const [found] = isDatabaseId(id)
      ? await db.select().from(findings).where(eq(findings.id, id))
      : [];
    const project =
      found && (await memberProject(db, user.userId, found.projectId));
    if (!found || !project) return c.json({ error: "Not found" }, 404);
    const entry: Entry = {
      userId: user.userId,
      actor: "human",
      origin: "ui",
      action,
      args: { findingId: id },
      projectId: project.id,
    };
    try {
      return c.json(
        await act(db, entry, async (tx) => {
          await assertActive(tx, project.id);
          const [locked] = await tx
            .select()
            .from(findings)
            .where(eq(findings.id, id))
            .for("update");
          if (!locked) throw new Refused("not_found");
          if (locked.status === "ticketed" || locked.status === "dismissed")
            throw new Refused("not_open");
          return change(tx, locked, project, entry);
        }),
      );
    } catch (error) {
      return refusal(c, error);
    }
  };

  const setStatus = async (
    tx: Tx,
    id: number,
    set: Partial<typeof findings.$inferInsert>,
  ) => {
    const [row] = await tx
      .update(findings)
      .set(set)
      .where(eq(findings.id, id))
      .returning();
    return row as typeof findings.$inferSelect;
  };

  return new Hono()
    .get("/api/projects/:id/findings", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const status = z
        .enum(FINDING_STATUSES)
        .optional()
        .safeParse(c.req.query("status"));
      if (!status.success) return c.json({ error: "Bad request" }, 400);
      return c.json({ findings: await present(project.id, status.data) });
    })
    .post("/api/findings/:id/ticket", (c) =>
      decide(c, "ticket_finding", async (tx, finding, project, entry) => {
        const sources = await sourcesOfFindings(tx, [finding.id]);
        const links = (sources.get(finding.id) ?? [])
          .map((s) => `- <${permalink(project.fullName, s)}>`)
          .join("\n");
        const [ticket] = await tx
          .insert(tickets)
          .values({
            projectId: project.id,
            title: finding.title,
            descriptionMd: `${finding.bodyMd}\n\n**Sources**\n${links}`,
          })
          .returning({ id: tickets.id, title: tickets.title });
        if (!ticket) throw new Error("ticket not created");
        await setStatus(tx, finding.id, {
          status: "ticketed",
          ticketId: ticket.id,
        });
        entry.ticketId = ticket.id;
        return { ticket };
      }),
    )
    .post("/api/findings/:id/dismiss", async (c) => {
      const raw = await c.req.text();
      const parsed = dismissBody.safeParse(raw === "" ? {} : parseJson(raw));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      return decide(c, "dismiss_finding", async (tx, finding) => ({
        finding: await setStatus(tx, finding.id, {
          status: "dismissed",
          dismissReason: parsed.data.reason || null,
        }),
      }));
    })
    .post("/api/findings/:id/later", (c) =>
      decide(c, "later_finding", async (tx, finding) => ({
        finding: await setStatus(tx, finding.id, { status: "later" }),
      })),
    );
}
