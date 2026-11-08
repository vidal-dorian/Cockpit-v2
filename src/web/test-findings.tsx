// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { vi } from "vitest";
import { SHA_API, stubConception } from "./test-conception.tsx";

// Shared by the web tests of slice R5 (decision 051, screen S44): the project 5 (octocat/hello) whose server answers the findings, the human decisions on them and the code
// of each source. The shapes are the ones pinned in src/server/findings-routes.test.ts:
// - GET  /api/projects/5/findings[?status=open|ticketed|dismissed|later] -> { findings: [{ id, kind, source, title, bodyMd, severity, effort, status, ticketId, dismissReason,
//     commitSha, createdAt, sources: [{ path, startLine, endLine, commitSha }], unprotected }] } (every status without a filter, the server sorts by severity then most recent;
//     this fake keeps the order of the list it was given, so a test that checks the sort of the screen hands the findings in another order).
// - POST /api/findings/:id/ticket -> { ticket: { id, title } } (the finding becomes ticketed);
//   POST /api/findings/:id/dismiss { reason? } -> { finding } (dismissed);  POST /api/findings/:id/later -> { finding } (later).
// - GET  /api/projects/5/code?sha=&path=&start=&end= -> { firstLine, lines }: the lines of the cited range and 3 around, each `<path>:<n>`.

// Slice R6 (decision 052 H; src/server/findings-github-routes.test.ts): a finding also carries githubAlertType, githubAlertNumber, githubClosedAt (ISO date or null) and githubUrl, null for a
// finding of Claude; commitSha is null for a Dependabot one; kind may be `upgrade`. POST /api/projects/5/findings/refresh answers what src/server/test-github-alerts.ts pins:
// { tools: { dependabot, code_scanning, secret_scanning }, created, updated, closed, access: null | { detail, url } }; `onRefresh` lets a test change the list the way a read of GitHub would.

export type FakeFinding = {
  id: number;
  kind: "bug" | "security" | "architecture" | "stack" | "upgrade";
  source: "claude" | "github";
  title: string;
  bodyMd: string;
  severity: "critical" | "high" | "medium" | "low";
  effort: "small" | "medium" | "large" | null;
  status: "open" | "ticketed" | "dismissed" | "later";
  ticketId: number | null;
  dismissReason: string | null;
  commitSha: string | null;
  createdAt: string;
  githubAlertType: "dependabot" | "code_scanning" | "secret_scanning" | null;
  githubAlertNumber: number | null;
  githubClosedAt: string | null;
  githubUrl: string | null;
  sources: {
    path: string;
    startLine: number;
    endLine: number;
    commitSha: string;
  }[];
  unprotected: boolean;
};

export const HASHER = "src/Security/Hasher.php";

export const finding = (
  id: number,
  over: Partial<FakeFinding> = {},
): FakeFinding => ({
  id,
  kind: "bug",
  source: "claude",
  title: `Constat numéro ${id}`,
  bodyMd: `Texte du constat ${id}.`,
  severity: "medium",
  effort: null,
  status: "open",
  ticketId: null,
  dismissReason: null,
  commitSha: SHA_API,
  createdAt: `2026-11-0${Math.min(id, 9)}T10:00:00.000Z`,
  githubAlertType: null,
  githubAlertNumber: null,
  githubClosedAt: null,
  githubUrl: null,
  sources: [{ path: HASHER, startLine: 22, endLine: 30, commitSha: SHA_API }],
  unprotected: false,
  ...over,
});

/** A finding of GitHub of the given tool: security, source github, no source line and no commit, the link of its alert. */
export const alert = (
  id: number,
  tool: NonNullable<FakeFinding["githubAlertType"]>,
  over: Partial<FakeFinding> = {},
): FakeFinding =>
  finding(id, {
    kind: "security",
    source: "github",
    commitSha: null,
    sources: [],
    githubAlertType: tool,
    githubAlertNumber: id,
    githubUrl: `https://github.com/octocat/hello/security/${tool.replace("_", "-")}/${id}`,
    ...over,
  });

export type Refreshed = {
  tools: Record<"dependabot" | "code_scanning" | "secret_scanning", string>;
  created: number;
  updated: number;
  closed: number;
  access: null | { detail: string; url: string };
};
export const REFRESHED: Refreshed = {
  tools: { dependabot: "ok", code_scanning: "ok", secret_scanning: "ok" },
  created: 0,
  updated: 0,
  closed: 0,
  access: null,
};

export type Sent = {
  method: string;
  path: string;
  search: string;
  body: unknown;
};

/** The fake server of the findings screen on top of the one of the Conception tab. `failNext` makes the next decision answer something else. */
export function stubFindings(
  initial: FakeFinding[],
  options: Parameters<typeof stubConception>[0] & {
    /** The answer of POST /api/projects/5/findings/refresh (default: 200 REFRESHED). */
    refresh?: { status: number; body: unknown };
    /** Runs when the refresh is served, to change the list as a read of GitHub would. */
    onRefresh?: (list: FakeFinding[]) => void;
  } = {},
) {
  const list = initial.map((f) => ({ ...f }));
  const api = stubConception({ ...options });
  const inner = globalThis.fetch;
  const calls: Sent[] = [];
  const failNext: { status?: number } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, "http://localhost");
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const text = typeof init?.body === "string" ? init.body : "";
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ method, path: url.pathname, search: url.search, body });
      if (url.pathname === "/api/projects/5/findings" && method === "GET") {
        const status = url.searchParams.get("status");
        return Response.json({
          findings: list.filter((f) => !status || f.status === status),
        });
      }
      if (
        url.pathname === "/api/projects/5/findings/refresh" &&
        method === "POST"
      ) {
        const answer = options.refresh ?? { status: 200, body: REFRESHED };
        if (answer.status === 200) options.onRefresh?.(list);
        return Response.json(answer.body, { status: answer.status });
      }
      if (url.pathname === "/api/projects/5/code" && method === "GET") {
        const path = url.searchParams.get("path") ?? "";
        const start = Number(url.searchParams.get("start"));
        const end = Number(url.searchParams.get("end"));
        const firstLine = Math.max(1, start - 3);
        return Response.json({
          firstLine,
          lines: Array.from(
            { length: end + 3 - firstLine + 1 },
            (_, i) => `${path}:${firstLine + i}`,
          ),
        });
      }
      const decision = /^\/api\/findings\/(\d+)\/(ticket|dismiss|later)$/.exec(
        url.pathname,
      );
      if (decision && method === "POST") {
        if (failNext.status) {
          const status = failNext.status;
          failNext.status = undefined;
          return Response.json({ error: "stub failure" }, { status });
        }
        const found = list.find((f) => String(f.id) === decision[1]);
        if (!found)
          return Response.json({ error: "Not found" }, { status: 404 });
        if (decision[2] === "ticket") {
          found.status = "ticketed";
          found.ticketId = 900 + found.id;
          return Response.json({
            ticket: { id: found.ticketId, title: found.title },
          });
        }
        if (decision[2] === "dismiss") {
          found.status = "dismissed";
          found.dismissReason =
            (body as { reason?: string } | undefined)?.reason || null;
        } else found.status = "later";
        return Response.json({ finding: { ...found } });
      }
      return inner(input, init);
    }),
  );
  return {
    ...api,
    calls,
    list,
    failNext,
    /** The decisions sent to the server, as `METHOD path`. */
    writes: () =>
      calls
        .filter((c) => c.method !== "GET" && c.path.startsWith("/api/findings"))
        .map((c) => `${c.method} ${c.path}`),
    /** The refreshes sent to the server. */
    refreshes: () =>
      calls.filter(
        (c) =>
          c.method === "POST" && c.path === "/api/projects/5/findings/refresh",
      ),
    codeReads: () =>
      calls.filter(
        (c) => c.method === "GET" && c.path === "/api/projects/5/code",
      ),
  };
}
