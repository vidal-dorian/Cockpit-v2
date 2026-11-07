import { vi } from "vitest";
import { stubProjectShell } from "./test-shell.tsx";
import { ticket } from "./test-tickets.tsx";

// Shared by the tests of slice R1 (decision 043, screen S41): a project 5 (octocat/hello) whose server answers the map, the code of an object and the plan of « Préparer pour Claude ».

export const SHA_API = `a1b2c3d${"0".repeat(33)}`;
export const SHA_WEB = "b".repeat(40);

const fields = [
  { name: "id", type: "uuid" },
  { name: "email", type: "text" },
  ...Array.from({ length: 8 }, (_, i) => ({
    name: `col${i + 3}`,
    type: "text",
  })),
];

/** The modules as GET /api/projects/5/code-map gives them (src/server/code-map-routes.test.ts), ordered by path. */
export const API_MODULE = {
  path: "api",
  name: "Serveur",
  kind: "api",
  commitSha: SHA_API,
  createdAt: "2026-11-05T10:00:00.000Z",
  commitsSince: 12 as number | null,
  data: {
    manifest: "api/package.json",
    runtimes: [
      {
        name: "node",
        version: "20",
        citation: { path: "api/package.json", start_line: 2, end_line: 2 },
      },
      {
        name: "hono",
        version: "4.6",
        citation: { path: "api/package.json", start_line: 3, end_line: 3 },
      },
    ],
    objects: [
      {
        name: "User",
        kind: "table",
        fields,
        citation: { path: "api/src/db.ts", start_line: 18, end_line: 24 },
      },
      {
        name: "Order",
        kind: "table",
        fields: [{ name: "total", type: "integer" }],
        citation: { path: "api/src/db.ts", start_line: 5, end_line: 9 },
      },
      {
        name: "Invoice",
        kind: "type",
        fields: [],
        citation: { path: "api/src/db.ts", start_line: 1, end_line: 2 },
      },
    ],
    links: [
      { from: "Order", to: "User", kind: "references", cardinality: "0..1" },
      { from: "Invoice", to: "Order", kind: "contains" },
    ],
  },
};
export const WEB_MODULE = {
  path: "web",
  name: "Application",
  kind: "web",
  commitSha: SHA_WEB,
  createdAt: "2026-11-05T10:00:00.000Z",
  commitsSince: 1 as number | null,
  data: {
    manifest: "web/package.json",
    runtimes: [
      {
        name: "node",
        version: "20",
        citation: { path: "web/package.json", start_line: 2, end_line: 2 },
      },
      {
        name: "react",
        version: "18.3",
        citation: { path: "web/package.json", start_line: 3, end_line: 3 },
      },
    ],
    objects: [
      {
        name: "Session",
        kind: "type",
        fields: [{ name: "token", type: "string" }],
        citation: { path: "web/src/types.ts", start_line: 3, end_line: 5 },
      },
    ],
    links: [],
  },
};

export type Call = {
  method: string;
  path: string;
  search: string;
  body: unknown;
};
type Answer = { status: number; body: unknown };

export const SKILL = ".claude/skills/analyser/SKILL.md";
export const AGENT = ".claude/agents/cartographer.md";
export const WRITE_US = ".claude/skills/write-us/SKILL.md";
export const COMMIT = "c".repeat(40);

export type PlanFile = {
  path: string;
  content: string;
  status: string;
  current?: string;
};
export const plan = (analyser: PlanFile[]) => ({
  baseSha: "d".repeat(40),
  signature: "signed-by-the-server",
  files: [{ path: WRITE_US, content: "write-us", status: "same" }, ...analyser],
});

export type Options = {
  modules?: (typeof API_MODULE | typeof WEB_MODULE)[];
  archived?: boolean;
  /** The answer of GET /api/projects/5/code (default: lines 15 to 27 of the file, `CODE-LINE-<n>`). */
  code?: Answer;
  /** The answer of POST /api/projects/5/prepare (default: a repo that has neither the skill nor the agent). */
  prepare?: Answer;
  apply?: Answer;
};

/** The fake server of the Conception tab; every request is recorded in `calls`. */
export function stubConception(options: Options = {}) {
  stubProjectShell({}, [ticket(7, "Idée")]);
  const inner = globalThis.fetch;
  const calls: Call[] = [];
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
      calls.push({
        method,
        path: url.pathname,
        search: url.search,
        body: text ? JSON.parse(text) : undefined,
      });
      const reply = (answer: Answer) =>
        Response.json(answer.body, { status: answer.status });
      if (
        url.pathname === "/api/projects" &&
        method === "GET" &&
        options.archived
      )
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: true,
            },
          ],
        });
      if (url.pathname === "/api/projects/5/code-map")
        return Response.json({ modules: options.modules ?? [] });
      if (url.pathname === "/api/projects/5/code")
        return reply(
          options.code ?? {
            status: 200,
            body: {
              firstLine: 15,
              lines: Array.from(
                { length: 13 },
                (_, i) => `CODE-LINE-${15 + i}`,
              ),
            },
          },
        );
      if (url.pathname === "/api/projects/5/prepare" && method === "POST")
        return reply(
          options.prepare ?? {
            status: 200,
            body: {
              plan: plan([
                { path: SKILL, content: "TEXTE-DU-SKILL", status: "create" },
                { path: AGENT, content: "TEXTE-DE-L-AGENT", status: "create" },
              ]),
            },
          },
        );
      if (url.pathname === "/api/projects/5/prepare/apply" && method === "POST")
        return reply(
          options.apply ?? {
            status: 200,
            body: { commitSha: COMMIT, created: [SKILL, AGENT] },
          },
        );
      return inner(input, init);
    }),
  );
  return {
    calls,
    paths: () => calls.map((c) => `${c.method} ${c.path}`),
    posts: (path: string) =>
      calls.filter((c) => c.method === "POST" && c.path === path),
  };
}
