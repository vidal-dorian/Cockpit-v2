// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "./App.tsx";

export type FakeTicket = {
  id: number;
  projectId: number;
  title: string;
  descriptionMd: string;
  /** The code of the server (decision 002): new, in_progress, to_validate, validated, done or abandoned. */
  step: string;
  /** ISO date when Claude closed the writing of the stories, null while it has not finished (decision 017 N). */
  storiesWrittenAt: string | null;
  /** ISO date when the user abandoned the ticket, null otherwise: the page decides its buttons on it, not on the step (decision 018 J). */
  abandonedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
/** A story as GET /api/stories/:id gives it (decision 017 L); the ticket page lists { id, position, iWant, status } of it. */
export type FakeStory = {
  id: number;
  ticketId: number;
  position: number;
  asA: string;
  iWant: string;
  soThat: string;
  notesMd: string;
  status: string;
  criteria: {
    id: number;
    position: number;
    given: string;
    when: string;
    then: string;
  }[];
  dependsOn: { id: number; iWant: string; status: string }[];
};
export type Answer = { status: number; body?: unknown };
export type Call = { method: string; path: string; body: unknown };

export const ticket = (
  id: number,
  title: string,
  descriptionMd = "",
  projectId = 5,
): FakeTicket => ({
  id,
  projectId,
  title,
  descriptionMd,
  step: "new",
  storiesWrittenAt: null,
  abandonedAt: null,
  createdAt: "2026-10-22T12:00:00.000Z",
  updatedAt: "2026-10-22T12:00:00.000Z",
});

export const story = (
  id: number,
  ticketId: number,
  iWant: string,
  overrides: Partial<FakeStory> = {},
): FakeStory => ({
  id,
  ticketId,
  position: 1,
  asA: "utilisatrice",
  iWant,
  soThat: "gagner du temps",
  notesMd: "",
  status: "to_validate",
  criteria: [
    {
      id: id * 10,
      position: 1,
      given: "un état",
      when: "une action",
      then: "un résultat",
    },
  ],
  dependsOn: [],
  ...overrides,
});

export const fail = (status: number, error: string): Answer => ({
  status,
  body: { error },
});

// The router lives inside App (browser router), so the tests set the URL like a browser would.
export function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

/**
 * A small fake server behind fetch: one project (id 5, octocat/hello) and its tickets (newest first).
 * Creating, editing and deleting change `tickets` like the real routes; `failNext` makes the next
 * write of that kind answer something else. Every request is recorded in `calls`.
 */
export function stubTicketApi(
  initial: FakeTicket[],
  stories: FakeStory[] = [],
) {
  const tickets = [...initial];
  const calls: Call[] = [];
  const failNext: { post?: Answer; patch?: Answer; delete?: Answer } = {};
  /** Set `status` (401, 500...) to make GET /api/projects/5/stories answer it, until it is set back to undefined. */
  const failStories: { status?: number } = {};
  let nextId = 100;
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
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
      const text =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ method, path, body });

      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
          ],
        });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: false,
          repositories: [],
        });
      if (path === "/api/projects/5/health")
        return Response.json({
          lines: ["claude_md", "ci", "mcp", "agents"].map((key) => ({
            key,
            ok: true,
            detail: "ok",
          })),
        });
      if (path === "/api/projects/5/tickets" && method === "GET")
        return Response.json({
          tickets: tickets.filter((t) => t.projectId === 5),
        });
      if (path === "/api/projects/5/tickets" && method === "POST") {
        const answer = failNext.post;
        failNext.post = undefined;
        if (answer)
          return Response.json(answer.body, { status: answer.status });
        const created = ticket(nextId++, body.title, body.descriptionMd ?? "");
        tickets.unshift(created);
        return Response.json({ ticket: created }, { status: 201 });
      }
      // Slice 4.5 (decision 019): the Kanban of the project, as the real route gives it (no abandoned story, ticket then position).
      if (path === "/api/projects/5/stories" && method === "GET") {
        if (failStories.status)
          return Response.json(
            { error: "stub failure" },
            { status: failStories.status },
          );
        return Response.json({
          stories: stories
            .filter((s) => s.status !== "abandoned")
            .flatMap((s) => {
              const parent = tickets.find(
                (t) => t.id === s.ticketId && t.projectId === 5,
              );
              return parent
                ? [
                    {
                      id: s.id,
                      ticketId: s.ticketId,
                      ticketTitle: parent.title,
                      position: s.position,
                      iWant: s.iWant,
                      status: s.status,
                    },
                  ]
                : [];
            })
            .sort((a, b) => a.ticketId - b.ticketId || a.position - b.position),
        });
      }
      const storyMatch = /^\/api\/stories\/([^/]+)$/.exec(path);
      if (storyMatch && method === "GET") {
        const found = stories.find((s) => String(s.id) === storyMatch[1]);
        const parent = tickets.find((t) => t.id === found?.ticketId);
        if (!found || !parent)
          return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json({
          story: found,
          ticket: { id: parent.id, title: parent.title },
          project: { id: 5, fullName: "octocat/hello" },
        });
      }
      const match = /^\/api\/tickets\/([^/]+)$/.exec(path);
      if (match) {
        const found = tickets.find((t) => String(t.id) === match[1]);
        if (!found)
          return Response.json({ error: "Not found" }, { status: 404 });
        if (method === "GET")
          return Response.json({
            ticket: found,
            stories: stories
              .filter((s) => s.ticketId === found.id)
              .map(({ id, position, iWant, status }) => ({
                id,
                position,
                iWant,
                status,
              })),
          });
        const key = method === "PATCH" ? "patch" : "delete";
        const answer = failNext[key];
        failNext[key] = undefined;
        if (answer)
          return Response.json(answer.body, { status: answer.status });
        if (method === "PATCH") {
          Object.assign(found, body);
          return Response.json({ ticket: found });
        }
        if (method === "DELETE") {
          tickets.splice(tickets.indexOf(found), 1);
          return new Response(null, { status: 204 });
        }
      }
      // Decision 022: the section « Écrire les US automatiquement » has its own tests (RoutineSettings.test.tsx): nothing connected here.
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      // Decision 022: the section « Écriture automatique des US » has its own tests (ProjectRoutine.test.tsx): off here.
      if (/^\/api\/projects\/[^/]+\/routine$/.test(path) && method === "GET")
        return Response.json({
          frequency: "off",
          hour: null,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
        });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    failNext,
    failStories,
    /** The writes the page sent (everything but GET). */
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}
