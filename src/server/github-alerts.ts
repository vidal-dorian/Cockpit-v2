import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  codeSources,
  FINDING_SEVERITIES,
  findings,
  type GITHUB_ALERT_TYPES,
  projects,
} from "./db/schema.ts";
import {
  ALERT_TOOLS,
  type AlertTool,
  type codeScanningAlert,
  type dependabotAlert,
  type githubClient,
  type ReadGitHub,
  type secretScanningAlert,
} from "./github.ts";
import { alertsAccess, toolGranted } from "./health.ts";
import { memberProject } from "./projects.ts";
import { assertActive, refusal } from "./tickets.ts";

type Project = typeof projects.$inferSelect;
type Severity = (typeof FINDING_SEVERITIES)[number];
/** What an alert becomes (decision 052 D): the columns of its finding and the lines it cites. */
type Mapped = {
  number: number;
  title: string;
  bodyMd: string;
  severity: Severity;
  commitSha: string | null;
  source: {
    path: string;
    startLine: number;
    endLine: number;
    commitSha: string;
  } | null;
};

/** The page of an alert on GitHub, built from the repo and the number: no address of GitHub's answers is trusted. */
export const alertUrl = (
  fullName: string,
  type: (typeof GITHUB_ALERT_TYPES)[number],
  number: number,
) =>
  `https://github.com/${fullName}/security/${type.replace("_", "-")}/${number}`;

const severityOf = (value: string | null | undefined): Severity | null =>
  value === "moderate"
    ? "medium"
    : (FINDING_SEVERITIES.find((s) => s === value) ?? null);

function fromDependabot(
  fullName: string,
  a: z.infer<typeof dependabotAlert>,
): Mapped {
  const { security_advisory: advisory, security_vulnerability: vuln } = a;
  return {
    number: a.number,
    title: `${vuln.package.name} : ${advisory.summary}`,
    bodyMd: [
      `**Avis** : ${advisory.ghsa_id}${advisory.cve_id ? ` (${advisory.cve_id})` : ""}`,
      `**Écosystème** : ${vuln.package.ecosystem}`,
      `**Versions touchées** : ${vuln.vulnerable_version_range ?? "inconnues"}`,
      `**Première version corrigée** : ${vuln.first_patched_version?.identifier ?? "aucune pour l'instant"}`,
      `**Manifeste** : ${a.dependency.manifest_path ?? "inconnu"}`,
      `Alerte : <${alertUrl(fullName, "dependabot", a.number)}>`,
    ].join("\n\n"),
    severity: severityOf(advisory.severity) ?? "medium",
    commitSha: null,
    source: null,
  };
}

function fromCodeScanning(
  fullName: string,
  a: z.infer<typeof codeScanningAlert>,
): Mapped {
  const { rule } = a;
  const instance = a.most_recent_instance;
  const at = instance?.location;
  const commitSha = instance?.commit_sha ?? null;
  return {
    number: a.number,
    title: rule.description || rule.name || rule.id || "Alerte code scanning",
    bodyMd: [
      `**Outil** : ${a.tool?.name ?? "inconnu"}`,
      `**Règle** : ${rule.id ?? rule.name ?? "inconnue"}`,
      ...(instance?.message?.text
        ? [`**Message** : ${instance.message.text}`]
        : []),
      `Alerte : <${alertUrl(fullName, "code_scanning", a.number)}>`,
    ].join("\n\n"),
    severity:
      severityOf(rule.security_severity_level) ??
      (rule.severity === "error"
        ? "high"
        : rule.severity === "warning"
          ? "medium"
          : "low"),
    commitSha,
    source:
      commitSha && at?.path && at.start_line && at.start_line >= 1
        ? {
            path: at.path,
            startLine: at.start_line,
            endLine: Math.max(at.end_line ?? at.start_line, at.start_line),
            commitSha,
          }
        : null,
  };
}

type GitHub = ReturnType<typeof githubClient>;
type SecretLocation = Awaited<ReturnType<GitHub["readSecretLocation"]>>;

function fromSecretScanning(
  fullName: string,
  a: z.infer<typeof secretScanningAlert>,
  location: SecretLocation,
): Mapped {
  const type = a.secret_type_display_name || a.secret_type;
  return {
    number: a.number,
    title: `Secret exposé : ${type}`,
    bodyMd: [
      `**Type** : ${type}`,
      `Alerte : <${alertUrl(fullName, "secret_scanning", a.number)}>`,
    ].join("\n\n"),
    severity: "critical",
    commitSha: location?.commitSha ?? null,
    source: location,
  };
}

/** Reads the location of a secret alert, then maps the alert. The GitHub reads of one call run in turn of ten, each awaited whole so none outlives the call. */
async function mapAll<A extends { number: number }>(
  alerts: A[],
  map: (alert: A) => Promise<Mapped> | Mapped,
) {
  const mapped: Mapped[] = [];
  for (let i = 0; i < alerts.length; i += 10) {
    const done = await Promise.allSettled(alerts.slice(i, i + 10).map(map));
    for (const result of done) {
      if (result.status === "rejected") throw result.reason;
      mapped.push(result.value);
    }
  }
  return mapped;
}

/** An alert of any tool as its finding; `github` reads the first place of a secret. */
async function mapAlerts(
  tool: AlertTool,
  alerts: unknown[],
  project: Project,
  github: GitHub,
) {
  const { fullName } = project;
  if (tool === "dependabot")
    return mapAll(alerts as z.infer<typeof dependabotAlert>[], (a) =>
      fromDependabot(fullName, a),
    );
  if (tool === "code_scanning")
    return mapAll(alerts as z.infer<typeof codeScanningAlert>[], (a) =>
      fromCodeScanning(fullName, a),
    );
  return mapAll(alerts as z.infer<typeof secretScanningAlert>[], async (a) =>
    fromSecretScanning(
      fullName,
      a,
      await github.readSecretLocation(
        project.installationId,
        fullName,
        a.number,
      ),
    ),
  );
}

const CHUNK = 200;

/** Creates the findings of the alerts not known yet and updates the others (title, text, severity and lines, never the status), and reopens them (decision 052 E and F). */
async function storeAlerts(
  tx: Tx,
  projectId: number,
  type: (typeof GITHUB_ALERT_TYPES)[number],
  mapped: Mapped[],
) {
  // A page shift can give one alert twice: the last one read wins.
  mapped = [...new Map(mapped.map((m) => [m.number, m])).values()];
  if (mapped.length === 0) return { created: 0, updated: 0 };
  const known = new Map(
    (
      await tx
        .select({ id: findings.id, number: findings.githubAlertNumber })
        .from(findings)
        .where(
          and(
            eq(findings.projectId, projectId),
            eq(findings.githubAlertType, type),
          ),
        )
    ).map((f) => [f.number, f.id]),
  );
  const columns = (m: Mapped) => ({
    title: m.title,
    bodyMd: m.bodyMd,
    severity: m.severity,
    commitSha: m.commitSha,
  });
  const ids = new Map<number, number>();
  let insertedCount = 0;
  const fresh = mapped.filter((m) => !known.has(m.number));
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const created = await tx
      .insert(findings)
      .values(
        fresh.slice(i, i + CHUNK).map((m) => ({
          ...columns(m),
          projectId,
          kind: "security" as const,
          source: "github" as const,
          githubAlertType: type,
          githubAlertNumber: m.number,
        })),
      )
      // A webhook may have stored the alert since `known` was read.
      .onConflictDoUpdate({
        target: [
          findings.projectId,
          findings.githubAlertType,
          findings.githubAlertNumber,
        ],
        set: {
          title: sql`excluded.title`,
          bodyMd: sql`excluded.body_md`,
          severity: sql`excluded.severity`,
          commitSha: sql`excluded.commit_sha`,
          githubClosedAt: null,
        },
      })
      .returning({
        id: findings.id,
        number: findings.githubAlertNumber,
        // xmax is 0 for a row that was inserted, not one updated by the conflict.
        inserted: sql<boolean>`xmax = 0`,
      });
    for (const row of created) {
      ids.set(row.number as number, row.id);
      if (row.inserted) insertedCount++;
    }
  }
  const seen = mapped.filter((m) => known.has(m.number));
  for (const m of seen) {
    const id = known.get(m.number) as number;
    ids.set(m.number, id);
    await tx
      .update(findings)
      .set({ ...columns(m), githubClosedAt: null })
      .where(eq(findings.id, id));
  }
  await tx
    .delete(codeSources)
    .where(inArray(codeSources.findingId, [...ids.values()]));
  const sources = mapped.flatMap((m) =>
    m.source
      ? [{ findingId: ids.get(m.number) as number, position: 0, ...m.source }]
      : [],
  );
  for (let i = 0; i < sources.length; i += CHUNK)
    await tx.insert(codeSources).values(sources.slice(i, i + CHUNK));
  return {
    created: insertedCount,
    updated: mapped.length - insertedCount,
  };
}

/** Dates as closed on GitHub the open findings of a tool whose alert is not in `except` (every alert when empty); returns how many. The status is never touched. */
async function closeAlerts(
  tx: Tx,
  projectId: number,
  type: (typeof GITHUB_ALERT_TYPES)[number],
  except: number[],
  only?: number,
) {
  const closed = await tx
    .update(findings)
    .set({ githubClosedAt: sql`now()` })
    .where(
      and(
        eq(findings.projectId, projectId),
        eq(findings.githubAlertType, type),
        isNull(findings.githubClosedAt),
        only === undefined ? undefined : eq(findings.githubAlertNumber, only),
        only !== undefined || except.length === 0
          ? undefined
          : notInArray(findings.githubAlertNumber, except),
      ),
    )
    .returning({ id: findings.id });
  return closed.length;
}

type ToolRead =
  | "no_permission"
  | "disabled"
  | { mapped: Mapped[]; complete: boolean };

/** « Actualiser » (decision 052 C): the alerts of the three tools are read first, then stored in one transaction with the history entry, or nothing is. */
export function alertRoutes(db: Db, readGitHub: ReadGitHub) {
  return new Hono().post("/api/projects/:id/findings/refresh", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const project = await memberProject(
      db,
      user.userId,
      Number(c.req.param("id")),
      "can_validate",
    );
    if (!project) return c.json({ error: "Not found" }, 404);
    const entry: Entry = {
      userId: user.userId,
      actor: "human",
      origin: "ui",
      action: "refresh_github_alerts",
      args: { projectId: project.id },
      projectId: project.id,
    };
    let reads: [AlertTool, ToolRead][] = [];
    let access: ReturnType<typeof alertsAccess> = null;
    let failed: unknown;
    if (!project.archivedAt)
      try {
        const ready = await readGitHub();
        if (!ready) throw new Error("Cockpit is not configured");
        const { github, appSettingsUrl } = ready;
        const granted = await github.readAppAccess(project.installationId);
        access = alertsAccess(granted, appSettingsUrl);
        // Each read is awaited whole, so none outlives a failure of another.
        const done = await Promise.allSettled(
          (Object.keys(ALERT_TOOLS) as AlertTool[]).map(
            async (tool): Promise<[AlertTool, ToolRead]> => {
              if (!toolGranted(granted.installation, tool))
                return [tool, "no_permission"];
              const read = await github.readAlerts(
                project.installationId,
                project.fullName,
                tool,
              );
              if ("disabled" in read) return [tool, "disabled"];
              return [
                tool,
                {
                  mapped: await mapAlerts(tool, read.alerts, project, github),
                  complete: read.complete,
                },
              ];
            },
          ),
        );
        for (const result of done) {
          if (result.status === "rejected") throw result.reason;
          reads.push(result.value);
        }
      } catch (error) {
        failed = error;
        reads = [];
      }
    try {
      return c.json(
        await act(db, entry, async (tx) => {
          if (failed) throw failed;
          await assertActive(tx, project.id);
          let created = 0;
          let updated = 0;
          let closed = 0;
          for (const [tool, read] of reads) {
            if (typeof read === "string") continue;
            const stored = await storeAlerts(tx, project.id, tool, read.mapped);
            created += stored.created;
            updated += stored.updated;
            // Past the pages read, an alert may simply not have been read: only a complete list says which ones are gone.
            if (read.complete)
              closed += await closeAlerts(
                tx,
                project.id,
                tool,
                read.mapped.map((m) => m.number),
              );
          }
          entry.args = { projectId: project.id, created, updated, closed };
          return {
            tools: Object.fromEntries(
              reads.map(([tool, read]) => [
                tool,
                typeof read === "string" ? read : "ok",
              ]),
            ),
            created,
            updated,
            closed,
            access,
          };
        }),
      );
    } catch (error) {
      if (error === failed) return c.json({ error: "github_unavailable" }, 502);
      return refusal(c, error);
    }
  });
}

const EVENTS: Record<string, AlertTool> = {
  dependabot_alert: "dependabot",
  code_scanning_alert: "code_scanning",
  secret_scanning_alert: "secret_scanning",
};
/** Whether a webhook event is an alert of one of the three tools. */
export const isAlertEvent = (event: string) => event in EVENTS;

/** An alert received by webhook (decision 052 C), processed as a read: the state of the alert decides, whatever the action. An archived project or an untracked repo is nothing to do. */
export async function receiveAlert(
  db: Db,
  readGitHub: ReadGitHub,
  delivery: { event: string; repoId: number | null; payload: unknown },
) {
  const tool = EVENTS[delivery.event] as AlertTool;
  if (delivery.repoId === null) return;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.githubRepoId, delivery.repoId));
  if (!project || project.archivedAt) return;
  // The webhook is not the REST list (types.d.ts of @octokit/openapi-webhooks-types): a secret alert has no `state` and is closed once `resolution` is set, a code scanning alert has a null `state` outside the default branch, and a closed one may come without its tool or its occurrence. Only what decides is read first.
  const { alert: head, repository } = z
    .object({
      alert: z.object({
        number: z.int(),
        state: z.string().nullish(),
        resolution: z.string().nullish(),
      }),
      repository: z.object({ default_branch: z.string().nullish() }).nullish(),
    })
    .parse(delivery.payload);
  const closed =
    tool === "secret_scanning"
      ? // `resolution` alone: GitHub's schema does not say `resolved_at` is cleared on reopen.
        Boolean(head.resolution) ||
        (head.state != null && head.state !== "open")
      : head.state != null && head.state !== "open";
  if (closed) {
    await db.transaction((tx) =>
      closeAlerts(tx, project.id, tool, [], head.number),
    );
    return;
  }
  if (tool !== "secret_scanning" && head.state !== "open") return;
  const { alert } = z
    .object({ alert: ALERT_TOOLS[tool].schema })
    .parse(delivery.payload);
  // Only the default branch, like the list of a refresh.
  if (
    "most_recent_instance" in alert &&
    alert.most_recent_instance?.ref !==
      `refs/heads/${repository?.default_branch ?? project.defaultBranch}`
  )
    return;
  const ready = await readGitHub();
  if (!ready) throw new Error("Cockpit is not configured");
  const [mapped] = await mapAlerts(tool, [alert], project, ready.github);
  await db.transaction((tx) =>
    storeAlerts(tx, project.id, tool, [mapped as Mapped]),
  );
}
