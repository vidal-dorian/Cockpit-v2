import type { CatalogState } from "./catalog-update.ts";
import type { RepoFiles } from "./github.ts";
import { WEBHOOK_PATH } from "./instance.ts";
import { parseTeam } from "./team.ts";

const DEFAULT_TEAM = ["test-writer", "developer", "reviewer"];

/** The fixed codes of decision 013; the page turns them into French. */
type HealthDetail =
  | "ok"
  | "missing"
  | "invalid_json"
  | "secret_in_clear"
  | "invalid_team"
  | "outdated"
  | "wrong_url"
  | "last_delivery_failed"
  | "app_missing_permissions"
  | "installation_not_approved"
  | "unknown";
export type HealthLine = {
  key:
    | "claude_md"
    | "ci"
    | "mcp"
    | "agents"
    | "catalog"
    | "webhook"
    | "github_alerts"
    | "updates";
  ok: boolean;
  detail: HealthDetail;
  /** The `github_alerts` line only (decision 052 B): where to give the permissions. */
  url?: string;
  /** The catalog line only (decision 049 E): the state of each file of the catalogue. */
  files?: { path: string; state: CatalogState }[];
};

const line = (key: HealthLine["key"], detail: HealthDetail): HealthLine => ({
  key,
  ok: detail === "ok",
  detail,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A header or env value may only point at environment variables: "${VAR}", after an optional "Bearer ".
const ONLY_REFERENCES = /^(Bearer )?(\$\{\w+\})+$/;

/** Decision 065 C: what stops `.mcp.json` from being written, or null. Every server is judged, not only Cockpit; `at` is the path of the first value that is not a reference, never the value. */
export function mcpRefusal(
  text: string,
): { error: "invalid_json" } | { error: "secret_in_clear"; at: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "invalid_json" };
  }
  if (!isObject(parsed)) return { error: "invalid_json" };
  // What is present but not an object cannot be judged, so it could hide a secret: refused, at its own path.
  const secret = (at: string) => ({ error: "secret_in_clear" as const, at });
  if (parsed.mcpServers === undefined) return null;
  if (!isObject(parsed.mcpServers)) return secret("mcpServers");
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    const at = `mcpServers.${name}`;
    if (!isObject(server)) return secret(at);
    const raw = typeof server.url === "string" ? server.url : "";
    const url = URL.parse(raw);
    // An address that does not parse is judged on its look: credentials before an @ (a "${MCP_URL}" has none).
    if (url ? url.username || url.password : /\/\/[^/]*@/.test(raw))
      return secret(`${at}.url`);
    for (const key of ["headers", "env"]) {
      const values = server[key];
      if (values === undefined) continue;
      if (!isObject(values)) return secret(`${at}.${key}`);
      for (const [field, value] of Object.entries(values))
        if (typeof value !== "string" || !ONLY_REFERENCES.test(value))
          return secret(`${at}.${key}.${field}`);
    }
  }
  return null;
}

function mcpDetail(mcpJson: string | null, publicUrl: string): HealthDetail {
  // Cockpit is a claude.ai connector (decision 021 H): not declaring it in .mcp.json is right, and only a declaration with a secret is wrong.
  if (mcpJson === null) return "ok";
  let parsed: unknown;
  try {
    parsed = JSON.parse(mcpJson);
  } catch {
    return "invalid_json";
  }
  if (!isObject(parsed) || !isObject(parsed.mcpServers)) return "ok";
  const cockpit = new URL(publicUrl);
  // Every entry that points at Cockpit is judged: one literal secret anywhere is red.
  const entries = Object.values(parsed.mcpServers).flatMap((server) => {
    if (!isObject(server) || typeof server.url !== "string") return [];
    const url = URL.parse(server.url);
    if (url?.origin !== cockpit.origin || url.pathname !== "/mcp") return [];
    // env is judged like headers: a literal token there sits in git even if unused.
    return [
      { url, values: { ...(server.headers ?? {}), ...(server.env ?? {}) } },
    ];
  });
  if (entries.length === 0) return "ok";
  const clean = entries.every(({ url, values }) => {
    // Cockpit's /mcp takes no query and no credentials: if there are some, they hold a secret.
    if (url.search || url.username || url.password) return false;
    return Object.values(values).every(
      (value) => typeof value === "string" && ONLY_REFERENCES.test(value),
    );
  });
  return clean ? "ok" : "secret_in_clear";
}

/** The four lines of the health check, in the order the page shows them (decision 013). */
export function healthLines(files: RepoFiles, publicUrl: string): HealthLine[] {
  return [
    line("claude_md", files.claudeMd ? "ok" : "missing"),
    line(
      "ci",
      files.workflows.some((n) => /\.ya?ml$/.test(n)) ? "ok" : "missing",
    ),
    line("mcp", mcpDetail(files.mcpJson, publicUrl)),
    line("agents", agentsDetail(files)),
  ];
}

// Decision 029 E: the agents wanted are the project's own team, or the three default ones.
function agentsDetail(files: RepoFiles): HealthDetail {
  if (!files.devUsSkill.includes("SKILL.md")) return "missing";
  // Decision 032 C: every named team is judged like team.md; an unreadable one first, then a missing agent.
  const teams = [
    files.teamMd === null ? DEFAULT_TEAM : parseTeam(files.teamMd),
    ...files.teams.map(parseTeam),
  ];
  if (teams.includes(null)) return "invalid_team";
  return teams.every((team) =>
    team?.every((name) => files.agents.includes(`${name}.md`)),
  )
    ? "ok"
    : "missing";
}

/** The line of the catalogue files (decision 049 E): red when a file has a new version or is missing; a hand-modified one does not count. */
export const catalogLine = (
  files: NonNullable<HealthLine["files"]>,
): HealthLine => ({
  ...line(
    "catalog",
    files.some((f) => f.state === "old" || f.state === "absent")
      ? "outdated"
      : "ok",
  ),
  files,
});

/** The fifth line (decision 024 F): the webhook reads are the App's, the same for every project; null when GitHub could not be asked. */
export function webhookLine(
  hook: { url: string; active?: boolean; lastStatus: number | null } | null,
  publicUrl: string,
): HealthLine {
  if (!hook) return line("webhook", "unknown");
  if (hook.url !== `${publicUrl}${WEBHOOK_PATH}` || hook.active === false)
    return line("webhook", "wrong_url");
  const { lastStatus } = hook;
  return line(
    "webhook",
    lastStatus === null || (lastStatus >= 200 && lastStatus < 300)
      ? "ok"
      : "last_delivery_failed",
  );
}

/** The permissions of decision 052 A, by tool of the alerts. */
export const ALERT_PERMISSIONS = {
  dependabot: "dependabot_alerts",
  code_scanning: "security_events",
  secret_scanning: "secret_scanning_alerts",
} as const;
const ALERT_EVENTS = [
  "dependabot_alert",
  "code_scanning_alert",
  "secret_scanning_alert",
];
const grants = (permissions: Record<string, string>, name: string) =>
  permissions[name] === "read" || permissions[name] === "write";
/** Whether the permissions hold the three of the alerts. */
const hasAlertPermissions = (permissions: Record<string, string>) =>
  Object.values(ALERT_PERMISSIONS).every((name) => grants(permissions, name));

/** What is missing to read the alerts (decision 052 B): the App is blamed first, then the installation that has not approved yet. Null when the installation has the three. */
export function alertsAccess(
  access: {
    app: Record<string, string>;
    /** The webhook events the App listens to. */
    appEvents: string[];
    installation: Record<string, string>;
    installationUrl: string;
  },
  appSettingsUrl: string,
) {
  if (
    !hasAlertPermissions(access.app) ||
    !ALERT_EVENTS.every((event) => access.appEvents.includes(event))
  )
    return {
      detail: "app_missing_permissions" as const,
      url: `${appSettingsUrl}/permissions`,
    };
  if (!hasAlertPermissions(access.installation))
    return {
      detail: "installation_not_approved" as const,
      url: access.installationUrl,
    };
  return null;
}

/** The tools whose permission the installation has (decision 052 C). */
export const toolGranted = (
  installation: Record<string, string>,
  tool: keyof typeof ALERT_PERMISSIONS,
) => grants(installation, ALERT_PERMISSIONS[tool]);

/** The sixth line (decision 052 B); null when GitHub could not be asked. */
export function alertsLine(
  access: Parameters<typeof alertsAccess>[0] | null,
  appSettingsUrl: string,
): HealthLine {
  if (!access) return line("github_alerts", "unknown");
  const missing = alertsAccess(access, appSettingsUrl);
  return missing
    ? { ...line("github_alerts", missing.detail), url: missing.url }
    : line("github_alerts", "ok");
}

const RENOVATE_ROOT = [
  "renovate.json",
  "renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
];
/** The seventh line (decision 052 L): Dependabot or Renovate is configured. */
export const updatesLine = (files: RepoFiles): HealthLine =>
  line(
    "updates",
    files.githubFiles.some((n) =>
      [
        "dependabot.yml",
        "dependabot.yaml",
        "renovate.json",
        "renovate.json5",
      ].includes(n),
    ) || files.rootFiles.some((n) => RENOVATE_ROOT.includes(n))
      ? "ok"
      : "missing",
  );
