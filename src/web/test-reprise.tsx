// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { vi } from "vitest";
import { SHA_API, stubConception } from "./test-conception.tsx";

// Shared by the web tests of slice R2 (decision 047, screen S42): the project 5 (octocat/hello) whose server answers the rules, the human decisions on them
// and the code of each source. The shapes are the ones pinned in src/server/takeover-routes.test.ts:
// - GET  /api/projects/5/rules -> { rules: [{ id, storyId, ticketId, position, summary, reasoning, doubt, given, when, then, state: "pending" | "kept",
//     objects: [{ name, inMap }], sources: [{ path, startLine, endLine, commitSha }] }] }
// - POST /api/criteria/:id/keep | unkeep -> { rule }; PATCH /api/criteria/:id { summary, given, when, then } -> { rule };
//   POST /api/criteria/:id/bug -> { ticket: { id, title } } and the rule leaves the list (and the story when it was the last one: not modelled here).
// - GET  /api/projects/5/code?sha=&path=&start=&end= -> { firstLine, lines }: here the lines of the cited range and 3 around, each `<path>:<n>`.

export type FakeRule = {
  id: number;
  storyId: number;
  ticketId: number;
  position: number;
  summary: string;
  reasoning: string;
  doubt: string | null;
  given: string;
  when: string;
  then: string;
  state: "pending" | "kept";
  objects: { name: string; inMap: boolean }[];
  sources: {
    path: string;
    startLine: number;
    endLine: number;
    commitSha: string;
  }[];
};

export const FILE = "src/Service/FactureService.php";

export const rule = (id: number, over: Partial<FakeRule> = {}): FakeRule => ({
  id,
  storyId: 31,
  ticketId: 7,
  position: id,
  summary: `Règle numéro ${id}.`,
  reasoning: `Raisonnement de la règle ${id}.`,
  doubt: null,
  given: `un état ${id}`,
  when: `une action ${id}`,
  then: `un résultat ${id}`,
  state: "pending",
  objects: [],
  sources: [{ path: FILE, startLine: 40, endLine: 58, commitSha: SHA_API }],
  ...over,
});

/** `n` rules, the `kept` first ones validated. */
export const rules = (n: number, kept = 0) =>
  Array.from({ length: n }, (_, i) =>
    rule(i + 1, { state: i < kept ? "kept" : "pending" }),
  );

export type Sent = {
  method: string;
  path: string;
  search: string;
  body: unknown;
};

/** The fake server of the takeover screen on top of the one of the Conception tab (map, analyse window, prepare). `failNext` makes the next decision answer something else. */
export function stubReprise(
  initial: FakeRule[],
  options: Parameters<typeof stubConception>[0] = {},
) {
  const list = initial.map((r) => ({ ...r }));
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
      if (url.pathname === "/api/projects/5/rules" && method === "GET")
        return Response.json({ rules: list });
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
      const decision = /^\/api\/criteria\/(\d+)(\/[a-z]+)?$/.exec(url.pathname);
      if (decision) {
        if (failNext.status) {
          const status = failNext.status;
          failNext.status = undefined;
          return Response.json({ error: "stub failure" }, { status });
        }
        const at = list.findIndex((r) => String(r.id) === decision[1]);
        const found = list[at];
        if (!found)
          return Response.json({ error: "Not found" }, { status: 404 });
        const verb = decision[2];
        if (method === "POST" && verb === "/keep") found.state = "kept";
        if (method === "POST" && verb === "/unkeep") found.state = "pending";
        if (method === "PATCH" && !verb) Object.assign(found, body);
        if (method === "POST" && verb === "/bug") {
          list.splice(at, 1);
          return Response.json({
            ticket: { id: 900, title: `Bug : ${found.summary}` },
          });
        }
        return Response.json({ rule: { ...found } });
      }
      return inner(input, init);
    }),
  );
  return {
    ...api,
    calls,
    list,
    failNext,
    /** The writes sent to the server, as `METHOD path`. */
    writes: () =>
      calls
        .filter((c) => c.method !== "GET" && c.path.startsWith("/api/criteria"))
        .map((c) => `${c.method} ${c.path}`),
    codeReads: () =>
      calls.filter(
        (c) => c.method === "GET" && c.path === "/api/projects/5/code",
      ),
  };
}
