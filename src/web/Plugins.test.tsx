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

// Slice 12.3 (decision 066 A, B, E, F, G): the page « Équipes d'agents › Commun » on /equipes/commun and its sidebar entry.
//
// Assumed contract (server tests: src/server/plugins.test.ts):
// - The « Configurer » section of the sidebar has a link « Équipes d'agents » to /equipes (decision 072; /equipes/commun is reached from the page). The page says « Ce que tous tes projets partagent. » and « Défini une fois, dans ton repo de plugins. ».
// - The page reads GET /api/plugins -> { repo, agents, skills } and, once a repo is linked, GET /api/plugins/projects -> { projects: [{ id, fullName, installed, settings }] }.
// - No repo: « Crée un repo sur GitHub avec un premier commit (un README suffit), ouvre-le à Cockpit, puis relie-le ici. » (066 B as amended) and the repos of GET /api/github/repositories, one list item each with a button « Relier »
//   that sends PUT /api/plugins/repo { fullName }. A 409 { error: "repo_unreachable" } on GET /api/plugins is a role="alert" in French.
// - Linked: the agents and skills are list items with a button « Ouvrir <name> »; « + Nouvel agent commun » opens the agent form of 030 (« Nom de l'agent », « Continuer », « Description », « Consigne »),
//   « + Nouveau skill commun » the skill form of 065 (« Nom »); « Faire le commit » posts /api/plugins/apply { kind, name, before, after } and answers « C'est fait ». « Délier » sends { fullName: null }.
// - Projects: « installé dans N projets sur M » (N installed of M non-archived), one list item per project with « installé » or not and a button « Installer » / « Retirer »;
//   the button shows the diff of settings.json under « Ce qui change » (the pure function of src/server/plugin-settings.ts, login from /api/me), then « Faire le commit » posts
//   /api/projects/:id/plugins/apply { install, before: <settings> } and answers « C'est fait ». A refusal is a 409 { error } shown in a role="alert" in French, never the code.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const AG = "---\nname: dev\ndescription: Builds\n---\nBuild\n";
const SK = "---\nname: lint\ndescription: Lints\n---\nLint it\n";
const SHA = "a".repeat(40);
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
  { id: 9, fullName: "octocat/c", installed: true, settings: INSTALLED },
];

type Answer = { status: number; body: unknown };
type Sent = { method: string; path: string; body: unknown };

/** The shell fake plus the routes of the page, in a small fake server. */
function stubPlugins(options: { plugins?: Answer; reply?: Answer } = {}) {
  stubShell();
  const inner = globalThis.fetch;
  const sent: Sent[] = [];
  const plugins = options.plugins ?? {
    status: 200,
    body: {
      repo: "octocat/plugins",
      agents: [{ name: "dev", text: AG }],
      skills: [{ name: "lint", text: SK }],
    },
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
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const answer = (a: Answer) => Response.json(a.body, { status: a.status });
      if (path === "/api/plugins" && method === "GET") return answer(plugins);
      if (path === "/api/plugins/projects")
        return Response.json({ projects: PROJECTS });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/x/installations/new",
          installed: true,
          repositories: [
            {
              githubRepoId: 2,
              fullName: "octocat/plugins",
              defaultBranch: "main",
              imported: false,
            },
          ],
        });
      if (
        method !== "GET" &&
        (path === "/api/plugins/repo" ||
          path === "/api/plugins/apply" ||
          /^\/api\/projects\/\d+\/plugins\/apply$/.test(path))
      ) {
        sent.push({ method, path, body: JSON.parse(String(init?.body)) });
        return answer(
          options.reply ?? { status: 200, body: { commitSha: SHA } },
        );
      }
      return inner(input, init);
    }),
  );
  return sent;
}

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const row = (text: string) =>
  screen.getByText(text).closest("li") as HTMLElement;
const diffItems = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "")
    .filter((t) => /Retirée|Ajoutée/.test(t));

describe("decision 066 A: the entry and the page", () => {
  it("given a logged-in user, when the sidebar shows, then « Équipes d'agents » links to /equipes (slice 072) and /equipes/commun still opens with its two sentences", async () => {
    stubPlugins();
    renderAt("/");

    const link = await screen.findByRole("link", { name: "Équipes d'agents" });
    expect(link.getAttribute("href")).toBe("/equipes");
    cleanup();

    stubPlugins();
    renderAt("/equipes/commun");
    expect(
      await screen.findByText(/Ce que tous tes projets partagent\./),
    ).toBeDefined();
    expect(
      screen.getByText(/Défini une fois, dans ton repo de plugins\./),
    ).toBeDefined();
  });
});

describe("decision 066 B: linking the repo", () => {
  it("given no linked repo, when the page opens, then it says what to do and « Relier » on a repo sends PUT /api/plugins/repo", async () => {
    const sent = stubPlugins({
      plugins: { status: 200, body: { repo: null, agents: [], skills: [] } },
    });
    renderAt("/equipes/commun");
    await screen.findByText(
      /Crée un repo sur GitHub avec un premier commit \(un README suffit\), ouvre-le à Cockpit, puis relie-le ici\./,
    );

    fireEvent.click(
      within(await waitFor(() => row("octocat/plugins"))).getByRole("button", {
        name: "Relier",
      }),
    );

    await waitFor(() =>
      expect(sent).toEqual([
        {
          method: "PUT",
          path: "/api/plugins/repo",
          body: { fullName: "octocat/plugins" },
        },
      ]),
    );
  });

  it("given a linked repo, when « Délier » is clicked, then PUT /api/plugins/repo sends fullName null", async () => {
    const sent = stubPlugins();
    renderAt("/equipes/commun");
    await screen.findByRole("button", { name: "Ouvrir dev" });

    fireEvent.click(button("Délier"));

    await waitFor(() =>
      expect(sent).toEqual([
        { method: "PUT", path: "/api/plugins/repo", body: { fullName: null } },
      ]),
    );
  });

  it("given a repo that is no longer reached, when the page opens, then an alert in French shows, not the code, and « Délier » sends fullName null", async () => {
    const sent = stubPlugins({
      plugins: { status: 409, body: { error: "repo_unreachable" } },
    });
    renderAt("/equipes/commun");

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).not.toContain("repo_unreachable");
    expect(alert.textContent).toMatch(/repo/i);
    fireEvent.click(within(alert).getByRole("button", { name: "Délier" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { method: "PUT", path: "/api/plugins/repo", body: { fullName: null } },
      ]),
    );
  });
});

describe("decision 066 E: the shared agents and skills", () => {
  it("given a linked repo, when the page opens, then the agents and the skills are listed", async () => {
    stubPlugins();
    renderAt("/equipes/commun");

    expect(
      await screen.findByRole("button", { name: "Ouvrir dev" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Ouvrir lint" })).toBeDefined();
  });

  it("given « + Nouvel agent commun », when an agent is named and described, then the commit posts kind agent with before null", async () => {
    const sent = stubPlugins();
    renderAt("/equipes/commun");
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Nouvel agent commun" }),
    );

    fireEvent.change(screen.getByLabelText("Nom de l'agent"), {
      target: { value: "qa" },
    });
    fireEvent.click(button("Continuer"));
    fireEvent.change(await screen.findByLabelText("Description"), {
      target: { value: "Tests" },
    });
    fireEvent.click(button("Faire le commit"));

    await screen.findByText(/C'est fait/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: "/api/plugins/apply",
      body: {
        kind: "agent",
        name: "qa",
        before: null,
        after: expect.stringContaining('description: "Tests"'),
      },
    });
  });

  it("given « + Nouveau skill commun », when it is clicked, then the skill form opens", async () => {
    stubPlugins();
    renderAt("/equipes/commun");

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Nouveau skill commun" }),
    );

    expect(screen.getByLabelText("Nom")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
  });
});

describe("decision 066 F, G: installing in the projects", () => {
  it("given three projects of which two have the plugin, when the page opens, then the header counts them and each one offers Installer or Retirer", async () => {
    stubPlugins();
    renderAt("/equipes/commun");

    await screen.findByText(/installé dans 2 projets sur 3/);

    expect(
      within(row("octocat/a")).getByRole("button", { name: "Retirer" }),
    ).toBeDefined();
    expect(within(row("octocat/a")).getByText("installé")).toBeDefined();
    expect(
      within(row("octocat/b")).getByRole("button", { name: "Installer" }),
    ).toBeDefined();
  });

  it("given a project without the plugin, when « Installer » is clicked, then the diff shows the added entries and « Faire le commit » posts { install: true, before }", async () => {
    const sent = stubPlugins();
    renderAt("/equipes/commun");
    await screen.findByText(/installé dans 2 projets sur 3/);

    fireEvent.click(
      within(row("octocat/b")).getByRole("button", { name: "Installer" }),
    );

    expect(screen.getByText("Ce qui change")).toBeDefined();
    expect(
      diffItems().find((t) => t.includes("commun@cockpit-octocat")),
    ).toMatch(/Ajoutée/);
    fireEvent.click(button("Faire le commit"));

    await screen.findByText(/C'est fait/);
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/api/projects/8/plugins/apply",
        body: { install: true, before: null },
      },
    ]);
  });

  it("given a project with the plugin, when « Retirer » is clicked, then the diff shows the removed entries and the commit posts { install: false, before: the text read }", async () => {
    const sent = stubPlugins();
    renderAt("/equipes/commun");
    await screen.findByText(/installé dans 2 projets sur 3/);

    fireEvent.click(
      within(row("octocat/a")).getByRole("button", { name: "Retirer" }),
    );

    expect(
      diffItems().find((t) => t.includes("commun@cockpit-octocat")),
    ).toMatch(/Retirée/);
    fireEvent.click(button("Faire le commit"));

    await screen.findByText(/C'est fait/);
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/api/projects/7/plugins/apply",
        body: { install: false, before: INSTALLED },
      },
    ]);
  });

  it.each([
    ["invalid_settings", /modifie-le sur GitHub/],
    ["repo_changed", /./],
  ])(
    "given a refusal %s, when the commit is made, then an alert in French shows, never the code",
    async (code, french) => {
      stubPlugins({ reply: { status: 409, body: { error: code } } });
      renderAt("/equipes/commun");
      await screen.findByText(/installé dans 2 projets sur 3/);
      fireEvent.click(
        within(row("octocat/b")).getByRole("button", { name: "Installer" }),
      );

      fireEvent.click(button("Faire le commit"));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(french);
      expect(alert.textContent).not.toContain(code);
    },
  );
});
