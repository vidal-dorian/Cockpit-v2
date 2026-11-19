// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, type HomeData, PROJECT, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 084 D, E (slice S05): « Importer un repo » lands on the import section and, once imported, leads to the project;
// « Claude t'attend » on the project list says what waits and links to the first thing.
// Pinned: GET /api/home as in test-home.tsx (forYou items: answer { runId }, validate { storyId }, review { storyId }),
// GET /api/projects, GET /api/github/repositories and POST /api/projects (answers { project }) as in Projects.test.tsx.

type Repo = {
  githubRepoId: number;
  fullName: string;
  defaultBranch: string;
  imported: boolean;
};

function load(o: {
  home?: Partial<HomeData>;
  projects?: boolean;
  repos?: Repo[];
}) {
  const calls = stubHome({
    ...empty(),
    projects: [{ ...PROJECT, state: "for_you" }],
    ...o.home,
  } as HomeData);
  const inner = globalThis.fetch;
  const projects =
    o.projects === false
      ? []
      : [
          {
            id: 5,
            fullName: "octocat/hello",
            defaultBranch: "main",
            archived: false,
          },
        ];
  const repos = o.repos ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/projects" && method === "GET")
        return Response.json({ projects });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/x/installations/new",
          installed: true,
          repositories: repos,
        });
      if (path === "/api/projects" && method === "POST") {
        const { githubRepoId } = JSON.parse(String(init?.body)) as {
          githubRepoId: number;
        };
        const found = repos.find((r) => r.githubRepoId === githubRepoId);
        if (found) found.imported = true;
        const created = {
          id: 110,
          fullName: found?.fullName ?? "x/y",
          defaultBranch: "main",
          archived: false,
        };
        projects.push(created);
        return Response.json({ project: created }, { status: 201 });
      }
      return inner(input, init);
    }),
  );
  return calls;
}

// jsdom has no showModal (the import dialog) and no scrollIntoView.
const scrolled: Element[] = [];
beforeEach(() => {
  scrolled.length = 0;
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this);
  };
});
afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = async () => within(await screen.findByRole("main"));
const href = (el: HTMLElement) => el.getAttribute("href");

describe("decision 084 D: « Importer un repo » goes to the import section", () => {
  it("given any page, when the sidebar is shown, then « + Importer un repo » points to /projets#importer", async () => {
    load({});
    renderAt("/");

    const link = await screen.findByRole("link", {
      name: "+ Importer un repo",
    });

    expect(href(link)).toBe("/projets#importer");
  });

  it("given /projets#importer, when the repos are loaded, then the import section is scrolled into view", async () => {
    load({
      repos: [
        {
          githubRepoId: 10,
          fullName: "octocat/free",
          defaultBranch: "main",
          imported: false,
        },
      ],
    });
    renderAt("/projets#importer");

    await screen.findByRole("button", { name: "Importer" });

    await waitFor(() =>
      expect(scrolled.some((el) => el.id === "importer")).toBe(true),
    );
  });

  it("given no project, when /projets loads, then the empty state offers a link « Importer un repo » to #importer", async () => {
    load({ projects: false, home: { projects: [] } });
    renderAt("/projets");

    await screen.findByText(/Aucun projet pour l'instant/);

    const link = within(
      (await screen.findByText(/Aucun projet pour l'instant/)).closest(
        "p",
      ) as HTMLElement,
    ).getByRole("link", { name: /Importer un repo/ });
    expect(href(link)).toContain("#importer");
  });
});

describe("decision 084 D: after an import, the project is one click away", () => {
  it("given an available repo, when it is imported with Standard, then a link « Ouvrir le projet » leads to /projets/:id of the created project, and the list stays", async () => {
    load({
      repos: [
        {
          githubRepoId: 10,
          fullName: "octocat/free",
          defaultBranch: "main",
          imported: false,
        },
      ],
    });
    renderAt("/projets");
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Importer avec Standard" }),
    );

    const link = await screen.findByRole("link", { name: "Ouvrir le projet" });

    expect(href(link)).toBe("/projets/110");
    expect(window.location.pathname).toBe("/projets");
  });
});

describe("decision 084 E: « Claude t'attend » says what waits and leads to it", () => {
  const forYou = (...items: Record<string, unknown>[]) => ({
    home: { forYou: items },
  });
  const answer = {
    kind: "answer",
    questionId: 1,
    question: "Quoi ?",
    suggestedAnswers: [],
    runId: 11,
    storyId: 41,
    iWant: "relire",
    project: PROJECT,
  };
  const validate = (id: number) => ({
    kind: "validate",
    storyId: id,
    iWant: `valider ${id}`,
    project: PROJECT,
  });
  const review = (id: number) => ({
    kind: "review",
    storyId: id,
    iWant: `relire ${id}`,
    prNumber: id,
    prCiState: "passed",
    project: PROJECT,
  });

  it("given a question waiting, when /projets loads, then the state reads « Claude t'attend · 1 question » and links to the run", async () => {
    load(forYou(answer));
    renderAt("/projets");

    const link = await (await main()).findByRole("link", {
      name: "Claude t'attend · 1 question",
    });

    expect(href(link)).toBe("/runs/11");
  });

  it("given a story to validate, when /projets loads, then the state reads « Claude t'attend · 1 US à valider » and links to the story", async () => {
    load(forYou(validate(22)));
    renderAt("/projets");

    const link = await (await main()).findByRole("link", {
      name: "Claude t'attend · 1 US à valider",
    });

    expect(href(link)).toBe("/us/22");
  });

  it("given two PRs to review, when /projets loads, then the state reads « 2 PR à relire » and links to the first story", async () => {
    load(forYou(review(31), review(32)));
    renderAt("/projets");

    const link = await (await main()).findByRole("link", {
      name: "Claude t'attend · 2 PR à relire",
    });

    expect(href(link)).toBe("/us/31");
  });
});
