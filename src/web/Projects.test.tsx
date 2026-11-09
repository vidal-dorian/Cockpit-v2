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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

const INSTALL_URL = "https://github.com/apps/cockpit-test/installations/new";
const ALREADY_TRACKED = "Ce repo est déjà suivi dans Cockpit";

type Project = {
  id: number;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
};
type Repo = {
  githubRepoId: number;
  fullName: string;
  defaultBranch: string;
  imported: boolean;
};
type State = {
  projects: Project[];
  installed: boolean;
  repositories: Repo[];
  unauthorized?: boolean;
  // The state of each project, as /api/home gives it (the other tests leave the home unanswered).
  homeProjects?: { id: number; name: string; state: string }[];
  importAnswer?: Response;
};

const project = (id: number, fullName: string, archived = false): Project => ({
  id,
  fullName,
  defaultBranch: "main",
  archived,
});
const repo = (
  githubRepoId: number,
  fullName: string,
  imported = false,
): Repo => ({
  githubRepoId,
  fullName,
  defaultBranch: "main",
  imported,
});

// The router lives inside App (browser router), so the tests set the URL like a browser would.
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

type Call = { method: string; path: string; body: string };

/** A small fake server behind fetch: it answers like the real routes and keeps its state, so a refetch shows the change. */
function stubApi(state: State) {
  const calls: Call[] = [];
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
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({ method, path, body });

      const unauthorized = () =>
        Response.json({ error: "Unauthorized" }, { status: 401 });
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/home" && state.homeProjects)
        return Response.json({
          forYou: [],
          claudeWorks: [],
          projects: state.homeProjects,
        });
      if (path === "/api/projects" && method === "GET")
        return state.unauthorized
          ? unauthorized()
          : Response.json({ projects: state.projects });
      if (path === "/api/github/repositories" && method === "GET")
        return state.unauthorized
          ? unauthorized()
          : Response.json({
              installUrl: INSTALL_URL,
              installed: state.installed,
              repositories: state.repositories,
            });
      if (path === "/api/projects" && method === "POST") {
        if (state.importAnswer) return state.importAnswer;
        const { githubRepoId } = JSON.parse(body) as { githubRepoId: number };
        const found = state.repositories.find(
          (r) => r.githubRepoId === githubRepoId,
        );
        if (!found)
          return Response.json({ error: "Not found" }, { status: 404 });
        found.imported = true;
        const created = project(100 + githubRepoId, found.fullName);
        state.projects.push(created);
        return Response.json({ project: created }, { status: 201 });
      }
      const archiveMatch = /^\/api\/projects\/(\d+)\/archive$/.exec(path);
      if (archiveMatch && method === "POST") {
        const target = state.projects.find(
          (p) => p.id === Number(archiveMatch[1]),
        );
        if (!target)
          return Response.json({ error: "Not found" }, { status: 404 });
        target.archived = true;
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const listCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === "GET" && c.path === "/api/projects").length;

/** The list item (or table row) that holds a given text. */
const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};

// jsdom has no showModal on <dialog> (the import dialog of decision 072): a stub, removed after each test.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
});

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("navigation", () => {
  it("given the home page, when it loads, then the sidebar links to /projets", async () => {
    stubApi({ projects: [], installed: false, repositories: [] });

    renderAt("/");

    const link = await screen.findByRole("link", {
      name: /^Tous les projets/,
    });
    expect(link.getAttribute("href")).toBe("/projets");
  });
});

describe("Projets page, the list", () => {
  it("given an active and an archived project, when /projets loads, then both are listed with their full name, the archived one reads Archivé and has no Archiver button", async () => {
    stubApi({
      projects: [project(1, "octocat/hello"), project(2, "octocat/old", true)],
      installed: true,
      repositories: [],
    });

    renderAt("/projets");

    await screen.findByText("octocat/hello");
    const active = rowOf("octocat/hello");
    const archived = rowOf("octocat/old");
    expect(active).not.toBe(archived);
    expect(
      within(active).getByRole("button", { name: "Archiver" }),
    ).toBeDefined();
    expect(within(active).queryByText("Archivé")).toBeNull();
    expect(within(archived).getByText("Archivé")).toBeDefined();
    expect(
      within(archived).queryByRole("button", { name: "Archiver" }),
    ).toBeNull();
  });

  it.each([
    ["for_you", "Claude t'attend"],
    ["claude", "Claude travaille"],
    ["idle", "rien en cours"],
  ])(
    "given a project in state %s, when /projets loads, then its row says %s",
    async (state, words) => {
      stubApi({
        projects: [project(1, "octocat/hello")],
        installed: true,
        repositories: [],
        homeProjects: [{ id: 1, name: "octocat/hello", state }],
      });

      renderAt("/projets");

      // The sidebar names the project too: look in the page only.
      expect(
        await within(await screen.findByRole("main")).findByText(words),
      ).toBeDefined();
    },
  );

  it.each([
    [[], "Aucun n'a besoin de toi."],
    [["for_you"], "1 a besoin de toi."],
    [["for_you", "for_you"], "2 ont besoin de toi."],
  ])(
    "given %j projects waiting, when /projets loads, then the title says %s and the archived projects are not counted",
    async (states, words) => {
      stubApi({
        projects: [
          project(1, "octocat/a"),
          project(2, "octocat/b"),
          project(3, "octocat/old", true),
        ],
        installed: true,
        repositories: [],
        homeProjects: states.map((state, i) => ({
          id: i + 1,
          name: `octocat/${i}`,
          state,
        })),
      });

      renderAt("/projets");

      const title = await screen.findByRole("heading", { level: 1 });
      await waitFor(() => expect(title.textContent).toContain(words));
      expect(title.textContent).toContain("2 projets.");
    },
  );

  it("given an active and an archived project, when /projets loads, then each full name is a link to /projets/:id", async () => {
    stubApi({
      projects: [project(5, "octocat/hello"), project(6, "octocat/old", true)],
      installed: false,
      repositories: [],
    });

    renderAt("/projets");

    const active = await screen.findByRole("link", { name: "hello" });
    expect(active.getAttribute("href")).toBe("/projets/5");
    const archived = await screen.findByRole("link", { name: "old" });
    expect(archived.getAttribute("href")).toBe("/projets/6");
  });

  it("given /api/projects answers 401, when /projets loads, then it offers to log in with GitHub", async () => {
    stubApi({
      projects: [],
      installed: false,
      repositories: [],
      unauthorized: true,
    });

    renderAt("/projets");

    const links = await screen.findAllByRole("link", {
      name: "Se connecter avec GitHub",
    });
    expect(links[0]?.getAttribute("href")).toBe("/api/auth/login");
  });
});

describe("Projets page, archiving", () => {
  it("given an active project, when Archiver is clicked, then a confirmation is asked on the spot and nothing is sent until it is confirmed, then the list is refetched and the project reads Archivé", async () => {
    const calls = stubApi({
      projects: [project(5, "octocat/hello")],
      installed: true,
      repositories: [],
    });
    renderAt("/projets");
    fireEvent.click(await screen.findByRole("button", { name: "Archiver" }));

    const confirm = await screen.findByRole("button", {
      name: "Confirmer l'archivage",
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const listsBefore = listCalls(calls);

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.path === "/api/projects/5/archive",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Archivé")).toBeDefined();
    expect(listCalls(calls)).toBeGreaterThan(listsBefore);
    expect(screen.queryByRole("button", { name: "Archiver" })).toBeNull();
  });
});

describe("Projets page, import", () => {
  it("given the App is installed on an available and an imported repo, when /projets loads, then the available one has an Importer button and the imported one reads Déjà importé without a button", async () => {
    stubApi({
      projects: [project(1, "octocat/tracked")],
      installed: true,
      repositories: [
        repo(10, "octocat/available"),
        repo(11, "octocat/tracked", true),
      ],
    });

    renderAt("/projets");

    await screen.findByText("octocat/available");
    const available = rowOf("octocat/available");
    expect(
      within(available).getByRole("button", { name: "Importer" }),
    ).toBeDefined();
    expect(within(available).queryByText("Déjà importé")).toBeNull();
    // The tracked repo appears in the project list too; the import section is the row that says Déjà importé.
    const imported = screen.getByText("Déjà importé").closest("li, tr");
    expect(imported?.textContent).toContain("octocat/tracked");
    expect(within(imported as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("given an available repo, when Importer is clicked, then POST /api/projects is sent with its id and the project appears in the list", async () => {
    const calls = stubApi({
      projects: [],
      installed: true,
      repositories: [repo(10, "octocat/available")],
    });
    renderAt("/projets");
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Importer avec Standard" }),
    );

    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === "POST" && c.path === "/api/projects",
      );
      expect(post).toBeDefined();
      // Decision 063 D: the import also carries the starter team, Standard by default.
      expect(JSON.parse(post?.body ?? "null")).toEqual({
        githubRepoId: 10,
        starterTeam: "standard",
      });
    });
    // Only a project row has an Archiver button; the repo now reads Déjà importé.
    expect(
      await screen.findByRole("button", { name: "Archiver" }),
    ).toBeDefined();
    expect(await screen.findByText("Déjà importé")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Importer" })).toBeNull();
  });

  it("given the App is not installed, when /projets loads, then a link Installer l'App sur mes repos points to the install URL", async () => {
    stubApi({ projects: [], installed: false, repositories: [] });

    renderAt("/projets");

    const link = await screen.findByRole("link", {
      name: "Installer l'App sur mes repos",
    });
    expect(link.getAttribute("href")).toBe(INSTALL_URL);
    expect(screen.queryByRole("button", { name: "Importer" })).toBeNull();
  });

  it("given the server answers 409 to an import, when Importer is clicked, then an alert says the repo is already tracked", async () => {
    stubApi({
      projects: [],
      installed: true,
      repositories: [repo(10, "octocat/available")],
      importAnswer: Response.json({ error: ALREADY_TRACKED }, { status: 409 }),
    });
    renderAt("/projets");
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Importer avec Standard" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(ALREADY_TRACKED);
  });
});
