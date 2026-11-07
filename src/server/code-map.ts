import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import { type Citation, verifyCitations } from "./citations.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  codeMaps,
  codeSources,
  findings,
  MODULE_KINDS,
  type projects,
  tickets,
  userStories,
} from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { memberProject } from "./projects.ts";
import { noNul } from "./tickets.ts";

// Decision 043 A. The same schema validates what Claude sends, what is stored and what is read back (D).
export const MAX_FILES = 100;
export const text = (max: number) => z.string().min(1).max(max).refine(noNul);
const line = z.number().int().min(1).max(10_000_000);
export const citation = z
  .object({ path: text(255), start_line: line, end_line: line })
  .refine((c) => c.start_line <= c.end_line, {
    message: "start_line must not be after end_line",
  });
export const moduleData = z.object({
  manifest: text(255),
  runtimes: z
    .array(z.object({ name: text(100), version: text(100), citation }))
    .max(20),
  objects: z
    .array(
      z.object({
        name: text(200),
        kind: z.enum(["table", "type", "class"]),
        fields: z
          .array(z.object({ name: text(200), type: text(200) }))
          .max(100),
        citation,
      }),
    )
    .max(200),
  links: z
    .array(
      z.object({
        from: text(200),
        to: text(200),
        kind: z.enum(["contains", "references", "extends"]),
        cardinality: z.enum(["1", "0..1", "n"]).optional(),
      }),
    )
    .max(500),
});
export const codeMapArgs = z.object({
  project_id: z.number().int().min(1).max(2_147_483_647),
  commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  modules: z
    .array(
      z.object({
        path: text(255),
        name: text(200),
        kind: z.enum(MODULE_KINDS),
        ...moduleData.shape,
        // Stored modules may hold none (the page tolerates it); a call must send one.
        objects: moduleData.shape.objects.min(1),
      }),
    )
    .min(1)
    .max(10),
});

/** A refusal that says where the fault is, for Claude only (the history gets the fixed code). */
export class LocatedRefusal extends Refused {
  text: string;
  constructor(code: string, text: string) {
    super(code);
    this.text = text;
  }
}

type Args = z.output<typeof codeMapArgs>;

/** The refusals that need no GitHub: the first one, or undefined. */
function structuralRefusal({ modules }: Args) {
  const paths = new Set<string>();
  const files = new Set<string>();
  for (const [i, m] of modules.entries()) {
    if (paths.has(m.path))
      return new LocatedRefusal(
        "duplicate_module",
        `modules[${i}].path: another module of this call has the path ${m.path}`,
      );
    paths.add(m.path);
    files.add(m.manifest);
    const names = new Set<string>();
    for (const [j, o] of m.objects.entries()) {
      if (names.has(o.name))
        return new LocatedRefusal(
          "duplicate_object",
          `modules[${i}].objects[${j}].name: another object of this module is named ${o.name}`,
        );
      names.add(o.name);
      files.add(o.citation.path);
    }
    for (const r of m.runtimes) files.add(r.citation.path);
    for (const [j, l] of m.links.entries())
      for (const end of ["from", "to"] as const)
        if (!names.has(l[end]))
          return new LocatedRefusal(
            "unknown_link_end",
            `modules[${i}].links[${j}].${end}: no object named ${l[end]} in this module (a link joins two objects of the same module)`,
          );
  }
  if (files.size > MAX_FILES)
    return new LocatedRefusal(
      "too_many_files",
      `modules: this call cites ${files.size} distinct files, more than the ${MAX_FILES} allowed in one call. Send the modules in several calls.`,
    );
}

/** The citations of a call in the order of the refusals: for each module its manifest, runtimes, then objects. */
const citationsOf = ({ modules }: Args): Citation[] =>
  modules.flatMap((m, i) => [
    {
      where: `modules[${i}].manifest`,
      path: m.manifest,
      start_line: 1,
      end_line: 1,
    },
    ...m.runtimes.map((r, j) => ({
      where: `modules[${i}].runtimes[${j}].citation`,
      ...r.citation,
    })),
    ...m.objects.map((o, j) => ({
      where: `modules[${i}].objects[${j}].citation`,
      ...o.citation,
    })),
  ]);

/** Reads the commit and the citations on GitHub: the refusal that says where, or undefined. Only a GitHub failure is thrown. Shared by `submit_code_map` and `create_takeover_stories` (decision 047 B). */
export async function citationRefusal(
  readGitHub: ReadGitHub,
  { installationId, fullName }: typeof projects.$inferSelect,
  commitSha: string,
  citations: Citation[],
) {
  const ready = await readGitHub();
  if (!ready) throw new Error("Cockpit is not configured");
  const { github } = ready;
  // The root tree of the commit: 404 when GitHub does not know it.
  const reader = await github.fileReader(installationId, fullName);
  const known = await reader.inspect("", commitSha).then(
    () => true,
    (error) => {
      if ((error as { status?: number }).status === 404) return false;
      throw error;
    },
  );
  if (!known)
    return new LocatedRefusal(
      "unknown_commit",
      `commit_sha: GitHub does not know the commit ${commitSha} in ${fullName}. Use the commit of HEAD after pushing.`,
    );
  const checked = await verifyCitations(
    github,
    installationId,
    fullName,
    commitSha,
    citations,
    reader,
  );
  if ("refused" in checked)
    return new LocatedRefusal("invalid_citation", checked.refused);
}

/** `submit_code_map` (decision 043): everything is checked, GitHub included, before the one transaction that replaces the modules of the call. GitHub is read before it, which would otherwise hold a connection. */
export async function submitCodeMap(
  db: Db,
  readGitHub: ReadGitHub,
  entry: Entry,
  project: typeof projects.$inferSelect,
  args: Args,
) {
  let refusal: Refused | undefined = project.archivedAt
    ? new Refused("project_archived")
    : structuralRefusal(args);
  let failed: unknown;
  if (!refusal) {
    try {
      refusal = await citationRefusal(
        readGitHub,
        project,
        args.commit_sha,
        citationsOf(args),
      );
    } catch (error) {
      failed = error;
    }
  }
  return act(db, entry, async (tx) => {
    if (failed) throw failed;
    if (refusal) throw refusal;
    for (const m of args.modules) {
      const row = {
        modulePath: m.path,
        moduleName: m.name,
        moduleKind: m.kind,
        commitSha: args.commit_sha,
        data: moduleData.parse(m),
        createdAt: new Date(),
      };
      await tx
        .insert(codeMaps)
        .values({ projectId: project.id, ...row })
        .onConflictDoUpdate({
          target: [codeMaps.projectId, codeMaps.modulePath],
          set: row,
        });
    }
    return { project_id: project.id, modules_stored: args.modules.length };
  });
}

const LINE_CONTEXT = 3;
const codeQuery = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    path: text(255),
    start: z
      .string()
      .regex(/^[1-9]\d{0,8}$/)
      .transform(Number),
    end: z
      .string()
      .regex(/^[1-9]\d{0,8}$/)
      .transform(Number),
  })
  .refine((q) => q.start <= q.end);

const GITHUB_DOWN = { error: "github_unavailable" };

/** The map of a project and the code its objects cite (decision 043 G and H). */
export function codeMapRoutes(db: Db, readGitHub: ReadGitHub) {
  const stored = (projectId: number) =>
    db
      .select()
      .from(codeMaps)
      .where(eq(codeMaps.projectId, projectId))
      .orderBy(asc(codeMaps.modulePath));

  return new Hono()
    .get("/api/projects/:id/code-map", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const rows = (await stored(project.id)).flatMap((r) => {
        const data = moduleData.safeParse(r.data);
        if (data.success) return [{ ...r, data: data.data }];
        console.error(
          `Stored code map ${r.modulePath} is corrupt:`,
          data.error,
        );
        return [];
      });
      const shas = [...new Set(rows.map((r) => r.commitSha))];
      const since = new Map<string, number | null>();
      try {
        const ready = await readGitHub();
        if (!ready) throw new Error("Cockpit is not configured");
        await Promise.all(
          shas.map(async (sha) => {
            try {
              since.set(
                sha,
                await ready.github.commitsSince(
                  project.installationId,
                  project.fullName,
                  sha,
                  project.defaultBranch,
                ),
              );
            } catch (error) {
              // One commit GitHub cannot compare must not hide the map: its count is unknown.
              console.error("GitHub request failed:", error);
              since.set(sha, null);
            }
          }),
        );
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json(GITHUB_DOWN, 502);
      }
      return c.json({
        modules: rows.map((r) => ({
          path: r.modulePath,
          name: r.moduleName,
          kind: r.moduleKind,
          commitSha: r.commitSha,
          createdAt: r.createdAt.toISOString(),
          commitsSince: since.get(r.commitSha) ?? null,
          data: r.data,
        })),
      });
    })
    .get("/api/projects/:id/code", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const query = codeQuery.safeParse(c.req.query());
      if (!query.success) return c.json({ error: "Bad request" }, 400);
      const { sha, path, start, end } = query.data;
      // Only a file the map cites at this commit: the route must not read anything else of the repo.
      const rows = await db
        .select()
        .from(codeMaps)
        .where(
          and(eq(codeMaps.projectId, project.id), eq(codeMaps.commitSha, sha)),
        );
      const inMap = rows.some((r) => {
        const parsed = moduleData.safeParse(r.data);
        if (!parsed.success) {
          console.error(
            `Stored code map ${r.modulePath} is corrupt:`,
            parsed.error,
          );
          return false;
        }
        const data = parsed.data;
        return [
          data.manifest,
          ...data.runtimes.map((x) => x.citation.path),
          ...data.objects.map((x) => x.citation.path),
        ].includes(path);
      });
      // Or a line a rule of the project cites at this commit (decision 047 H).
      const [cited] = inMap
        ? []
        : await db
            .select({ id: codeSources.id })
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
                eq(tickets.projectId, project.id),
                eq(codeSources.commitSha, sha),
                eq(codeSources.path, path),
              ),
            )
            .limit(1);
      // Or a line a finding of the project cites at this commit (decision 051 F).
      const [citedByFinding] =
        inMap || cited
          ? []
          : await db
              .select({ id: codeSources.id })
              .from(codeSources)
              .innerJoin(findings, eq(findings.id, codeSources.findingId))
              .where(
                and(
                  eq(findings.projectId, project.id),
                  eq(codeSources.commitSha, sha),
                  eq(codeSources.path, path),
                ),
              )
              .limit(1);
      if (!inMap && !cited && !citedByFinding)
        return c.json({ error: "Not found" }, 404);
      try {
        const ready = await readGitHub();
        if (!ready) throw new Error("Cockpit is not configured");
        const { inspect } = await ready.github.fileReader(
          project.installationId,
          project.fullName,
        );
        const found = await inspect(path, sha);
        if (!found?.text) return c.json({ error: "Not found" }, 404);
        const all = found.text.replace(/\n$/, "").split("\n");
        const firstLine = Math.max(1, start - LINE_CONTEXT);
        return c.json({
          firstLine,
          lines: all.slice(firstLine - 1, end + LINE_CONTEXT),
        });
      } catch (error) {
        // The commit vanished from GitHub (a forced push): the code is gone, not GitHub.
        if ((error as { status?: number }).status === 404)
          return c.json({ error: "Not found" }, 404);
        console.error("GitHub request failed:", error);
        return c.json(GITHUB_DOWN, 502);
      }
    });
}
