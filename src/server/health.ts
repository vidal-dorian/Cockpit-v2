import type { RepoFiles } from "./github.ts";
import { WEBHOOK_PATH } from "./instance.ts";

/** The fixed codes of decision 013; the page turns them into French. */
export type HealthDetail =
  | "ok"
  | "missing"
  | "invalid_json"
  | "secret_in_clear"
  | "wrong_url"
  | "last_delivery_failed"
  | "unknown";
export type HealthLine = {
  key: "claude_md" | "ci" | "mcp" | "agents" | "webhook";
  ok: boolean;
  detail: HealthDetail;
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
  const hasAll = (names: string[], wanted: string[]) =>
    wanted.every((name) => names.includes(name));
  return [
    line("claude_md", files.claudeMd ? "ok" : "missing"),
    line(
      "ci",
      files.workflows.some((n) => /\.ya?ml$/.test(n)) ? "ok" : "missing",
    ),
    line("mcp", mcpDetail(files.mcpJson, publicUrl)),
    line(
      "agents",
      hasAll(files.agents, ["test-writer.md", "developer.md", "reviewer.md"]) &&
        files.devUsSkill.includes("SKILL.md")
        ? "ok"
        : "missing",
    ),
  ];
}

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
