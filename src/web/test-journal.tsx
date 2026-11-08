import { vi } from "vitest";

// Shared by the acceptance tests of slice 11.1 (decision 053): JournalFilters, JournalPanel, ProjectHistory.
//
// The fake server answers what the shell and the project page read, and GET /api/history through `history(params)`;
// every request of the journal is recorded as its URLSearchParams in `requests`. Two projects: 5 (octocat/hello) and 6 (octocat/api-facturation).

export type FakeEntry = {
  id: number;
  at: string;
  actor: string;
  origin: string;
  action: string;
  result: string;
  project: string | null;
  projectId: number | null;
  ticketId: number | null;
  storyId: number | null;
  runId: number | null;
  args: Record<string, unknown>;
  detail: Record<string, string> | null;
  retry?: { id: number; at: string; result: string } | null;
};

export const entry = (
  id: number,
  over: Partial<FakeEntry> = {},
): FakeEntry => ({
  id,
  // Newest first by id when ids go down: one minute apart.
  at: new Date(Date.UTC(2026, 10, 11, 12, id)).toISOString(),
  actor: "human",
  origin: "ui",
  action: "login",
  result: "ok",
  project: null,
  projectId: null,
  ticketId: null,
  storyId: null,
  runId: null,
  args: {},
  detail: null,
  ...over,
  ...(over.result && over.result !== "ok" && !("retry" in over)
    ? { retry: null }
    : {}),
});

type Answer = Response | { entries: FakeEntry[]; hasMore?: boolean };

export function stubJournal(
  history: (params: URLSearchParams) => Answer = () => ({ entries: [] }),
) {
  const requests: URLSearchParams[] = [];
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, "http://localhost");
      paths.push(url.pathname);
      if (url.pathname === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (url.pathname === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (url.pathname === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (url.pathname === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (url.pathname === "/api/home")
        return Response.json({
          forYou: [],
          claudeWorks: [],
          projects: [
            { id: 5, name: "octocat/hello", state: "idle" },
            { id: 6, name: "octocat/api-facturation", state: "idle" },
          ],
        });
      if (url.pathname === "/api/projects")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
            {
              id: 6,
              fullName: "octocat/api-facturation",
              defaultBranch: "main",
              archived: false,
            },
          ],
        });
      if (/^\/api\/projects\/\d+\/health$/.test(url.pathname))
        return Response.json({
          lines: ["claude_md", "ci", "mcp", "agents"].map((key) => ({
            key,
            ok: true,
            detail: "ok",
          })),
        });
      if (url.pathname === "/api/history") {
        requests.push(url.searchParams);
        const answer = history(url.searchParams);
        return answer instanceof Response
          ? answer
          : Response.json({ hasMore: false, ...answer });
      }
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
  return { requests, paths };
}

/** The pinned clock of the period tests: Wednesday 2026-11-11 15:30 in the local time of the machine. */
export const NOW = new Date(2026, 10, 11, 15, 30, 0);

/** The classes that paint something red or « you »-coloured (decision 045 C, 053 J): destructive, red, rose and the `you` tokens. */
export function redClasses(root: Element) {
  const found: string[] = [];
  for (const el of [root, ...root.querySelectorAll("*")])
    for (const token of el.classList) {
      const name = token.split(":").pop() ?? token;
      if (/(?:^|-)(?:destructive|red|rose|you)(?:-|$)/.test(name))
        found.push(token);
    }
  return found;
}
