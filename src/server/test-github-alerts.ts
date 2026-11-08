import { sql } from "drizzle-orm";
import { send } from "./test-decisions.ts";
import { type Ctx, ready } from "./test-findings.ts";
import { githubCalls } from "./test-github.ts";
import type { TestDb } from "./test-mcp.ts";

// Shared by the tests of slice R6 (decision 052): the alerts of GitHub as its REST API serves them, the route that reads them, and the tables read with raw SQL.
//
// Pinned names (decision 052 gives the columns and the routes; the rest is the choice of these tests, the developer follows them):
// - findings gains github_alert_type ('dependabot' | 'code_scanning' | 'secret_scanning'), github_alert_number and github_closed_at (timestamptz, null while open on GitHub);
//   source accepts 'github'; commit_sha is nullable (a Dependabot alert has none). See src/server/findings-github-schema.test.ts for the CHECKs.
// - POST /api/projects/:id/findings/refresh (no body) answers 200
//     { tools: { dependabot, code_scanning, secret_scanning }  each "ok" | "no_permission" | "disabled",
//       created: number, updated: number, closed: number,
//       access: null | { detail: "app_missing_permissions" | "installation_not_approved", url: string } }
//   `access` is the verdict of decision 052 B (null when the installation has the three permissions), `url` its link (the permissions page of the App, or the html_url of the installation).
//   See src/server/findings-github-refresh.test.ts for the rules.
// - A GitHub finding of the list (GET /api/projects/:id/findings) also carries githubAlertType, githubAlertNumber (null for a finding of Claude), githubClosedAt (ISO date or null)
//   and githubUrl (`https://github.com/<owner>/<repo>/security/<dependabot|code-scanning|secret-scanning>/<number>`, null for a finding of Claude).

/** The secret the fake secret scanning alerts carry in their `secret` field: it must appear nowhere in Cockpit (decision 052 D, principle 5 of the brief). */
export const SECRET = "ghp_SUPERSECRETVALUE0123456789abcdefABCDEF";
export const REPO_URL = "https://github.com/user1000/app";

export const dependabot = (
  n: number,
  opts: {
    state?: string;
    severity?: string;
    summary?: string;
    cve?: string | null;
    patched?: string | null;
    name?: string;
  } = {},
) => {
  const pkg = {
    ecosystem: "composer",
    name: opts.name ?? `vendor/pkg-${n}`,
  };
  const vulnerability = {
    package: pkg,
    severity: opts.severity ?? "high",
    vulnerable_version_range: ">= 5.4.0, < 5.4.20",
    first_patched_version:
      opts.patched === null ? null : { identifier: opts.patched ?? "5.4.20" },
  };
  return {
    number: n,
    state: opts.state ?? "open",
    dependency: {
      package: pkg,
      manifest_path: "composer.lock",
      scope: "runtime",
    },
    security_advisory: {
      ghsa_id: `GHSA-aaaa-bbbb-${String(n).padStart(4, "0")}`,
      cve_id: opts.cve === null ? null : (opts.cve ?? `CVE-2026-${1000 + n}`),
      summary: opts.summary ?? `Fuite de cookie ${n}`,
      severity: opts.severity ?? "high",
      vulnerabilities: [vulnerability],
    },
    security_vulnerability: vulnerability,
    url: `https://api.github.com/repos/user1000/app/dependabot/alerts/${n}`,
    html_url: `${REPO_URL}/security/dependabot/${n}`,
  };
};

export const codeScanning = (
  n: number,
  opts: {
    state?: string;
    severity?: string;
    securitySeverity?: string | null;
    description?: string;
    path?: string;
    start?: number;
    end?: number;
    commit?: string;
  } = {},
) => ({
  number: n,
  state: opts.state ?? "open",
  rule: {
    id: "js/sql-injection",
    name: "SqlInjection",
    severity: opts.severity ?? "error",
    ...(opts.securitySeverity === null
      ? {}
      : { security_severity_level: opts.securitySeverity ?? "high" }),
    description:
      opts.description ?? `Requête SQL construite avec une entrée ${n}`,
  },
  tool: { name: "CodeQL", version: "2.15.0" },
  most_recent_instance: {
    ref: "refs/heads/main",
    commit_sha: opts.commit ?? "a".repeat(40),
    message: { text: `Cette requête dépend d'une valeur fournie ${n}.` },
    location: {
      path: opts.path ?? "api/src/db.ts",
      start_line: opts.start ?? 5,
      end_line: opts.end ?? 9,
    },
  },
  html_url: `${REPO_URL}/security/code-scanning/${n}`,
});

export const secretScanning = (
  n: number,
  opts: { state?: string; type?: string; display?: string | null } = {},
) => ({
  number: n,
  state: opts.state ?? "open",
  secret_type: opts.type ?? "github_personal_access_token",
  ...(opts.display === null
    ? {}
    : {
        secret_type_display_name:
          opts.display ?? "GitHub Personal Access Token",
      }),
  secret: SECRET,
  html_url: `${REPO_URL}/security/secret-scanning/${n}`,
});

/** A location of a secret, as `GET .../secret-scanning/alerts/{n}/locations` gives it. */
export const commitLocation = (
  path: string,
  start: number,
  end: number,
  commit: string,
) => ({
  type: "commit",
  details: {
    path,
    start_line: start,
    end_line: end,
    start_column: 1,
    end_column: 40,
    blob_sha: "b".repeat(40),
    commit_sha: commit,
  },
});
export const issueLocation = {
  type: "issue_title",
  details: { issue_title_url: `${REPO_URL}/issues/1` },
};

export type Refreshed = {
  tools: Record<"dependabot" | "code_scanning" | "secret_scanning", string>;
  created: number;
  updated: number;
  closed: number;
  access: null | { detail: string; url: string };
};

export const refresh = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId">,
  cookie = ctx.alice.cookie,
  id: number | string = ctx.projectId,
) => send(ctx.app, cookie, "POST", `/api/projects/${id}/findings/refresh`);

/** A refresh that must be served. */
export async function refreshed(ctx: Parameters<typeof refresh>[0]) {
  const res = await refresh(ctx);
  if (res.status !== 200)
    throw new Error(`refresh answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as Refreshed;
}

/** Alice's project with a repo that has a Git history, the three alert permissions, and the alerts `seed` puts in the stub. */
export async function withAlerts(
  seed: (
    alerts: ReturnType<Ctx["fetchMock"]["alerts"]>,
    ctx: Ctx,
  ) => void = () => {},
  github: Parameters<typeof ready>[2] = {},
) {
  const ctx = await ready(undefined, {}, github);
  seed(ctx.fetchMock.alerts("user1000/app"), ctx);
  return ctx;
}

const all = async <T>(db: TestDb, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

export type GitHubRow = {
  id: number;
  project_id: number;
  kind: string;
  source: string;
  title: string;
  body_md: string;
  severity: string;
  effort: string | null;
  status: string;
  ticket_id: number | null;
  commit_sha: string | null;
  github_alert_type: string | null;
  github_alert_number: number | null;
  github_closed_at: Date | null;
};
export const githubRows = (db: TestDb) =>
  all<GitHubRow>(
    db,
    sql`select id, project_id, kind, source, title, body_md, severity, effort, status, ticket_id, commit_sha, github_alert_type, github_alert_number, github_closed_at from findings order by id`,
  );

/** Everything Cockpit stores about findings and what was done to them, as one text, for « this never appears anywhere ». */
export async function stored(db: TestDb) {
  return JSON.stringify([
    await all(db, sql`select * from findings`),
    await all(db, sql`select * from code_sources`),
    await all(db, sql`select * from history`),
    await all(db, sql`select * from tickets`),
  ]);
}

/** The alert reads the server made, by tool and page. */
export const alertReads = (ctx: Pick<Ctx, "fetchMock">) =>
  githubCalls(ctx.fetchMock)
    .filter((c) =>
      /\/(dependabot|code-scanning|secret-scanning)\/alerts$/.test(c.path),
    )
    .map((c) => ({
      tool: /\/(dependabot|code-scanning|secret-scanning)\//.exec(
        c.path,
      )?.[1] as string,
      page: Number(new URLSearchParams(c.search).get("page") ?? 1),
      params: new URLSearchParams(c.search),
      authorization: c.authorization,
    }));
export const locationReads = (ctx: Pick<Ctx, "fetchMock">) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.endsWith("/locations"));

/** Dates a finding as closed on GitHub by hand (a refresh does it too, and these tests of the routes do not depend on it). */
export const markClosed = (db: TestDb, id: number) =>
  db.execute(
    sql`update findings set github_closed_at = now() where id = ${id}`,
  );

// The alerts as the WEBHOOKS send them, built from GitHub's own schema (node_modules/@octokit/openapi-webhooks-types/types.d.ts, v12.1.0), not from the REST list:
// - secret_scanning_alert: type "secret-scanning-alert-webhook": NO `state` field; open while `resolution` and `resolved_at` are null, closed once `resolution` is set
//   (a secret-scanning-alert-resolution-webhook: false_positive, wont_fix, revoked, used_in_tests, pattern_deleted, pattern_edited or null). It has no `secret` field in the schema.
// - code_scanning_alert: type "webhook-code-scanning-alert-created" (and its siblings): `alert.state` is "open" | "dismissed" | null (null for an alert outside the default branch),
//   `alert.tool` may be null, `alert.most_recent_instance` is optional and nullable, the rule has no `security_severity_level`.
// - dependabot_alert: type "dependabot-alert": state "auto_dismissed" | "dismissed" | "fixed" | "open", the advisory severity low | medium | high | critical; the REST fixture `dependabot()`
//   has the same fields for what Cockpit reads, so it is used as is for the webhooks of Dependabot.

export const webhookSecret = (
  n: number,
  opts: { resolution?: string | null; display?: string } = {},
) => ({
  number: n,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: null,
  url: `https://api.github.com/repos/user1000/app/secret-scanning/alerts/${n}`,
  html_url: `${REPO_URL}/security/secret-scanning/${n}`,
  locations_url: `https://api.github.com/repos/user1000/app/secret-scanning/alerts/${n}/locations`,
  resolution: opts.resolution ?? null,
  resolved_at: opts.resolution ? "2026-11-07T10:00:00Z" : null,
  resolved_by: null,
  resolution_comment: null,
  secret_type: "github_personal_access_token",
  secret_type_display_name: opts.display ?? "GitHub Personal Access Token",
  validity: "active",
  push_protection_bypassed: false,
  publicly_leaked: false,
  multi_repo: false,
});

export const webhookCodeScanning = (
  n: number,
  opts: {
    state?: "open" | "dismissed" | "fixed" | null;
    ref?: string;
    commit?: string;
    description?: string;
  } = {},
) => ({
  number: n,
  state: opts.state === undefined ? "open" : opts.state,
  created_at: "2026-11-01T10:00:00Z",
  dismissed_at: null,
  dismissed_by: null,
  dismissed_reason: null,
  html_url: `${REPO_URL}/security/code-scanning/${n}`,
  url: `https://api.github.com/repos/user1000/app/code-scanning/alerts/${n}`,
  rule: {
    id: "js/sql-injection",
    name: "SqlInjection",
    severity: "error",
    description:
      opts.description ?? `Requête SQL construite avec une entrée ${n}`,
  },
  tool: { name: "CodeQL", version: "2.15.0", guid: null },
  most_recent_instance: {
    analysis_key: ".github/workflows/codeql.yml:analyze",
    environment: "{}",
    ref: opts.ref ?? "refs/heads/main",
    commit_sha: opts.commit ?? "a".repeat(40),
    state: "open",
    message: { text: `Cette requête dépend d'une valeur fournie ${n}.` },
    location: { path: "api/src/db.ts", start_line: 5, end_line: 9 },
  },
});
