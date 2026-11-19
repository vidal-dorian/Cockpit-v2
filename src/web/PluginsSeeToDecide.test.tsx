// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 084 (C, D), « Équipes d'agents › Commun » (/equipes/commun).
//
// Pinned where the decision leaves it open:
// - D: the sentence of the no-repo state carries the link « Ouvrir un repo à Cockpit ↗ » to `installUrl` of GET /api/github/repositories, always; an empty list (`installed: true`, no repository) says
//   « L'App est installée, mais sur aucun repo. » with the link « Choisir des repos » to the same URL (the block of Projects.tsx).
// - C: the linked repo of the heading is the link « Ouvrir le repo ↗ » to https://github.com/<repo>; each project name of « Tes projets » is a link to /projets/:id.
// - Placement: the diff « Ce qui change » of « Installer » / « Retirer » and the result « C'est fait » (or the refusal alert) are inside the list item of that project.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const SHA = "a".repeat(40);
const INSTALL_URL = "https://github.com/apps/x/installations/new";
const INSTALLED = `${JSON.stringify(
  {
    extraKnownMarketplaces: {
      "cockpit-octocat": {
        source: { source: "github", repo: "octocat/plugins" },
      },
    },
    enabledPlugins: { "commun@cockpit-octocat": true },
  },
  null,
  2,
)}\n`;
const PROJECTS = [
  { id: 7, fullName: "octocat/a", installed: true, settings: INSTALLED },
  { id: 8, fullName: "octocat/b", installed: false, settings: null },
];

function stubPlugins(
  options: {
    repo?: string | null;
    repositories?: { githubRepoId: number; fullName: string }[];
    reply?: { status: number; body: unknown };
  } = {},
) {
  stubShell();
  const inner = globalThis.fetch;
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
      if (path === "/api/plugins" && method === "GET")
        return Response.json({
          repo: options.repo === undefined ? "octocat/plugins" : options.repo,
          agents: [],
          skills: [],
        });
      if (path === "/api/plugins/projects")
        return Response.json({ projects: PROJECTS });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: INSTALL_URL,
          installed: true,
          repositories: (options.repositories ?? []).map((r) => ({
            ...r,
            defaultBranch: "main",
            imported: false,
          })),
        });
      if (
        method === "POST" &&
        /^\/api\/projects\/\d+\/plugins\/apply$/.test(path)
      ) {
        const reply = options.reply ?? {
          status: 200,
          body: { commitSha: SHA },
        };
        return Response.json(reply.body, { status: reply.status });
      }
      return inner(input, init);
    }),
  );
}

const rowOf = async (name: string) => {
  const found = (await screen.findByText(name)).closest("li");
  if (!found) throw new Error(`no list item for ${name}`);
  return found as HTMLElement;
};

describe("decision 084 D: no repo linked", () => {
  it("given repos the App reaches, when the page opens, then the sentence carries « Ouvrir un repo à Cockpit » to the install URL", async () => {
    stubPlugins({
      repo: null,
      repositories: [{ githubRepoId: 2, fullName: "octocat/other" }],
    });
    renderAt("/equipes/commun");

    const link = await screen.findByRole("link", {
      name: /Ouvrir un repo à Cockpit/,
    });

    expect(link.getAttribute("href")).toBe(INSTALL_URL);
  });

  it("given an App installed on no repo, when the page opens, then it says so and « Choisir des repos » links to the install URL", async () => {
    stubPlugins({ repo: null, repositories: [] });
    renderAt("/equipes/commun");

    expect(
      await screen.findByText(/L'App est installée, mais sur aucun repo\./),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Choisir des repos" })
        .getAttribute("href"),
    ).toBe(INSTALL_URL);
  });
});

describe("decision 084 C: the repo and the projects are links", () => {
  it("given a linked repo, when the page opens, then « Ouvrir le repo » links to the repo on GitHub", async () => {
    stubPlugins();
    renderAt("/equipes/commun");

    const link = await screen.findByRole("link", { name: /Ouvrir le repo/ });

    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/plugins",
    );
  });

  it("given two projects, when « Tes projets » shows, then each name is a link to /projets/:id", async () => {
    stubPlugins();
    renderAt("/equipes/commun");
    await screen.findByText(/installé dans 1 projet sur 2/);

    expect(
      screen.getByRole("link", { name: "octocat/a" }).getAttribute("href"),
    ).toBe("/projets/7");
    expect(
      screen.getByRole("link", { name: "octocat/b" }).getAttribute("href"),
    ).toBe("/projets/8");
  });
});

describe("decision 084: the diff and the result of a plugin install stay on the project's row", () => {
  it("given « Installer » on a project, when it is clicked, then « Ce qui change » shows inside that project's list item", async () => {
    stubPlugins();
    renderAt("/equipes/commun");
    await screen.findByText(/installé dans 1 projet sur 2/);
    const row = await rowOf("octocat/b");

    fireEvent.click(within(row).getByRole("button", { name: "Installer" }));

    expect(await within(row).findByText("Ce qui change")).toBeDefined();
    expect(
      within(row).getByRole("button", { name: "Faire le commit" }),
    ).toBeDefined();
  });

  it("given the commit of an install, when it is done, then « C'est fait » is inside that project's list item", async () => {
    stubPlugins();
    renderAt("/equipes/commun");
    await screen.findByText(/installé dans 1 projet sur 2/);
    const row = await rowOf("octocat/b");
    fireEvent.click(within(row).getByRole("button", { name: "Installer" }));

    fireEvent.click(
      await within(row).findByRole("button", { name: "Faire le commit" }),
    );

    await waitFor(() =>
      expect(within(row).getByText(/C'est fait/)).toBeDefined(),
    );
    expect(
      within(await rowOf("octocat/a")).queryByText(/C'est fait/),
    ).toBeNull();
  });

  it("given a refusal of the commit, when it is made, then the alert is inside that project's list item", async () => {
    stubPlugins({ reply: { status: 409, body: { error: "repo_changed" } } });
    renderAt("/equipes/commun");
    await screen.findByText(/installé dans 1 projet sur 2/);
    const row = await rowOf("octocat/b");
    fireEvent.click(within(row).getByRole("button", { name: "Installer" }));

    fireEvent.click(
      await within(row).findByRole("button", { name: "Faire le commit" }),
    );

    await waitFor(() => expect(within(row).getByRole("alert")).toBeDefined());
  });
});
