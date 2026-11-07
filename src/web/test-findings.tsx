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

export type FakeFinding = {
  id: number;
  kind: "bug" | "security" | "architecture" | "stack";
  source: "claude";
  title: string;
  bodyMd: string;
  severity: "critical" | "high" | "medium" | "low";
  effort: "small" | "medium" | "large" | null;
  status: "open" | "ticketed" | "dismissed" | "later";
  ticketId: number | null;
  dismissReason: string | null;
  commitSha: string;
  createdAt: string;
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
  sources: [{ path: HASHER, startLine: 22, endLine: 30, commitSha: SHA_API }],
  unprotected: false,
  ...over,
});

export type Sent = {
  method: string;
  path: string;
  search: string;
  body: unknown;
};

/** The fake server of the findings screen on top of the one of the Conception tab. `failNext` makes the next decision answer something else. */
export function stubFindings(
  initial: FakeFinding[],
  options: Parameters<typeof stubConception>[0] = {},
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
    codeReads: () =>
      calls.filter(
        (c) => c.method === "GET" && c.path === "/api/projects/5/code",
      ),
  };
}
