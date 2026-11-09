import { vi } from "vitest";

// Shared by the acceptance tests of slice 15.3 (decision 073). It wraps the fetch fake already stubbed (stubShell, stubDecisionApi...) with what the slice adds:
// - GET /api/search?q= answers `state.search` ({ stories, tickets, runs, projects }, every group always there) whatever the query; the filters are the window's (no parameter);
// - GET /api/me adds `theme` ("dark" | "light" | "system"); PUT /api/me/theme { theme } answers { theme } and keeps it;
// - GET /api/projects answers `state.projects` when given ({ id, fullName, defaultBranch, archived, favorite }); PUT /api/projects/:id/favorite { favorite } answers { favorite };
// - GET /api/me/notifications answers the defaults (the tab Préférences reads it).

export type Call = { method: string; path: string; body: unknown; q?: string };
type Project = { id: number; fullName: string; favorite: boolean };

export const NO_RESULTS = { stories: [], tickets: [], runs: [], projects: [] };
/** What « lien expir » finds: two stories (#43, #45 of ticket 7), the ticket, a run of story 43 and the project, all of project 5. */
export const FOUND = {
  stories: [
    {
      id: 43,
      title: "Lien expiré ou déjà utilisé",
      projectId: 5,
      ticketId: 7,
      status: "to_validate",
    },
    {
      id: 45,
      title: "Renvoyer un lien expiré",
      projectId: 5,
      ticketId: 7,
      status: "ready",
    },
  ],
  tickets: [
    { id: 7, title: "Connexion sans mot de passe", projectId: 5, step: "new" },
  ],
  runs: [{ id: 17, storyId: 43, projectId: 5, status: "succeeded" }],
  projects: [{ id: 5, fullName: "octocat/hello" }],
};

export function addErgonomics(
  options: {
    search?: Record<string, unknown[]>;
    theme?: string;
    projects?: (Project & Record<string, unknown>)[];
    onFavorite?: (id: number, favorite: boolean) => void;
  } = {},
) {
  const inner = globalThis.fetch;
  const calls: Call[] = [];
  const state = {
    search: options.search ?? NO_RESULTS,
    theme: options.theme ?? "dark",
    projects: options.projects,
  };
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
      const path = url.pathname;
      const text =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      const body = text ? JSON.parse(text) : undefined;
      const favorite = /^\/api\/projects\/(\d+)\/favorite$/.exec(path);
      const mine =
        path === "/api/search" ||
        path === "/api/me/theme" ||
        path === "/api/me/notifications" ||
        favorite ||
        (path === "/api/me" && method === "GET") ||
        (path === "/api/projects" && method === "GET" && state.projects);
      if (!mine) return inner(input, init);
      calls.push({
        method,
        path,
        body,
        q: url.searchParams.get("q") ?? undefined,
      });
      if (path === "/api/search") return Response.json(state.search);
      if (path === "/api/me")
        return Response.json({
          login: "octocat",
          name: null,
          avatarUrl: null,
          isAdmin: false,
          theme: state.theme,
        });
      if (path === "/api/me/theme") {
        state.theme = body.theme;
        return Response.json({ theme: body.theme });
      }
      if (path === "/api/me/notifications")
        return Response.json({
          question: true,
          runFailed: true,
          prReady: true,
          nightRecap: true,
          quietStartHour: 22,
          quietEndHour: 7,
        });
      if (favorite) {
        const id = Number(favorite[1]);
        for (const p of state.projects ?? [])
          if (p.id === id) p.favorite = body.favorite;
        options.onFavorite?.(id, body.favorite);
        return Response.json({ favorite: body.favorite });
      }
      return Response.json({ projects: state.projects });
    }),
  );
  return { calls, state };
}
