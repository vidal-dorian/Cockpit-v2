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
import { DEFAULT_STEPS, writeTeam } from "./team-file.ts";

// Decision 084 (A, C, D, N, O), screens « Équipes d'agents » (/equipes) and the tab « Agents » of a project (/projets/5/agents).
//
// Pinned where the decision leaves it open:
// - N: the first click on « Ajouter » (/equipes), « Ajouter au projet » or « Mettre à jour dans le projet » (« Tes équipes ») sends nothing to /team/apply. Under the team's row (inside its li) it shows
//   « Ce qui change » with the diff of the repo copy to the team text (DiffList: list items « Retirée » / « Ajoutée »), a list named « Agents ajoutés » (one item per catalog agent the commit adds, absent when none)
//   and the button « Faire le commit », which posts the same body as before. The result (« C'est fait ») then stays inside that row. A team already up to date still says « Déjà à jour dans ce projet » at once.
// - C: after an add on /equipes, the result carries the link « Ouvrir dans <owner/repo> › Agents » to /projets/:id/agents. After « Créer l'équipe » (not « Enregistrer »), the new row opens on its « Projet » select.
// - O: the panel of a step whose agent the repo lacks but the catalog has offers « Ajouter l'agent du catalogue »: it opens the agent form (030 D) on the catalog text, and « Faire le commit » posts before: null.
// - Deleting an agent says which teams (« Par défaut » for team.md, else the team name) name it, next to the path and in the confirmation.
// - D: an unreadable agent header, an agent too large and an unreadable team link to https://github.com/<repo>/blob/HEAD/<path> with the text « Ouvrir sur GitHub ↗ ».

const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  if (realShowModal) HTMLDialogElement.prototype.showModal = realShowModal;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (realClose) HTMLDialogElement.prototype.close = realClose;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Team = { id: number; name: string; text: string };
type AgentFile = { name: string; text: string | null };
const SHA = "a".repeat(40);
const step = (agent: string) => ({
  agent,
  does: "does it",
  loopTo: null,
  until: "",
});
const teamOf = (...agents: string[]) =>
  writeTeam(
    agents.map((a) => step(a)),
    "",
  );
const TEAM = writeTeam(DEFAULT_STEPS, "");
const DOCS = teamOf("developer", "doc-writer");
const WIDE = teamOf("developer", "doc-writer", "security-reviewer");
const agentText = (name: string, level: string) =>
  `---\nname: ${name}\ndescription: ${name} from ${level}\n---\nYou are ${name}.\n`;
const STARTERS = [
  {
    id: "standard",
    team: TEAM,
    agents: ["test-writer", "developer", "reviewer"].map((name) => ({
      name,
      text: agentText(name, "standard"),
    })),
  },
  {
    id: "max",
    team: TEAM,
    agents: ["doc-writer", "security-reviewer"].map((name) => ({
      name,
      text: agentText(name, "max"),
    })),
  },
];
const repoAgent = (name: string): AgentFile => ({
  name,
  text: agentText(name, "repo"),
});

type Options = {
  teams?: Team[];
  repoAgents?: AgentFile[];
  repoTeam?: string | null;
  repoTeams?: { name: string; text: string }[];
  catalog?: AgentFile[];
};

function stubApi(options: Options = {}) {
  const teams = [...(options.teams ?? [])];
  const sent: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  const repoTeams = options.repoTeams ?? [];
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
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me/plan")
        return Response.json({
          plan: "pro",
          via: "code",
          until: null,
          repos: 1,
          limit: null,
          teamLimit: null,
        });
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
      if (path === "/api/starter-teams")
        return Response.json({ teams: STARTERS });
      if (path === "/api/agent-teams" && method === "GET")
        return Response.json({
          teams: [...teams].sort((a, b) => a.name.localeCompare(b.name)),
        });
      const named = /^\/api\/agent-teams\/([^/]+)$/.exec(path);
      if (named && method === "PUT") {
        const name = decodeURIComponent(named[1] as string);
        const found = teams.find((t) => t.name === name);
        if (found) found.text = body.text;
        else teams.push({ id: 100, name, text: body.text });
        return Response.json(teams.find((t) => t.name === name));
      }
      if (/^\/api\/projects\/5\/(stories|tickets)$/.test(path))
        return Response.json(
          path.endsWith("stories") ? { stories: [] } : { tickets: [] },
        );
      if (path === "/api/projects/5/routine")
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
      if (path === "/api/projects/5/health" && method === "GET")
        return Response.json({
          lines: ["claude_md", "ci", "mcp", "agents"].map((key) => ({
            key,
            ok: true,
            detail: "ok",
          })),
        });
      if (path === "/api/projects/5/agents" && method === "GET")
        return Response.json({
          agents: options.repoAgents ?? [repoAgent("developer")],
          catalog: options.catalog ?? [],
          team: options.repoTeam ?? null,
          teams: repoTeams,
        });
      if (
        (path === "/api/projects/5/team/apply" ||
          path === "/api/projects/5/agents/apply") &&
        method === "POST"
      ) {
        sent.push({ method, path, body });
        if (path.endsWith("/team/apply")) {
          const at = repoTeams.findIndex((t) => t.name === body.name);
          if (at >= 0)
            (repoTeams[at] as { text: string }).text = String(body.after);
          else
            repoTeams.push({
              name: String(body.name),
              text: String(body.after),
            });
        }
        return Response.json({ commitSha: SHA });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return sent;
}

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

const click = (name: string | RegExp, scope: HTMLElement | null = null) =>
  fireEvent.click(
    (scope ? within(scope) : screen).getByRole("button", { name }),
  );
const li = (name: string) =>
  waitFor(() => {
    const found = screen
      .queryAllByText(name)
      .map((x) => x.closest("li"))
      .find((x) => x !== null);
    if (!found) throw new Error(`no list item for ${name}`);
    return found as HTMLElement;
  });
const applies = (sent: ReturnType<typeof stubApi>) =>
  sent.filter((s) => s.path.endsWith("/team/apply")).map((s) => s.body);
const diffOf = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole("listitem")
    .map((x) => x.textContent ?? "")
    .filter((t) => /Retirée|Ajoutée/.test(t));
const SAME = [
  repoAgent("test-writer"),
  repoAgent("developer"),
  repoAgent("reviewer"),
];

describe("decision 084 N: see what changes before updating or adding a team (tab Agents, « Tes équipes »)", () => {
  it("given a repo copy of the team with another text, when « Mettre à jour dans le projet » is clicked, then the diff of the copy to the team shows in the row and nothing is posted until « Faire le commit »", async () => {
    const sent = stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: SAME,
      repoTeams: [{ name: "leger", text: DOCS }],
    });
    renderAt("/projets/5/agents");
    const row = await li("leger");

    click("Mettre à jour dans le projet", row);

    expect(await within(row).findByText("Ce qui change")).toBeDefined();
    const diff = diffOf(row);
    expect(
      diff.some((t) => /Retirée/.test(t) && t.includes("doc-writer")),
    ).toBe(true);
    expect(
      diff.some((t) => /Ajoutée/.test(t) && t.includes("test-writer")),
    ).toBe(true);
    expect(applies(sent)).toEqual([]);
    click("Faire le commit", row);
    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    expect(applies(sent)[0]).toEqual({
      name: "leger",
      before: DOCS,
      after: TEAM,
      agents: [],
    });
    expect(await within(row).findByText(/C'est fait/)).toBeDefined();
  });

  it("given a repo that lacks two catalog agents, when « Ajouter au projet » is clicked, then the list « Agents ajoutés » names them and nothing is posted until « Faire le commit »", async () => {
    const sent = stubApi({
      teams: [{ id: 1, name: "wide", text: WIDE }],
      repoAgents: [repoAgent("developer")],
    });
    renderAt("/projets/5/agents");
    const row = await li("wide");

    click("Ajouter au projet", row);

    const added = await within(row).findByRole("list", {
      name: "Agents ajoutés",
    });
    expect(
      within(added)
        .getAllByRole("listitem")
        .map((x) => x.textContent)
        .sort(),
    ).toEqual(["doc-writer", "security-reviewer"]);
    expect(applies(sent)).toEqual([]);
    click("Faire le commit", row);
    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    expect(applies(sent)[0]).toMatchObject({
      name: "wide",
      before: null,
      after: WIDE,
    });
  });

  it("given a repo that has every agent of a new team, when « Ajouter au projet » is clicked, then no list « Agents ajoutés » shows", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: SAME,
    });
    renderAt("/projets/5/agents");
    const row = await li("leger");

    click("Ajouter au projet", row);

    expect(await within(row).findByText("Ce qui change")).toBeDefined();
    expect(
      within(row).queryByRole("list", { name: "Agents ajoutés" }),
    ).toBeNull();
  });

  it("given the result of an add, when it is done, then « C'est fait » stays in the row of the team added, not under the list", async () => {
    stubApi({
      teams: [
        { id: 1, name: "docs", text: DOCS },
        { id: 2, name: "leger", text: TEAM },
      ],
      repoAgents: [...SAME, repoAgent("doc-writer")],
    });
    renderAt("/projets/5/agents");
    const row = await li("leger");
    click("Ajouter au projet", row);
    await within(row).findByText("Ce qui change");

    click("Faire le commit", row);

    expect(await within(row).findByText(/C'est fait/)).toBeDefined();
    expect(within(await li("docs")).queryByText(/C'est fait/)).toBeNull();
  });
});

describe("decision 084 N, C: adding a team on /equipes", () => {
  async function pick(name: string) {
    const row = await li(name);
    click("Ajouter à un projet", row);
    await within(row).findByRole("option", { name: /octocat\/hello/ });
    fireEvent.change(within(row).getByRole("combobox", { name: "Projet" }), {
      target: { value: "5" },
    });
    return row;
  }

  it("given a repo with the team under another text and a missing agent, when « Ajouter » is clicked, then the diff and « Agents ajoutés » show in the row and the commit waits for « Faire le commit »", async () => {
    const sent = stubApi({
      teams: [{ id: 1, name: "wide", text: WIDE }],
      repoAgents: [repoAgent("developer")],
      repoTeams: [{ name: "wide", text: DOCS }],
    });
    renderAt("/equipes");
    const row = await pick("wide");

    click("Ajouter", row);

    expect(await within(row).findByText("Ce qui change")).toBeDefined();
    expect(
      diffOf(row).some(
        (t) => /Ajoutée/.test(t) && t.includes("security-reviewer"),
      ),
    ).toBe(true);
    expect(
      within(within(row).getByRole("list", { name: "Agents ajoutés" }))
        .getAllByRole("listitem")
        .map((x) => x.textContent)
        .sort(),
    ).toEqual(["doc-writer", "security-reviewer"]);
    expect(applies(sent)).toEqual([]);
    click("Faire le commit", row);
    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    expect(applies(sent)[0]).toMatchObject({
      name: "wide",
      before: DOCS,
      after: WIDE,
    });
  });

  it("given a successful add, when « C'est fait » shows, then it carries the link « Ouvrir dans octocat/hello › Agents » to /projets/5/agents", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: SAME,
    });
    renderAt("/equipes");
    const row = await pick("leger");
    click("Ajouter", row);
    await within(row).findByText("Ce qui change");
    click("Faire le commit", row);

    await within(row).findByText(/C'est fait/);

    const link = within(row).getByRole("link", {
      name: /^Ouvrir dans octocat\/hello/,
    });
    expect(link.getAttribute("href")).toBe("/projets/5/agents");
  });
});

describe("decision 084 C: after « Créer l'équipe »", () => {
  async function openNew() {
    renderAt("/equipes");
    await screen.findByText("Aucune équipe pour l'instant.");
    click("Nouvelle équipe");
    const dialog = await screen.findByRole("dialog", {
      name: /^Nouvelle équipe/,
    });
    fireEvent.change(within(dialog).getByLabelText("Nom de l'équipe"), {
      target: { value: "mon-equipe" },
    });
    return within(dialog);
  }

  it("given a new team created, when the dialog closes, then its row is open on the « Projet » select and « Ajouter » without a click on « Ajouter à un projet »", async () => {
    stubApi();
    const ui = await openNew();

    fireEvent.click(ui.getByRole("button", { name: "Créer l'équipe" }));

    const row = await li("mon-equipe");
    expect(
      await within(row).findByRole("combobox", { name: "Projet" }),
    ).toBeDefined();
    expect(within(row).getByRole("button", { name: "Ajouter" })).toBeDefined();
  });

  it("given an existing team modified, when « Enregistrer » is clicked, then its row does not open on the « Projet » select", async () => {
    stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");
    const row = await li("leger");
    click("Modifier", row);
    const dialog = await screen.findByRole("dialog", {
      name: /^Modifier l'équipe · leger/,
    });

    click("Enregistrer", dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      within(await li("leger")).queryByRole("combobox", { name: "Projet" }),
    ).toBeNull();
  });
});

describe("decision 084 O: « Agent absent du repo »", () => {
  async function openStep(agent: string) {
    renderAt("/projets/5/agents");
    await screen.findByRole("heading", { name: "Équipe" });
    await waitFor(() =>
      expect(screen.queryByText("Chargement du graphe…")).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Liste" }));
    const stepRow = screen
      .getAllByRole("listitem")
      .find(
        (x) =>
          new RegExp(`^\\s*\\d+\\s*${agent}(?![\\w-])`).test(
            x.textContent ?? "",
          ) && within(x).queryByRole("button", { name: "Monter" }),
      ) as HTMLElement;
    click("Modifier", stepRow);
  }

  it("given a step whose agent is in the catalog but not in the repo, when its panel is open, then « Ajouter l'agent du catalogue » opens the agent form on the catalog text and the commit posts before: null", async () => {
    const sent = stubApi({
      repoAgents: [repoAgent("developer"), repoAgent("reviewer")],
      catalog: [repoAgent("test-writer")],
    });
    await openStep("test-writer");

    click("Ajouter l'agent du catalogue");

    expect(
      ((await screen.findByLabelText("Description")) as HTMLInputElement).value,
    ).toBe("test-writer from repo");
    click("Faire le commit");
    await waitFor(() =>
      expect(sent.filter((s) => s.path.endsWith("/agents/apply"))).toHaveLength(
        1,
      ),
    );
    expect(sent.find((s) => s.path.endsWith("/agents/apply"))?.body).toEqual({
      name: "test-writer",
      before: null,
      after: agentText("test-writer", "repo"),
    });
  });

  it("given a step whose agent is neither in the repo nor in the catalog, when its panel is open, then there is no « Ajouter l'agent du catalogue »", async () => {
    stubApi({
      repoAgents: [repoAgent("developer"), repoAgent("reviewer")],
      catalog: [],
    });
    await openStep("test-writer");

    expect(
      screen.queryByRole("button", { name: "Ajouter l'agent du catalogue" }),
    ).toBeNull();
  });

  it("given a step whose agent is in the repo, when its panel is open, then there is no « Ajouter l'agent du catalogue »", async () => {
    stubApi({ repoAgents: SAME, catalog: [repoAgent("test-writer")] });
    await openStep("developer");

    expect(
      screen.queryByRole("button", { name: "Ajouter l'agent du catalogue" }),
    ).toBeNull();
  });
});

describe("decision 084 A: deleting an agent says which teams use it", () => {
  const stubUsed = () =>
    stubApi({
      repoAgents: [
        repoAgent("developer"),
        repoAgent("reviewer"),
        repoAgent("doc-writer"),
      ],
      repoTeam: teamOf("developer", "reviewer"),
      repoTeams: [
        { name: "leger", text: teamOf("developer") },
        { name: "lourd", text: teamOf("developer", "reviewer") },
      ],
    });

  it("given reviewer named by team.md and by « lourd » only, when it is opened, then « utilisé par » lists « Par défaut » and « lourd » next to the path, not « leger »", async () => {
    stubUsed();
    renderAt("/projets/5/agents");
    fireEvent.click(
      await screen.findByRole("button", { name: "Ouvrir reviewer" }),
    );

    const used = await screen.findByText(/utilisé par/);

    expect(used.textContent).toContain("Par défaut");
    expect(used.textContent).toContain("lourd");
    expect(used.textContent).not.toContain("leger");
  });

  it("given an agent used by a team, when « Supprimer l'agent » is clicked, then the confirmation names the teams and nothing is posted", async () => {
    const sent = stubUsed();
    renderAt("/projets/5/agents");
    fireEvent.click(
      await screen.findByRole("button", { name: "Ouvrir reviewer" }),
    );

    click("Supprimer l'agent");

    const warning = screen.getByText(
      /Le fichier sera retiré du repo par un commit/,
    );
    expect(warning.textContent).toContain("Par défaut");
    expect(warning.textContent).toContain("lourd");
    expect(sent).toEqual([]);
  });

  it("given an agent no team names, when it is opened and « Supprimer l'agent » clicked, then there is no « utilisé par » and the warning is the plain sentence", async () => {
    stubUsed();
    renderAt("/projets/5/agents");
    fireEvent.click(
      await screen.findByRole("button", { name: "Ouvrir doc-writer" }),
    );

    click("Supprimer l'agent");

    expect(screen.queryByText(/utilisé par/)).toBeNull();
    expect(
      screen.getByText("Le fichier sera retiré du repo par un commit"),
    ).toBeDefined();
  });
});

describe("decision 084 D: « Ouvrir sur GitHub ↗ » where the text says « modifie-le sur GitHub »", () => {
  const BLOB = "https://github.com/octocat/hello/blob/HEAD/";
  const BROKEN = "---\n# why\nsteps:\n  - agent: developer\n---\n";

  it("given an agent whose header is unreadable, when it is opened, then the sentence carries a link to its file on GitHub", async () => {
    stubApi({ repoAgents: [{ name: "odd", text: "no header at all\n" }] });
    renderAt("/projets/5/agents");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir odd" }));

    const hrefs = (
      await screen.findAllByRole("link", { name: /Ouvrir sur GitHub/ })
    ).map((a) => a.getAttribute("href"));

    expect(hrefs).toContain(`${BLOB}.claude/agents/odd.md`);
  });

  it("given an agent too large to be read, when the tab opens, then its row is a link to the file on GitHub instead of a disabled button", async () => {
    stubApi({ repoAgents: [{ name: "big", text: null }] });
    renderAt("/projets/5/agents");

    const row = await li("big");

    const link = within(row).getByRole("link", { name: /GitHub/ });
    expect(link.getAttribute("href")).toBe(`${BLOB}.claude/agents/big.md`);
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("given a team.md Cockpit cannot rewrite, when the tab opens, then the sentence carries a link to .claude/team.md", async () => {
    stubApi({ repoAgents: SAME, repoTeam: BROKEN });
    renderAt("/projets/5/agents");
    await screen.findByText(/modifie-le sur GitHub/);

    const hrefs = screen
      .getAllByRole("link", {
        name: /Ouvrir sur GitHub/,
      })
      .map((a) => a.getAttribute("href"));

    expect(hrefs).toContain(`${BLOB}.claude/team.md`);
  });

  it("given a named team Cockpit cannot rewrite, when its chip is chosen, then the sentence carries a link to .claude/teams/<name>.md", async () => {
    stubApi({
      repoAgents: SAME,
      repoTeam: TEAM,
      repoTeams: [{ name: "leger", text: BROKEN }],
    });
    renderAt("/projets/5/agents");
    fireEvent.click(await screen.findByRole("button", { name: "leger" }));
    await screen.findByText(/modifie-le sur GitHub/);

    const hrefs = screen
      .getAllByRole("link", {
        name: /Ouvrir sur GitHub/,
      })
      .map((a) => a.getAttribute("href"));

    expect(hrefs).toContain(`${BLOB}.claude/teams/leger.md`);
  });
});
