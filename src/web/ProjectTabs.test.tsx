// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 028 G: the page of a project in five tabs.
//
// Pinned choices (the decision leaves them open):
// - The tabs are links inside <nav aria-label="Sections du projet">: « Kanban » (/projets/:id), « Tickets » (/projets/:id/tickets),
//   « Santé » (/projets/:id/sante) « Réglages » (/projets/:id/reglages, slice 9.3: the old « Écriture des US », whose address redirects) and « Agents » before it; the open one has aria-current="page", the others none.
//   The Santé link reads « Santé · N à corriger » when the health has N red lines, « Santé » when all are green (or not read yet).
// - A section is told by its h2: « Kanban », « Tickets », « Bilan de santé », « Écriture automatique des US ».
// - The health is requested whatever the tab, once.

type Line = { key: string; ok: boolean; detail: string };

const GREEN: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];
const TWO_RED: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: false, detail: "missing" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: false, detail: "missing" },
];

function renderAt(path: string) {
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

/** One project (id 5); any other id answers 404 on its health like the real route. */
function stubApi(lines: Line[] = GREEN) {
  const calls: string[] = [];
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
      calls.push(`${method} ${path}`);
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/projects")
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
      const health = /^\/api\/projects\/([^/]+)\/health$/.exec(path);
      if (health)
        return health[1] === "5"
          ? Response.json({ lines })
          : Response.json({ error: "Not found" }, { status: 404 });
      if (/^\/api\/projects\/[^/]+\/stories$/.test(path))
        return Response.json({ stories: [] });
      if (/^\/api\/projects\/[^/]+\/tickets$/.test(path))
        return Response.json({ tickets: [] });
      if (/^\/api\/projects\/[^/]+\/routine$/.test(path))
        return Response.json({
          frequency: "off",
          hour: null,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const NAMES = ["Kanban", "Tickets", "Santé", "Réglages"] as const;
const SECTIONS = {
  Kanban: "Kanban",
  Tickets: "Tickets",
  Santé: "Bilan de santé",
  Réglages: "Écriture automatique des US",
} as const;
const ROUTES: [(typeof NAMES)[number], string][] = [
  ["Kanban", "/projets/5"],
  ["Tickets", "/projets/5/tickets"],
  ["Santé", "/projets/5/sante"],
  ["Réglages", "/projets/5/reglages"],
];
const HREF: Record<string, string> = Object.fromEntries(ROUTES);

const heading = (name: string) =>
  screen.queryByRole("heading", { level: 2, name });

/** The tab links of the project, whatever their exact name beyond the first word. */
async function tabs() {
  const nav = await screen.findByRole("navigation", {
    name: "Sections du projet",
  });
  const links = within(nav).getAllByRole("link");
  const find = (name: string) =>
    links.find(
      (l) =>
        l.textContent?.trim() === name ||
        (name === "Santé" &&
          /^Santé( · \d+ à corriger)?$/.test(l.textContent?.trim() ?? "")),
    );
  return { nav, links, find };
}

describe("Project page, the tabs (decision 028 G)", () => {
  it("given a project, when /projets/:id opens, then the five tabs are links to their routes, Kanban is open and only the Kanban section is shown", async () => {
    stubApi();

    renderAt("/projets/5");

    const { links, find } = await tabs();
    expect(links).toHaveLength(5);
    expect(links[3]?.textContent?.trim()).toBe("Agents");
    for (const name of NAMES) {
      const link = find(name);
      expect(link, `the tab ${name}`).toBeDefined();
      expect(link?.getAttribute("href")).toBe(HREF[name]);
      expect(link?.getAttribute("aria-current")).toBe(
        name === "Kanban" ? "page" : null,
      );
    }
    expect(
      await screen.findByRole("heading", { level: 2, name: "Kanban" }),
    ).toBeDefined();
    expect(heading("Bilan de santé")).toBeNull();
    expect(heading("Tickets")).toBeNull();
    expect(heading("Écriture automatique des US")).toBeNull();
  });

  it.each(ROUTES.slice(1))(
    "given a project, when the tab %s opens at %s, then only its section is shown and its tab is marked open",
    async (tab, path) => {
      stubApi();

      renderAt(path);

      const { find } = await tabs();
      expect(
        await screen.findByRole("heading", { level: 2, name: SECTIONS[tab] }),
      ).toBeDefined();
      for (const other of NAMES) {
        if (other !== tab)
          expect(heading(SECTIONS[other]), `${other} hidden`).toBeNull();
        expect(find(other)?.getAttribute("aria-current")).toBe(
          other === tab ? "page" : null,
        );
      }
    },
  );

  it("given the Kanban tab, when the tab Tickets is clicked, then the route changes, the Tickets section replaces the Kanban and the tab is marked open", async () => {
    stubApi();
    renderAt("/projets/5");
    const { find } = await tabs();
    await screen.findByRole("heading", { level: 2, name: "Kanban" });

    fireEvent.click(find("Tickets") as HTMLElement);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Tickets" }),
    ).toBeDefined();
    expect(window.location.pathname).toBe("/projets/5/tickets");
    expect(heading("Kanban")).toBeNull();
    expect(find("Tickets")?.getAttribute("aria-current")).toBe("page");
  });

  it("given a project, when a tab opens, then the page has the breadcrumb link to /projets and the full name as title", async () => {
    stubApi();

    renderAt("/projets/5/sante");

    expect(
      await screen.findByRole("heading", { level: 1, name: "octocat/hello" }),
    ).toBeDefined();
    const link = within(screen.getByRole("main")).getByRole("link", {
      name: /projets/i,
    });
    expect(link.getAttribute("href")).toBe("/projets");
  });
});

describe("Project page, the mark of the Santé tab (decision 028 G)", () => {
  it.each(ROUTES)(
    "given a health with two red lines, when the tab %s is open at %s, then the Santé tab reads « Santé · 2 à corriger »",
    async (_tab, path) => {
      const calls = stubApi(TWO_RED);

      renderAt(path);

      const { find } = await tabs();
      await waitFor(() =>
        expect(find("Santé")?.textContent?.trim()).toBe("Santé · 2 à corriger"),
      );
      expect(
        calls.filter((c) => c === "GET /api/projects/5/health"),
      ).toHaveLength(1);
    },
  );

  it.each(ROUTES)(
    "given a green health, when the tab %s is open at %s, then the Santé tab reads only « Santé »",
    async (_tab, path) => {
      const calls = stubApi(GREEN);

      renderAt(path);

      const { find } = await tabs();
      await waitFor(() =>
        expect(calls).toContain("GET /api/projects/5/health"),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(find("Santé")?.textContent?.trim()).toBe("Santé");
    },
  );
});

describe("Project page, an unknown project (decision 028 G)", () => {
  it.each([
    "/projets/999",
    "/projets/999/tickets",
    "/projets/999/sante",
    "/projets/999/reglages",
    "/projets/999/ecriture-us",
  ])(
    "given a project that does not exist, when %s opens, then the page says Projet introuvable and has no tabs",
    async (path) => {
      stubApi();

      renderAt(path);

      expect(await screen.findByText(/Projet introuvable/)).toBeDefined();
      expect(
        screen.queryByRole("navigation", { name: "Sections du projet" }),
      ).toBeNull();
      expect(heading("Kanban")).toBeNull();
      expect(heading("Tickets")).toBeNull();
      expect(heading("Bilan de santé")).toBeNull();
      expect(heading("Écriture automatique des US")).toBeNull();
    },
  );
});

describe("Project page, switching tabs (decision 028 G)", () => {
  it("given the tabs clicked one after the other, when the user goes Tickets, Santé, Réglages, Kanban, Santé, then the health is read exactly once", async () => {
    const calls = stubApi();
    renderAt("/projets/5");
    const { find } = await tabs();
    await screen.findByRole("heading", { level: 2, name: "Kanban" });

    for (const name of [
      "Tickets",
      "Santé",
      "Réglages",
      "Kanban",
      "Santé",
    ] as const) {
      fireEvent.click(find(name) as HTMLElement);
      await screen.findByRole("heading", { level: 2, name: SECTIONS[name] });
    }

    expect(
      calls.filter((c) => c === "GET /api/projects/5/health"),
    ).toHaveLength(1);
  });
});
