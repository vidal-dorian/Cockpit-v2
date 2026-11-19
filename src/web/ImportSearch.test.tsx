// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 084 A (A1 to A4): the « Importer depuis GitHub » list of /projets is searchable, paged by 10 and readable on a phone.
//
// Pinned where the story leaves it open:
// - The search field is the textbox named « Chercher un repo » (type="search", placeholder « Chercher un repo… »), only there when the server gives at least one repo.
// - The list shows 10 rows, the not-yet-imported first (server order), then the imported; « Afficher plus (N restants) » adds 10 and disappears at the end.
// - A row reads the repo name without its owner (font-mono, font-semibold, break-all), then « owner · branch » in a muted line.
// - No match: « Aucun repo ne correspond à « xyz ». ».

type Repo = {
  githubRepoId: number;
  fullName: string;
  defaultBranch: string;
  imported: boolean;
};
const repo = (
  githubRepoId: number,
  fullName: string,
  imported = false,
  defaultBranch = "main",
): Repo => ({ githubRepoId, fullName, defaultBranch, imported });

function stubApi(repositories: Repo[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects") return Response.json({ projects: [] });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: true,
          repositories,
        });
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
}

function renderProjects() {
  window.history.replaceState({}, "", "/projets");
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

const SEARCH = "Chercher un repo";
const importButtons = () =>
  screen.queryAllByRole("button", { name: "Importer" });
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => repo(i + 1, `acme/repo-${i + 1}`));
const search = async () =>
  (await screen.findByRole("searchbox", { name: SEARCH })) as HTMLInputElement;

describe("decision 084 A1: search", () => {
  it("given repos, when /projets loads, then a search field named « Chercher un repo » sits above the list", async () => {
    stubApi(many(3));
    renderProjects();

    const field = await search();
    expect(field.type).toBe("search");
    expect(field.placeholder).toBe("Chercher un repo…");
  });

  it("given no repo at all, when /projets loads, then there is no search field", async () => {
    stubApi([]);
    renderProjects();

    await screen.findByText(/aucun repo/);
    expect(screen.queryByRole("searchbox", { name: SEARCH })).toBeNull();
  });

  it("given repos of two owners, when the user types part of the owner in capitals, then only the matching full names stay", async () => {
    stubApi([
      repo(1, "alice/site"),
      repo(2, "bob/api"),
      repo(3, "alice/tools"),
    ]);
    renderProjects();

    fireEvent.change(await search(), { target: { value: "ALICE/" } });

    expect(screen.getByText("site")).toBeDefined();
    expect(screen.getByText("tools")).toBeDefined();
    expect(screen.queryByText("api")).toBeNull();
    expect(importButtons()).toHaveLength(2);
  });

  it("given a trailing space after the text (iOS suggestion), when typed, then the matching repo still shows", async () => {
    stubApi([repo(1, "alice/site"), repo(2, "bob/api")]);
    renderProjects();

    fireEvent.change(await search(), { target: { value: "alice " } });

    expect(screen.getByText("site")).toBeDefined();
    expect(screen.queryByText("api")).toBeNull();
  });
});

describe("decision 084 A2: ten at a time", () => {
  it("given 33 repos, when /projets loads, then 10 rows show and the button says « Afficher plus (23 restants) »", async () => {
    stubApi(many(33));
    renderProjects();

    await search();
    expect(importButtons()).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: "Afficher plus (23 restants)" }),
    ).toBeDefined();
  });

  it("given 33 repos, when « Afficher plus » is clicked, then 10 more rows show and the count falls to 13", async () => {
    stubApi(many(33));
    renderProjects();
    await search();

    fireEvent.click(
      screen.getByRole("button", { name: "Afficher plus (23 restants)" }),
    );

    expect(importButtons()).toHaveLength(20);
    expect(
      screen.getByRole("button", { name: "Afficher plus (13 restants)" }),
    ).toBeDefined();
  });

  it("given 12 repos, when /projets loads, then the button says 2 restants, and once clicked all 12 show and the button is gone", async () => {
    stubApi(many(12));
    renderProjects();
    await search();

    fireEvent.click(
      screen.getByRole("button", { name: "Afficher plus (2 restants)" }),
    );

    expect(importButtons()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /Afficher plus/ })).toBeNull();
  });

  it("given 10 repos or fewer, when /projets loads, then there is no « Afficher plus »", async () => {
    stubApi(many(10));
    renderProjects();

    await search();
    expect(importButtons()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /Afficher plus/ })).toBeNull();
  });

  it("given imported repos first in the server order, when /projets loads, then the not-yet-imported ones come first, each group in the server order", async () => {
    const repos = [
      repo(1, "acme/done-1", true),
      repo(2, "acme/done-2", true),
      ...Array.from({ length: 10 }, (_, i) =>
        repo(10 + i, `acme/new-${i + 1}`),
      ),
    ];
    stubApi(repos);
    renderProjects();
    await search();

    // All ten visible rows are importable: the imported ones are pushed past the first page.
    expect(importButtons()).toHaveLength(10);
    expect(screen.queryByText("Déjà importé")).toBeNull();
    expect(screen.getByText("new-1")).toBeDefined();
    expect(screen.getByText("new-10")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Afficher plus (2 restants)" }),
    );
    const rows = screen
      .getAllByText("Déjà importé")
      .map((badge) => badge.closest("li")?.textContent ?? "");
    expect(rows[0]).toContain("done-1");
    expect(rows[1]).toContain("done-2");
  });

  it("given the list was extended, when the search changes, then it is back to 10 rows", async () => {
    stubApi(many(33));
    renderProjects();
    const field = await search();
    fireEvent.click(
      screen.getByRole("button", { name: "Afficher plus (23 restants)" }),
    );
    expect(importButtons()).toHaveLength(20);

    fireEvent.change(field, { target: { value: "repo" } });

    expect(importButtons()).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: "Afficher plus (23 restants)" }),
    ).toBeDefined();
  });

  it("given 33 repos, when the search matches 11 of them, then 10 show and the button counts 1 restant", async () => {
    stubApi(many(33));
    renderProjects();

    // « repo-1 » matches repo-1 and repo-10 to repo-19: 11 repos.
    fireEvent.change(await search(), { target: { value: "repo-1" } });

    expect(importButtons()).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: "Afficher plus (1 restant)" }),
    ).toBeDefined();
  });
});

describe("decision 084 A3: no result", () => {
  it("given repos, when the search matches none, then the sentence names the search and no row is left", async () => {
    stubApi(many(3));
    renderProjects();

    fireEvent.change(await search(), { target: { value: "xyz" } });

    expect(
      screen.getByText("Aucun repo ne correspond à « xyz »."),
    ).toBeDefined();
    expect(importButtons()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Afficher plus/ })).toBeNull();
  });
});

describe("decision 084 A4: one row", () => {
  it("given a repo, when /projets loads, then its name without owner is bold mono and breaks anywhere, with « owner · branch » muted under it", async () => {
    stubApi([repo(1, "acme/a-very-long-repository-name", false, "develop")]);
    renderProjects();

    const name = await screen.findByText("a-very-long-repository-name");
    for (const cls of ["font-mono", "font-semibold", "break-all"])
      expect(name.className).toContain(cls);
    const detail = screen.getByText("acme · develop");
    expect(detail.className).toContain("text-muted-foreground");
    expect(screen.queryByText("acme/a-very-long-repository-name")).toBeNull();
  });

  it("given an imported and an available repo, when /projets loads, then each row keeps its Importer button or its Déjà importé badge next to the name", async () => {
    stubApi([repo(1, "acme/free"), repo(2, "acme/taken", true)]);
    renderProjects();

    const free = (await screen.findByText("free")).closest("li") as HTMLElement;
    expect(
      within(free).getByRole("button", { name: "Importer" }),
    ).toBeDefined();
    const taken = screen.getByText("taken").closest("li") as HTMLElement;
    expect(within(taken).getByText("Déjà importé")).toBeDefined();
    expect(within(taken).queryByRole("button")).toBeNull();
  });
});
