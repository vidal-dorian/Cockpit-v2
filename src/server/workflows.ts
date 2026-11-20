import { readFileSync } from "node:fs";
import { and, asc, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import type { Db } from "./db/db.ts";
import {
  cloudLaunches,
  type projects,
  workflowProposals,
} from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { assertActive } from "./tickets.ts";

export const STARTER_PATH = ".github/workflows/ci.yml";
export const WORKFLOWS_DIR = ".github/workflows";
export const LANGUAGES = ["node", "python", "go", "rust"] as const;

/** Decision 067 E: a workflow file, its name in the format of the agents (decision 029 B). */
export const workflowPath = z
  .string()
  .max(255)
  .regex(/^\.github\/workflows\/[a-z0-9][a-z0-9-]*\.ya?ml$/);

/** Decision 067 C: the first manifest at the root decides, in this order. */
const MANIFESTS = [
  ["package.json", "node"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
] as const;
export const starterLanguage = (rootFiles: string[]) =>
  MANIFESTS.find(([file]) => rootFiles.includes(file))?.[1] ?? null;

export const starterText = (language: (typeof LANGUAGES)[number]) =>
  readFileSync(
    new URL(`../../catalog/ci/${language}.yml`, import.meta.url),
    "utf8",
  );

const FAILED = ["failure", "timed_out", "startup_failure"];

type Run = {
  conclusion: string | null;
  event: string;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
  html_url: string;
};

/** Decision 067 B: what a workflow line shows, from its 10 newest runs, newest first. Only completed runs count (a run in progress has no conclusion yet). */
export function summarize(
  workflows: { path: string; name: string; runs: Run[] }[],
) {
  return workflows.map(({ path, name, runs }) => {
    // A run that is in progress, cancelled or skipped says nothing of the code.
    const done = runs.filter(
      (r) =>
        r.conclusion !== null &&
        r.conclusion !== "cancelled" &&
        r.conclusion !== "skipped",
    );
    const last = done[0];
    const passed = done.findIndex(
      (r) => !FAILED.includes(r.conclusion as string),
    );
    const seconds = done.map(
      (r) =>
        (Date.parse(r.updated_at) -
          Date.parse(r.run_started_at ?? r.created_at)) /
        1000,
    );
    return {
      path,
      name,
      event: last?.event ?? null,
      lastRun: last
        ? {
            conclusion: last.conclusion,
            at: last.created_at,
            url: last.html_url,
          }
        : null,
      failingSince: passed === -1 ? done.length : passed,
      averageSeconds: done.length
        ? Math.round(seconds.reduce((a, b) => a + b, 0) / done.length)
        : null,
    };
  });
}

/** The oldest proposal still waiting for the human (decision 067 F), null when none. */
export async function pendingProposal(db: Db, projectId: number) {
  const [row] = await db
    .select()
    .from(workflowProposals)
    .where(
      and(
        eq(workflowProposals.projectId, projectId),
        isNull(workflowProposals.decision),
      ),
    )
    .orderBy(asc(workflowProposals.id))
    .limit(1);
  return row
    ? {
        id: row.id,
        path: row.path,
        reason: row.reason,
        before: row.before,
        content: row.content,
        createdAt: row.createdAt,
      }
    : null;
}

/** `propose_workflow_change` (decision 067 E): the file is read on GitHub for `before`, and nothing is written there. A pending proposal on the same file is replaced. */
export async function proposeWorkflowChange(
  db: Db,
  readGitHub: ReadGitHub,
  entry: Entry,
  project: typeof projects.$inferSelect,
  args: { path: string; content: string; reason: string },
) {
  let before: string | null = null;
  // GitHub is read before the transaction; a failure waits for `act`, which writes the one entry.
  let failed: unknown = project.archivedAt
    ? new Refused("project_archived")
    : undefined;
  if (!failed)
    try {
      const ready = await readGitHub();
      if (!ready) throw new Error("Cockpit is not configured");
      const { head, inspect } = await ready.github.fileReader(
        project.installationId,
        project.fullName,
      );
      const tip = await head();
      if ("refused" in tip) throw new Refused(tip.refused);
      const found = await inspect(args.path, tip.sha);
      // A directory or a symlink has no text to propose a change of.
      if (found && found.text === undefined) throw new Refused("not_a_file");
      before = found === null ? null : (found.text ?? "");
    } catch (error) {
      failed = error;
    }
  return act(db, entry, async (tx) => {
    if (failed) throw failed;
    await assertActive(tx, project.id);
    if (before === args.content) throw new Refused("no_change");
    const replaced = await tx
      .delete(workflowProposals)
      .where(
        and(
          eq(workflowProposals.projectId, project.id),
          eq(workflowProposals.path, args.path),
          isNull(workflowProposals.decision),
        ),
      )
      .returning({ id: workflowProposals.id });
    const [row] = await tx
      .insert(workflowProposals)
      .values({ projectId: project.id, before, ...args })
      .returning({ id: workflowProposals.id });
    if (!row) throw new Error("proposal not created");
    return { proposal_id: row.id, replaced: replaced.length > 0 };
  });
}

/** Decision 085 E: an ask without news after two hours no longer counts (as for routines, decision 056 B), so a dead session never locks a workflow. */
export const ASK_GIVE_UP_MS = 2 * 3_600_000;

/** Decision 085 E: the last « Demander à Claude » of each workflow of the project, by path (a workflow never asked about has none). */
export async function claudeAsks(
  db: Db,
  projectId: number,
  userId: number,
  at: Date,
) {
  const asks = new Map<
    string,
    {
      sessionUrl: string | null;
      startedAt: Date;
      finishedAt: Date | null;
      outcome: "succeeded" | "failed" | null;
      summary: string | null;
    }
  >();
  for (const l of await db
    .select()
    .from(cloudLaunches)
    .where(
      and(
        eq(cloudLaunches.projectId, projectId),
        isNotNull(cloudLaunches.workflowPath),
        or(
          isNotNull(cloudLaunches.finishedAt),
          gt(cloudLaunches.createdAt, new Date(at.getTime() - ASK_GIVE_UP_MS)),
        ),
      ),
    )
    .orderBy(desc(cloudLaunches.id)))
    if (l.workflowPath && !asks.has(l.workflowPath))
      asks.set(l.workflowPath, {
        // Only the launcher sees the session address (decision 060, amended).
        sessionUrl: l.userId === userId ? l.sessionUrl : null,
        startedAt: l.createdAt,
        finishedAt: l.finishedAt,
        outcome: l.outcome,
        summary: l.summary,
      });
  return asks;
}
