import { vi } from "vitest";
import { stubProjectShell, stubShell } from "./test-shell.tsx";
import { type FakeTicket, ticket } from "./test-tickets.tsx";

// Shared by the acceptance tests of slice 11.2 (decision 054): tickets with a priority and tags, the search route,
// the routine of the project and the tickets of other projects, laid over the existing fakes (stubProjectShell, stubShell).

export type Priority = "low" | "normal" | "high";
export type RichTicket = FakeTicket & { priority: Priority; tags: string[] };

const MINUTE = 60_000;
export const ago = {
  minutes: (n: number) => new Date(Date.now() - n * MINUTE).toISOString(),
  days: (n: number) =>
    new Date(Date.now() - n * 24 * 60 * MINUTE).toISOString(),
};

/** A ticket of project 5 (or `projectId`) as GET /api/projects/:id/tickets gives it after 054: with `priority` and `tags`. */
export const rich = (
  id: number,
  title: string,
  extra: Partial<RichTicket> = {},
): RichTicket => ({
  ...ticket(id, title, "", extra.projectId ?? 5),
  priority: "normal",
  tags: [],
  ...extra,
});

export const projects = [
  { id: 5, name: "octocat/hello", state: "idle" },
  { id: 8, name: "octocat/world", state: "idle" },
];

export type SearchAnswer = {
  tickets: { id: number; title: string; step: string }[];
  stories: { id: number; ticketId: number; title: string; status: string }[];
};

type Options = {
  /** What /api/projects/5/routine says; default: off. */
  schedule?: { frequency: string; hour: number | null };
  /** Whether GET /api/me/routine says a routine exists (022); default: no. */
  routineConnected?: boolean;
  /** GET /api/projects/:id/tickets for the projects named here (the suggestions of tags read them); project 8 answers an empty list by default. */
  ticketsOf?: Record<number, RichTicket[]>;
  /** The answer of GET /api/projects/5/search?q=. */
  search?: (q: string) => SearchAnswer;
};

/** Lays what 054 adds over the current fetch fake. Returns the searches asked and the runs fired. */
export function layer(options: Options = {}) {
  const inner = globalThis.fetch;
  const searches: string[] = [];
  /** The projects whose « Écrire les US maintenant » was fired. */
  const runs: string[] = [];
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
      const url = new URL(raw, "http://localhost");
      const path = url.pathname;
      if (path === "/api/projects/5/search" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        searches.push(q);
        return Response.json(
          options.search?.(q) ?? { tickets: [], stories: [] },
        );
      }
      const listed = /^\/api\/projects\/(\d+)\/tickets$/.exec(path);
      if (listed && method === "GET") {
        const known = options.ticketsOf?.[Number(listed[1])];
        if (known || listed[1] === "8")
          return Response.json({ tickets: known ?? [] });
      }
      if (path === "/api/projects/5/routine" && method === "GET") {
        const schedule = options.schedule ?? { frequency: "off", hour: null };
        return Response.json({
          ...schedule,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
        });
      }
      const run = /^\/api\/projects\/(\d+)\/routine\/run$/.exec(path);
      if (run && method === "POST") {
        runs.push(run[1] ?? "");
        return Response.json({ ok: true });
      }
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          connected: options.routineConnected ?? false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      return inner(input, init);
    }),
  );
  return { searches, runs };
}

/** The project 5 pages (tickets, stories) with the shell, plus 054's additions. */
export function stubTab(
  tickets: RichTicket[],
  stories: Parameters<typeof stubProjectShell>[2] = [],
  options: Options = {},
) {
  const api = stubProjectShell({ projects }, tickets, stories);
  return { ...api, ...layer(options) };
}

/** The shell alone (the idea bar on the home page, POST recorded in `sent`), plus 054's additions. */
export function stubBar(
  options: Options & { ticketStatus?: number } = {},
  homeProjects = projects,
) {
  const api = stubShell(
    { projects: homeProjects },
    { ticketStatus: options.ticketStatus },
  );
  return {
    ...api,
    ...layer({ ...options, ticketsOf: { 5: [], 8: [], ...options.ticketsOf } }),
  };
}
