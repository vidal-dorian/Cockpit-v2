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
import { DEFAULT_STEPS, readTeam, writeTeam } from "./team-file.ts";

// Decision 074 B: the agent teams of the user, created once on « Équipes d'agents » (/equipes) and added to the projects from that page or from the tab « Agents » of a project.
//
// Pinned where the story leaves it open:
// - The page reads GET /api/agent-teams -> { teams: [{ id, name, text }] }, GET /api/projects, GET /api/starter-teams -> { teams: [{ id, team, agents: [{ name, text }] }] }.
//   PUT /api/agent-teams/:name { text } answers { id, name, text } and DELETE /api/agent-teams/:name answers 200 { ok: true }; the list is read again after each.
// - Each team is a list item (li) with its name, its steps « a → b → c », and the buttons « Modifier », « Supprimer », « Ajouter à un projet ».
// - « Ajouter à un projet » reveals a select « Projet » (option value = the project id, the non-archived projects only) and a button « Ajouter ».
// - « Modifier » opens the canvas « Modifier l'équipe · <nom> » (decision 079): « Nom de l'équipe » is shown read-only (or disabled), the button is « Enregistrer ».
// - « Supprimer » shows « Confirmer la suppression », « Annuler » and « Les projets qui l'ont gardent leur copie. » before the DELETE.
// - Adding reads GET /api/projects/:id/agents, then POSTs /api/projects/:id/team/apply { name, before, after, agents: [{ name, before: null, after }] } (the agents the repo lacks, text from the starter teams, standard first, then premium, max, eco);
//   nothing is posted when the repo already has the same team and every agent: « Déjà à jour dans ce projet ». Success: « C'est fait » and a link to the commit (or the pull request).
// - On the tab « Agents » of a project, a section (heading) « Tes équipes » lists the teams with « Ajouter au projet » / « Mettre à jour dans le projet » (a different named team in the repo) / « Déjà dans le projet » (no button).

// jsdom has no showModal/close on <dialog>: stub them and restore the originals.
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
type Answer = { status: number; body: unknown };
const SHA = "a".repeat(40);
const COMMIT_URL = `https://github.com/octocat/hello/commit/${SHA}`;
const PR_URL = "https://github.com/octocat/hello/pull/3";
const REPO_CHANGED = "Le repo a changé entre-temps : regarde de nouveau";

const step = (agent: string, does = "does it") => ({
  agent,
  does,
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
const LEVEL_AGENTS: Record<string, string[]> = {
  eco: ["test-writer", "developer"],
  standard: ["test-writer", "developer", "reviewer"],
  premium: [
    "test-writer",
    "developer",
    "reviewer",
    "doc-writer",
    "doc-reviewer",
  ],
  max: [
    "test-writer",
    "developer",
    "reviewer",
    "security-reviewer",
    "doc-writer",
    "doc-reviewer",
  ],
};
const STARTERS = ["eco", "standard", "premium", "max"].map((id) => ({
  id,
  team: TEAM,
  agents: (LEVEL_AGENTS[id] as string[]).map((name) => ({
    name,
    text: agentText(name, id),
  })),
}));
const repoAgent = (name: string) => ({ name, text: agentText(name, "repo") });

type Options = {
  teams?: Team[];
  repoAgents?: string[];
  repoTeam?: string | null;
  repoTeams?: { name: string; text: string }[];
  applies?: Answer[];
  archived?: boolean;
  /** `teamLimit` of GET /api/me/plan (decision 082 E): 2 for a Free account, null (the default) for Pro. */
  teamLimit?: number | null;
  /** The answer of every PUT /api/agent-teams/:name, instead of saving the team. */
  putAnswer?: Answer;
};

function stubApi(options: Options = {}) {
  const teams = [...(options.teams ?? [])];
  let nextId = 100;
  const sent: { method: string; path: string; body: unknown }[] = [];
  const applies = options.applies ?? [
    { status: 200, body: { commitSha: SHA } },
  ];
  const calls = { agentReads: 0 };
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
      // The shell's « Cockpit ne répond plus » banner (decision 072) reads it.
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me/plan")
        return Response.json({
          plan: options.teamLimit == null ? "pro" : "free",
          via: options.teamLimit == null ? "code" : null,
          until: null,
          repos: 1,
          limit: options.teamLimit == null ? null : 3,
          teamLimit: options.teamLimit ?? null,
        });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: options.archived ?? false,
            },
            {
              id: 6,
              fullName: "octocat/old",
              defaultBranch: "main",
              archived: true,
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
        sent.push({ method, path, body });
        if (options.putAnswer)
          return Response.json(options.putAnswer.body, {
            status: options.putAnswer.status,
          });
        const name = decodeURIComponent(named[1] as string);
        const found = teams.find((t) => t.name === name);
        if (found) found.text = body.text;
        else teams.push({ id: nextId++, name, text: body.text });
        const team = teams.find((t) => t.name === name) as Team;
        return Response.json(team);
      }
      if (named && method === "DELETE") {
        sent.push({ method, path, body });
        const at = teams.findIndex(
          (t) => t.name === decodeURIComponent(named[1] as string),
        );
        if (at >= 0) teams.splice(at, 1);
        return Response.json({ ok: true });
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
      if (path === "/api/projects/5/agents" && method === "GET") {
        calls.agentReads++;
        return Response.json({
          agents: (options.repoAgents ?? ["developer"]).map(repoAgent),
          catalog: [],
          team: options.repoTeam ?? null,
          teams: repoTeams,
        });
      }
      if (path === "/api/projects/5/team/apply" && method === "POST") {
        const answer = applies[
          Math.min(
            sent.filter((s) => s.path.endsWith("/team/apply")).length,
            applies.length - 1,
          )
        ] as Answer;
        sent.push({ method, path, body });
        if (answer.status === 200 && repoTeams) {
          const done = body as { name: string; after: string };
          const at = repoTeams.findIndex((t) => t.name === done.name);
          if (at >= 0) (repoTeams[at] as { text: string }).text = done.after;
          else repoTeams.push({ name: done.name, text: done.after });
        }
        return Response.json(answer.body, { status: answer.status });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return { sent, calls };
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

const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const row = async (name: string) => {
  const li = (await screen.findByText(name, { selector: "*" })).closest("li");
  if (!li) throw new Error(`no list item for ${name}`);
  return within(li as HTMLElement);
};
const puts = (sent: ReturnType<typeof stubApi>["sent"]) =>
  sent.filter((s) => s.method === "PUT");
const applies = (sent: ReturnType<typeof stubApi>["sent"]) =>
  sent
    .filter((s) => s.path.endsWith("/team/apply"))
    .map((s) => s.body as Record<string, unknown>);
const sorted = (agents: unknown) =>
  [...(agents as { name: string }[])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

describe("decision 074 B1: the entry and the page", () => {
  it("given a logged-in user, when « Équipes d'agents » is clicked in the sidebar, then /equipes opens with its two sentences and the link to « Agents et skills communs »", async () => {
    stubApi();
    renderAt("/");

    fireEvent.click(
      await screen.findByRole("link", { name: "Équipes d'agents" }),
    );

    expect(await screen.findByText(/Tes équipes d'agents\./)).toBeDefined();
    expect(
      screen.getByText(
        /Crée-les une fois, ajoute-les à tes projets, choisis-en une quand tu lances Claude\./,
      ),
    ).toBeDefined();
    expect(window.location.pathname).toBe("/equipes");
    const common = screen.getByRole("link", {
      name: "Agents et skills communs",
    });
    expect(common.getAttribute("href")).toBe("/equipes/commun");
  });
});

describe("decision 074 B2: no team", () => {
  it("given no team, when the page opens, then it says « Aucune équipe pour l'instant. » and offers « Nouvelle équipe »", async () => {
    stubApi();
    renderAt("/equipes");

    expect(
      await screen.findByText("Aucune équipe pour l'instant."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Nouvelle équipe" }),
    ).toBeDefined();
  });
});

describe("decision 074 B3: creating a team", () => {
  async function openNew() {
    renderAt("/equipes");
    await screen.findByText("Aucune équipe pour l'instant.");
    click("Nouvelle équipe");
    const dialog = (await screen.findByRole("dialog", {
      name: /^Nouvelle équipe/,
    })) as HTMLElement;
    return within(dialog);
  }
  const typeName = (ui: ReturnType<typeof within>, value: string) =>
    fireEvent.change(ui.getByLabelText("Nom de l'équipe"), {
      target: { value },
    });

  it("given « Nouvelle équipe » clicked, when the dialog opens, then it starts from test-writer, developer, reviewer", async () => {
    stubApi();

    const ui = await openNew();

    const agents = (await ui.findAllByRole("listitem"))
      .filter((li) => within(li).queryByRole("button", { name: "Monter" }))
      .map((li) => /^\s*\d+\s*([a-z0-9-]+)/.exec(li.textContent ?? "")?.[1]);
    expect(agents).toEqual(["test-writer", "developer", "reviewer"]);
  });

  it("given a name, when « Créer l'équipe » is clicked, then PUT /api/agent-teams/<name> carries the team text, the dialog closes and the team is listed", async () => {
    const { sent } = stubApi();
    const ui = await openNew();
    typeName(ui, "mon-equipe");

    fireEvent.click(ui.getByRole("button", { name: "Créer l'équipe" }));

    await waitFor(() => expect(puts(sent)).toHaveLength(1));
    const [put] = puts(sent);
    expect(put?.path).toBe("/api/agent-teams/mon-equipe");
    expect(
      readTeam((put as { body: { text: string } }).body.text)?.steps.map(
        (s) => s.agent,
      ),
    ).toEqual(["test-writer", "developer", "reviewer"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("mon-equipe")).toBeDefined();
  });

  it("given a team named leger, when the same name is typed, then « Ce nom est déjà pris » is shown and « Créer l'équipe » is disabled", async () => {
    stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");
    await screen.findByText("leger");
    click("Nouvelle équipe");
    const ui = within(
      await screen.findByRole("dialog", { name: /^Nouvelle équipe/ }),
    );

    typeName(ui, "leger");

    expect(ui.getByText("Ce nom est déjà pris")).toBeDefined();
    expect(
      (ui.getByRole("button", { name: "Créer l'équipe" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("decision 079 D, E: the canvas on /equipes", () => {
  it("given the page, when « Nouvelle équipe » is clicked, then the canvas offers only « Catalogue de Cockpit » (no « Agents du repo ») and the header « ‹ Équipes d'agents »", async () => {
    stubApi();
    renderAt("/equipes");
    await screen.findByText("Aucune équipe pour l'instant.");

    click("Nouvelle équipe");

    const ui = within(
      await screen.findByRole("dialog", { name: /^Nouvelle équipe ·/ }),
    );
    const catalogue = within(
      ui.getByRole("group", { name: "Catalogue de Cockpit" }),
    );
    expect(catalogue.getByRole("button", { name: "doc-writer" })).toBeDefined();
    expect(ui.queryByRole("group", { name: "Agents du repo" })).toBeNull();
    expect(
      ui.getByRole("button", { name: "‹ Équipes d'agents" }),
    ).toBeDefined();
  });

  it("given the canvas of a team, when a catalogue agent is added and « Enregistrer » clicked, then PUT /api/agent-teams/<name> still carries the team with that step", async () => {
    const { sent } = stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");
    fireEvent.click(
      (await row("leger")).getByRole("button", { name: "Modifier" }),
    );
    const ui = within(
      await screen.findByRole("dialog", { name: /^Modifier l'équipe · leger/ }),
    );
    fireEvent.click(
      within(ui.getByRole("group", { name: "Catalogue de Cockpit" })).getByRole(
        "button",
        { name: "doc-writer" },
      ),
    );

    fireEvent.click(ui.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(puts(sent)).toHaveLength(1));
    const [put] = puts(sent);
    expect(put?.path).toBe("/api/agent-teams/leger");
    expect(
      readTeam((put as { body: { text: string } }).body.text)?.steps.map(
        (s) => s.agent,
      ),
    ).toEqual(["test-writer", "developer", "reviewer", "doc-writer"]);
  });
});

describe("decision 074 B4: a team of the list", () => {
  it("given teams, when the page opens, then each shows its name and its steps", async () => {
    stubApi({
      teams: [
        { id: 1, name: "leger", text: TEAM },
        { id: 2, name: "docs", text: DOCS },
      ],
    });
    renderAt("/equipes");

    const leger = await row("leger");
    const docs = await row("docs");

    expect(leger.getByText("test-writer → developer → reviewer")).toBeDefined();
    expect(docs.getByText("developer → doc-writer")).toBeDefined();
  });

  it("given a team, when « Modifier » is clicked, then the dialog « Modifier l'équipe » shows the name read-only and « Enregistrer » sends the PUT with the new text", async () => {
    const { sent } = stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");
    fireEvent.click(
      (await row("leger")).getByRole("button", { name: "Modifier" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /^Modifier l'équipe · leger/,
    });
    const ui = within(dialog);
    const name = ui.getByLabelText("Nom de l'équipe") as HTMLInputElement;
    expect(name.value).toBe("leger");
    expect(name.readOnly || name.disabled).toBe(true);
    const first = (await ui.findAllByRole("listitem")).find((li) =>
      within(li).queryByRole("button", { name: "Descendre" }),
    ) as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: "Descendre" }));

    fireEvent.click(ui.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(puts(sent)).toHaveLength(1));
    const [put] = puts(sent);
    expect(put?.path).toBe("/api/agent-teams/leger");
    expect(
      readTeam((put as { body: { text: string } }).body.text)?.steps.map(
        (s) => s.agent,
      ),
    ).toEqual(["developer", "test-writer", "reviewer"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("given a team, when « Supprimer » is clicked, then the confirmation says the projects keep their copy and nothing is sent until it is confirmed", async () => {
    const { sent } = stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");
    const leger = await row("leger");

    fireEvent.click(leger.getByRole("button", { name: "Supprimer" }));

    expect(
      screen.getByText(/Les projets qui l'ont gardent leur copie\./),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDefined();
    expect(sent).toEqual([]);
    click("Confirmer la suppression");
    await waitFor(() =>
      expect(sent).toEqual([
        { method: "DELETE", path: "/api/agent-teams/leger", body: undefined },
      ]),
    );
    await waitFor(() => expect(screen.queryByText("leger")).toBeNull());
  });

  it("given the confirmation of a deletion, when « Annuler » is clicked, then nothing is deleted", async () => {
    const { sent } = stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");
    fireEvent.click(
      (await row("leger")).getByRole("button", { name: "Supprimer" }),
    );

    click("Annuler");

    expect(
      screen.queryByRole("button", { name: "Confirmer la suppression" }),
    ).toBeNull();
    expect(sent).toEqual([]);
    expect(screen.getByText("leger")).toBeDefined();
  });

  async function addTo(name: string) {
    const li = await row(name);
    fireEvent.click(li.getByRole("button", { name: "Ajouter à un projet" }));
    const select = li.getByRole("combobox", {
      name: "Projet",
    }) as HTMLSelectElement;
    return { li, select };
  }

  it("given a non-archived and an archived project, when « Ajouter à un projet » is clicked, then the select offers only the non-archived one", async () => {
    stubApi({ teams: [{ id: 1, name: "leger", text: TEAM }] });
    renderAt("/equipes");

    const { select } = await addTo("leger");

    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value)
        .filter((v) => v !== ""),
    ).toEqual(["5"]);
  });

  it("given a repo with developer only, when the team is added, then one apply carries the team and the missing agents from the catalog (standard first)", async () => {
    const { sent } = stubApi({
      teams: [{ id: 1, name: "wide", text: WIDE }],
      repoAgents: ["developer"],
    });
    renderAt("/equipes");
    const { li, select } = await addTo("wide");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    const [body] = applies(sent);
    expect(body).toMatchObject({ name: "wide", before: null, after: WIDE });
    expect(sorted(body?.agents)).toEqual([
      {
        name: "doc-writer",
        before: null,
        after: agentText("doc-writer", "premium"),
      },
      {
        name: "security-reviewer",
        before: null,
        after: agentText("security-reviewer", "max"),
      },
    ]);
    expect(await screen.findByText(/C'est fait/)).toBeDefined();
    const link = screen.getByRole("link", { name: /commit/i });
    expect(link.getAttribute("href")).toBe(COMMIT_URL);
  });

  it("given a repo lacking test-writer and reviewer, when the team is added, then their texts are those of the level standard", async () => {
    const { sent } = stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["developer"],
    });
    renderAt("/equipes");
    const { li, select } = await addTo("leger");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    expect(sorted(applies(sent)[0]?.agents)).toEqual([
      {
        name: "reviewer",
        before: null,
        after: agentText("reviewer", "standard"),
      },
      {
        name: "test-writer",
        before: null,
        after: agentText("test-writer", "standard"),
      },
    ]);
  });

  it("given a repo that has the team with another text, when the team is added, then before is the text read in the repo", async () => {
    const { sent } = stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
      repoTeams: [{ name: "leger", text: DOCS }],
    });
    renderAt("/equipes");
    const { li, select } = await addTo("leger");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    expect(applies(sent)[0]).toEqual({
      name: "leger",
      before: DOCS,
      after: TEAM,
      agents: [],
    });
  });

  it("given a repo that already has the same team and every agent, when the team is added, then nothing is sent and « Déjà à jour dans ce projet » is shown", async () => {
    const { sent } = stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
      repoTeams: [{ name: "leger", text: TEAM }],
    });
    renderAt("/equipes");
    const { li, select } = await addTo("leger");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText("Déjà à jour dans ce projet")).toBeDefined();
    expect(applies(sent)).toEqual([]);
  });

  it("given a protected branch, when the team is added, then the link is the pull request", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
      applies: [
        {
          status: 200,
          body: { commitSha: SHA, pullRequest: { number: 3, url: PR_URL } },
        },
      ],
    });
    renderAt("/equipes");
    const { li, select } = await addTo("leger");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    await screen.findByText(/C'est fait|pull request/);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === PR_URL),
    ).toBe(true);
  });

  it("given a refusal of the repo, when the team is added, then the message of ProjectPrepare is shown in an alert", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      applies: [{ status: 409, body: { error: "repo_changed" } }],
    });
    renderAt("/equipes");
    const { li, select } = await addTo("leger");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      REPO_CHANGED,
    );
  });
});

describe("feedback on E6: adding a team to a project", () => {
  async function openAdd(name: string) {
    const li = await row(name);
    fireEvent.click(li.getByRole("button", { name: "Ajouter à un projet" }));
    return li;
  }
  const option = (li: Awaited<ReturnType<typeof row>>, name: string) =>
    li.findByRole("option", { name }) as Promise<HTMLOptionElement>;

  it("given an add that has not answered, when « Ajouter » is clicked, then « Ajout en cours… » is a status and « Ajouter » is disabled", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
    });
    const inner = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/team/apply")) await gate;
        return inner(input, init);
      }),
    );
    renderAt("/equipes");
    const li = await openAdd("leger");
    fireEvent.change(li.getByRole("combobox", { name: "Projet" }), {
      target: { value: "5" },
    });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Ajout en cours…");
    expect(
      (li.getByRole("button", { name: "Faire le commit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (li.getByRole("button", { name: "Ajouter" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    release();
    expect(await screen.findByText(/C'est fait/)).toBeDefined();
  });

  it("given a repo with the same team, when the panel opens, then its project is a disabled option « déjà dans ce projet »", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoTeams: [{ name: "leger", text: TEAM }],
    });
    renderAt("/equipes");

    const li = await openAdd("leger");

    expect(
      (await option(li, "octocat/hello · déjà dans ce projet")).disabled,
    ).toBe(true);
  });

  it("given a repo with the team under another text, when the panel opens, then its project is an enabled option « à mettre à jour »", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoTeams: [{ name: "leger", text: DOCS }],
    });
    renderAt("/equipes");

    const li = await openAdd("leger");

    expect((await option(li, "octocat/hello · à mettre à jour")).disabled).toBe(
      false,
    );
  });

  it("given a repo without the team, when the panel opens, then the project is read and offered as « octocat/hello » alone", async () => {
    const { calls } = stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
    });
    renderAt("/equipes");

    const li = await openAdd("leger");

    await waitFor(() => expect(calls.agentReads).toBeGreaterThan(0));
    expect((await option(li, "octocat/hello")).disabled).toBe(false);
  });

  it("given a successful add, when « C'est fait » is shown, then the result stays, the select is back on « Choisir un projet » and the project reads « déjà dans ce projet »", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
      repoTeams: [],
    });
    renderAt("/equipes");
    const li = await openAdd("leger");
    const select = li.getByRole("combobox", {
      name: "Projet",
    }) as HTMLSelectElement;
    await option(li, "octocat/hello");
    fireEvent.change(select, { target: { value: "5" } });

    fireEvent.click(li.getByRole("button", { name: "Ajouter" }));
    fireEvent.click(await li.findByRole("button", { name: "Faire le commit" }));

    expect(await screen.findByText(/C'est fait/)).toBeDefined();
    await waitFor(() => expect(select.value).toBe(""));
    expect(screen.getByText(/C'est fait/)).toBeDefined();
    expect(
      (await option(li, "octocat/hello · déjà dans ce projet")).disabled,
    ).toBe(true);
  });
});

describe("decision 074 B5: « Tes équipes » on the tab Agents of a project", () => {
  async function openTab() {
    renderAt("/projets/5/agents");
    return screen.findByRole("heading", { name: "Tes équipes" });
  }
  const buttons = (name: string) =>
    screen.getAllByRole("button", { name }) as HTMLButtonElement[];

  it("given a global team not in the repo, when the tab opens, then it is listed with « Ajouter au projet » and the click runs the add and reads the tab again", async () => {
    const { sent, calls } = stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["developer"],
    });
    await openTab();
    const reads = calls.agentReads;

    click("Ajouter au projet");
    const teams = within(
      screen
        .getByRole("heading", { name: "Tes équipes" })
        .closest("section") as HTMLElement,
    );
    fireEvent.click(
      await teams.findByRole("button", { name: "Faire le commit" }),
    );

    await waitFor(() => expect(applies(sent)).toHaveLength(1));
    const [body] = applies(sent);
    expect(body).toMatchObject({ name: "leger", before: null, after: TEAM });
    expect(sorted(body?.agents).map((a) => a.name)).toEqual([
      "reviewer",
      "test-writer",
    ]);
    await waitFor(() => expect(calls.agentReads).toBeGreaterThan(reads));
    expect(await screen.findByText(/C'est fait/)).toBeDefined();
    expect(await screen.findByRole("button", { name: "leger" })).toBeDefined();
  });

  it("given the repo has a team of that name with another text, when the tab opens, then the button is « Mettre à jour dans le projet »", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
      repoTeams: [{ name: "leger", text: DOCS }],
    });
    await openTab();

    expect(buttons("Mettre à jour dans le projet")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Ajouter au projet" }),
    ).toBeNull();
  });

  it("given the repo has the same team, when the tab opens, then « Déjà dans le projet » is shown without a button", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      repoAgents: ["test-writer", "developer", "reviewer"],
      repoTeams: [{ name: "leger", text: TEAM }],
    });
    await openTab();

    expect(screen.getByText("Déjà dans le projet")).toBeDefined();
    expect(
      screen.queryByRole("button", {
        name: /Ajouter au projet|Mettre à jour dans le projet/,
      }),
    ).toBeNull();
  });

  it("given an archived project, when the tab opens, then the add button is disabled", async () => {
    stubApi({
      teams: [{ id: 1, name: "leger", text: TEAM }],
      archived: true,
    });
    await openTab();

    expect(buttons("Ajouter au projet").every((b) => b.disabled)).toBe(true);
  });
});

const PLAN_SENTENCE =
  "Ton abonnement Gratuit couvre 2 équipes d'agents. Passe à Pro pour en ajouter.";
const twoTeams = [
  { id: 1, name: "leger", text: TEAM },
  { id: 2, name: "lourd", text: TEAM },
];

describe("decision 082 E: the limit of the teams on /equipes", () => {
  const newButton = () =>
    screen.getByRole("button", {
      name: "Nouvelle équipe",
    }) as HTMLButtonElement;

  it("given a Free account (teamLimit 2) with 2 teams, when /equipes opens, then « Nouvelle équipe » is disabled and the sentence with the link « Abonnement » is shown", async () => {
    stubApi({ teams: twoTeams, teamLimit: 2 });

    renderAt("/equipes");

    await screen.findByText("lourd");
    await screen.findByText(PLAN_SENTENCE, { exact: false });
    expect(newButton().disabled).toBe(true);
    expect(
      screen.getByRole("link", { name: "Abonnement" }).getAttribute("href"),
    ).toBe("/reglages/abonnement");
  });

  it("given a Free account with 1 team, when /equipes opens, then « Nouvelle équipe » is enabled and the sentence is absent", async () => {
    stubApi({ teams: twoTeams.slice(0, 1), teamLimit: 2 });

    renderAt("/equipes");

    await screen.findByText("leger");
    await waitFor(() => expect(newButton().disabled).toBe(false));
    expect(screen.queryByText(/Passe à Pro pour en ajouter/)).toBeNull();
  });

  it("given a Pro account (teamLimit null) with 3 teams, when /equipes opens, then « Nouvelle équipe » is enabled and the sentence is absent", async () => {
    stubApi({
      teams: [...twoTeams, { id: 3, name: "moyen", text: TEAM }],
      teamLimit: null,
    });

    renderAt("/equipes");

    await screen.findByText("moyen");
    expect(newButton().disabled).toBe(false);
    expect(screen.queryByText(/Passe à Pro pour en ajouter/)).toBeNull();
  });

  it("given the canvas open for a new team and a server that answers 403 plan, when the team is created, then the canvas shows the sentence in its alert", async () => {
    stubApi({
      teams: twoTeams.slice(0, 1),
      teamLimit: 2,
      putAnswer: { status: 403, body: { error: "plan" } },
    });
    renderAt("/equipes");
    await screen.findByText("leger");
    await waitFor(() => expect(newButton().disabled).toBe(false));
    click("Nouvelle équipe");
    const ui = within(
      await screen.findByRole("dialog", { name: /^Nouvelle équipe/ }),
    );
    fireEvent.change(ui.getByLabelText("Nom de l'équipe"), {
      target: { value: "troisieme" },
    });

    fireEvent.click(
      ui.getByRole("button", { name: /^(Créer l'équipe|Enregistrer)$/ }),
    );

    const alert = await ui.findByRole("alert");
    expect(alert.textContent).toContain(PLAN_SENTENCE);
  });
});
