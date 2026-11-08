import { vi } from "vitest";
import { type RichTicket, stubTab } from "./test-tickets-full.tsx";

// Shared by the acceptance tests of slice 11.3 (decision 056, S27): the import screen over the fake of project 5 (octocat/hello).
//
// Pinned shapes (the decision leaves them open), the same as the server's (see src/server/test-issue-import.ts):
// - GET /api/projects/5/issues -> { issues: [{ number, title, state, kind, inCockpit }] }, or 502 { error: "github_unavailable" }.
// - POST /api/projects/5/issues/import { numbers } -> { tickets, stories, skipped } (counts), or the status and { error } the test gave.
// - A ticket carries `githubIssueNumber: number | null` (GET /api/projects/:id/tickets and GET /api/tickets/:id).

export type Issue = {
  number: number;
  title: string;
  state: "open" | "closed";
  kind: "story" | "ticket";
  inCockpit: { storyId: number } | { ticketId: number } | null;
};

export const issue = (
  number: number,
  title: string,
  extra: Partial<Issue> = {},
): Issue => ({
  number,
  title,
  state: "open",
  kind: "ticket",
  inCockpit: null,
  ...extra,
});

type Options = {
  /** Status of GET /api/projects/5/issues (default 200). */
  listStatus?: number;
  /** Status of POST /api/projects/5/issues/import (default 200). */
  importStatus?: number;
  /** The `error` code of a failed import (default github_unavailable). */
  importError?: string;
  /** Project 5 is archived: GET /api/projects says so. */
  archived?: boolean;
  tickets?: RichTicket[];
};

/** Serves the issues of project 5; an import turns the importable numbers it receives into issues already in Cockpit, as the real routes do. */
export function stubImport(initial: Issue[], options: Options = {}) {
  const api = stubTab(options.tickets ?? [], []);
  const inner = globalThis.fetch;
  let issues = initial.map((i) => ({ ...i }));
  const imports: { numbers: number[] }[] = [];
  const state = { lists: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (options.archived && path === "/api/projects" && method === "GET")
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
      if (path === "/api/projects/5/issues" && method === "GET") {
        state.lists++;
        if (options.listStatus && options.listStatus !== 200)
          return Response.json(
            { error: "github_unavailable" },
            { status: options.listStatus },
          );
        return Response.json({ issues });
      }
      if (path === "/api/projects/5/issues/import" && method === "POST") {
        const text =
          typeof init?.body === "string"
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : "";
        const sent = JSON.parse(text) as { numbers: number[] };
        imports.push(sent);
        if (options.importStatus && options.importStatus !== 200)
          return Response.json(
            { error: options.importError ?? "github_unavailable" },
            { status: options.importStatus },
          );
        const counts = { tickets: 0, stories: 0, skipped: 0 };
        issues = issues.map((i) => {
          if (!sent.numbers.includes(i.number)) return i;
          if (i.state !== "open" || i.inCockpit) {
            counts.skipped++;
            return i;
          }
          counts.tickets++;
          if (i.kind === "story") counts.stories++;
          return {
            ...i,
            inCockpit:
              i.kind === "story"
                ? { storyId: 900 + i.number }
                : { ticketId: 800 + i.number },
          };
        });
        return Response.json(counts);
      }
      return inner(input, init);
    }),
  );
  return { ...api, imports, state };
}
