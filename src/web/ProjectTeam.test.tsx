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
import { readTeam } from "./team-file.ts";

// Slice E3 (decision 031 A, B, D to H): the section « Équipe » of the tab « Agents » (/projets/:id/agents).
//
// Pinned where the decision leaves it open:
// - GET /api/projects/:id/agents answers { agents, catalog, team: <text | null> } (server tests: team-routes.test.ts).
// - A card (the React Flow node) is an element with data-testid="team-card-<agent>" holding the agent name, its model (or « Celui de la session »), its `does`, and « Agent absent du repo » when the agent is not in the repo.
//   Clicking the card opens the step panel, as « Modifier » does. Whether React Flow draws in jsdom (ResizeObserver, DOMMatrix, getBoundingClientRect) is the developer's setup problem: nothing is stubbed here.
// - Decision 042 A to C: there is no list of steps and no « Monter » / « Descendre » / « Modifier » / « Ajouter une étape ». Everything is on the graph, shown at every width.
//   A card is focusable: Alt+ArrowRight / Alt+ArrowLeft move it one place, Enter opens its panel, Delete removes it; a polite live region (aria-live="polite") announces « <agent> : étape N sur M ».
//   A help text under the graph names « Alt », « Entrée » and « Suppr ». A loop made by a link is created at once with the condition « l'étape <cible> valide le travail » (the same default fills an empty condition in the panel).
//   Jsdom cannot drag a link between two handles: the loop is driven through the select « Boucle » of the step panel.
//   In the right column, every repo agent not in the team has a button « Ajouter <agent> à l'équipe » (visible text « Ajouter à l'équipe »), which appends it last.
// - The step panel (opened by a click on the card): a select « Agent » (repo agents not in the team, plus its own, option values = names), a text field « Ce qu'il fait », a select « Boucle » (value "" labelled « Aucune », then
//   the names of the earlier steps and of itself), a text field « Condition », and buttons « Retirer l'étape » (removes at once, with the warning for test-writer and reviewer) and « Modifier l'agent ».
// - « Voir les changements » shows the DiffList of team.md; « Faire le commit » is always rendered in the section and is enabled only with a difference, a step, and a condition on every loop; it posts to /api/projects/:id/team/apply.
//   The tests click « Voir les changements » (when it is enabled) before they look at « Faire le commit ».
// - After the commit: « C'est fait » with the commit link, and the agents (with team) are read again. Refusals are shown as in the agent editor.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Answer = { status: number; body: unknown };
type AgentFile = { name: string; text: string };

const agentText = (name: string, model?: string) =>
  `---\nname: ${name}\ndescription: ${name} agent\n${model ? `model: ${model}\n` : ""}---\nYou are ${name}.\n`;
const REPO_AGENTS: AgentFile[] = [
  { name: "test-writer", text: agentText("test-writer", "opus") },
  { name: "developer", text: agentText("developer", "sonnet") },
  { name: "reviewer", text: agentText("reviewer") },
  { name: "doc-writer", text: agentText("doc-writer") },
];
const TEAM = `---
steps:
  - agent: test-writer
    does: "writes the tests"
  - agent: developer
    does: "implements"
  - agent: reviewer
    does: "reviews the diff"
    loop_to: developer
    until: "the verdict is ready"
---
Body kept.
`;
const SHA = "a".repeat(40);
const COMMIT_URL = `https://github.com/octocat/hello/commit/${SHA}`;
const PR_URL = "https://github.com/octocat/hello/pull/3";
const SETTINGS_URL = "https://github.com/settings/apps/cockpit-test";
const REPO_CHANGED = "Le repo a changé entre-temps : regarde de nouveau";
const PROTECTED_SENTENCE =
  "La branche par défaut est protégée : une pull request est ouverte";
const SESSION_MODEL = "Celui de la session";
const TDD_WARNING = "Le TDD du CLAUDE.md du projet s'appuie sur cette étape";
const NOT_REWRITABLE =
  "Ce team.md contient des lignes que Cockpit ne sait pas réécrire : modifie-le sur GitHub";
const ABSENT = "Agent absent du repo";

const GREEN = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];

function stubApi(
  options: {
    agents?: AgentFile[];
    team?: string | null;
    reads?: Answer[];
    applies?: Answer[];
    archived?: boolean;
  } = {},
) {
  const reads = options.reads ?? [
    {
      status: 200,
      body: {
        agents: options.agents ?? REPO_AGENTS,
        catalog: [],
        team: options.team === undefined ? TEAM : options.team,
      },
    },
  ];
  const applies = options.applies ?? [
    { status: 200, body: { commitSha: SHA } },
  ];
  const calls = { reads: 0, applyBodies: [] as Record<string, unknown>[] };
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
      const reply = (answer: Answer) =>
        Response.json(answer.body, { status: answer.status });
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: options.archived ?? false,
            },
          ],
        });
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
        return Response.json({ lines: GREEN });
      if (path === "/api/projects/5/agents" && method === "GET") {
        const answer = reads[Math.min(calls.reads, reads.length - 1)];
        calls.reads++;
        return reply(answer as Answer);
      }
      if (path === "/api/projects/5/team/apply" && method === "POST") {
        const answer =
          applies[Math.min(calls.applyBodies.length, applies.length - 1)];
        calls.applyBodies.push(JSON.parse(String(init?.body)));
        return reply(answer as Answer);
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
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

const openTeam = async () => {
  renderAt("/projets/5/agents");
  await screen.findByRole("heading", { name: "Équipe" });
  // The right column lists the repo agents once the read is back.
  await screen.findByRole("button", { name: "Ouvrir developer" });
  // The graph is loaded lazily (031 limits): wait until it has replaced its fallback.
  await waitFor(() =>
    expect(screen.queryByText("Chargement du graphe…")).toBeNull(),
  );
};
const card = (agent: string) => screen.getByTestId(`team-card-${agent}`);
const cardAgents = () =>
  screen
    .getAllByTestId(/^team-card-/)
    .map((el) => el.getAttribute("data-testid")?.slice("team-card-".length));
const press = (agent: string, key: string, altKey = false) => {
  const target = card(agent);
  target.focus();
  fireEvent.keyDown(target, { key, altKey });
};
const later = (agent: string) => press(agent, "ArrowRight", true);
const earlier = (agent: string) => press(agent, "ArrowLeft", true);
const announcement = () =>
  Array.from(document.querySelectorAll('[aria-live="polite"]'))
    .map((el) => el.textContent ?? "")
    .join(" | ");
const addToTeam = (agent: string) =>
  fireEvent.click(
    screen.getByRole("button", { name: `Ajouter ${agent} à l'équipe` }),
  );
const click = (name: string, scope: HTMLElement | typeof screen = screen) =>
  fireEvent.click(
    (scope === screen ? screen : within(scope as HTMLElement)).getByRole(
      "button",
      { name },
    ),
  );
const edit = (agent: string) => fireEvent.click(card(agent));
const control = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const commitButton = () =>
  screen.getByRole("button", { name: "Faire le commit" }) as HTMLButtonElement;
const review = () => {
  const see = screen.getByRole("button", {
    name: "Voir les changements",
  }) as HTMLButtonElement;
  if (!see.disabled) fireEvent.click(see);
};
const diffItems = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "")
    .filter((t) => /Retirée|Ajoutée/.test(t));
const alertText = () => screen.getByRole("alert").textContent ?? "";
const posted = (calls: ReturnType<typeof stubApi>) => {
  const [sent] = calls.applyBodies;
  return {
    before: sent?.before,
    after: readTeam(String(sent?.after)),
    raw: String(sent?.after),
  };
};

describe("decision 031 B, F: the section Équipe", () => {
  it("given a valid team.md with three steps, when the tab opens, then a card per step shows the agent, its model and what it does, and there is no list of steps with « Monter » / « Descendre »", async () => {
    stubApi();

    await openTeam();

    expect(card("test-writer").textContent).toContain("test-writer");
    expect(card("test-writer").textContent).toContain("opus");
    expect(card("test-writer").textContent).toContain("writes the tests");
    expect(card("developer").textContent).toContain("sonnet");
    expect(card("reviewer").textContent).toContain(SESSION_MODEL);
    expect(card("reviewer").textContent).toContain("reviews the diff");
    expect(cardAgents()).toEqual(["test-writer", "developer", "reviewer"]);
    for (const name of ["Monter", "Descendre", "Modifier"])
      expect(screen.queryAllByRole("button", { name })).toEqual([]);
  });

  it("given a team of three steps, when the tab opens, then the graph is not hidden at any width (no hidden class on the card or its ancestors)", async () => {
    stubApi();

    await openTeam();

    for (
      let el: HTMLElement | null = card("developer");
      el;
      el = el.parentElement
    )
      expect(
        el.classList.contains("hidden"),
        `${el.tagName}.${el.className}`,
      ).toBe(false);
  });

  it("given team null, when the tab opens, then the three default steps are shown and a step whose agent is not in the repo is marked « Agent absent du repo »", async () => {
    stubApi({
      team: null,
      agents: REPO_AGENTS.filter((a) => a.name !== "test-writer"),
    });

    await openTeam();

    expect(cardAgents()).toEqual(["test-writer", "developer", "reviewer"]);
    expect(card("test-writer").textContent).toContain(ABSENT);
    expect(card("developer").textContent).not.toContain(ABSENT);
    expect(card("reviewer").textContent).not.toContain(ABSENT);
  });
});

describe("decision 031 D: the step panel", () => {
  it("given a click on a card, when the panel opens, then it shows the agent select limited to free repo agents plus its own, what it does, the loop choices and the condition", async () => {
    stubApi();
    await openTeam();

    edit("developer");

    const agents = within(control("Agent")).getAllByRole("option");
    expect(agents.map((o) => (o as HTMLOptionElement).value).sort()).toEqual([
      "developer",
      "doc-writer",
    ]);
    expect(control("Agent").value).toBe("developer");
    expect(control("Ce qu'il fait").value).toBe("implements");
    const loops = within(control("Boucle")).getAllByRole("option");
    expect(loops.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "",
      "test-writer",
      "developer",
    ]);
    expect(loops[0]?.textContent).toBe("Aucune");
    expect(control("Boucle").value).toBe("");
    expect(
      screen.getByRole("button", { name: "Retirer l'étape" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Modifier l'agent" }),
    ).toBeDefined();
  });

  it("given a click on a card, when it is clicked, then the same panel opens", async () => {
    stubApi();
    await openTeam();

    fireEvent.click(card("developer"));

    expect(control("Ce qu'il fait").value).toBe("implements");
  });

  it("given the panel of the reviewer, when it opens, then the loop is developer with its condition", async () => {
    stubApi();
    await openTeam();

    edit("reviewer");

    expect(control("Boucle").value).toBe("developer");
    expect(control("Condition").value).toBe("the verdict is ready");
  });

  it("given what developer does changed in the panel, when the diff is seen and the commit made, then { before: the text read, after } is posted with only that step changed and the body kept, then « C'est fait » with the commit link and the data is read again", async () => {
    const calls = stubApi();
    await openTeam();
    edit("developer");

    fireEvent.change(control("Ce qu'il fait"), {
      target: { value: "implements it" },
    });
    review();

    const items = diffItems();
    expect(items).toHaveLength(2);
    expect(items.find((t) => t.includes('"implements"'))).toMatch(/Retirée/);
    expect(items.find((t) => t.includes('"implements it"'))).toMatch(/Ajoutée/);
    expect(commitButton().disabled).toBe(false);
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { before: TEAM, after: TEAM.replace('"implements"', '"implements it"') },
    ]);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === COMMIT_URL),
    ).toBe(true);
    await waitFor(() => expect(calls.reads).toBe(2));
  });

  it("given a loop chosen with a condition, when the commit is made, then loop_to and until are written", async () => {
    const calls = stubApi();
    await openTeam();
    edit("developer");

    fireEvent.change(control("Boucle"), { target: { value: "test-writer" } });
    fireEvent.change(control("Condition"), {
      target: { value: "tests agree" },
    });
    review();
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps[1]).toEqual({
      agent: "developer",
      does: "implements",
      loopTo: "test-writer",
      until: "tests agree",
    });
  });

  it.each(["test-writer", "reviewer"])(
    "given the step %s removed, when « Retirer l'étape » is clicked, then the step goes, the TDD warning is shown and the commit is not blocked",
    async (agent) => {
      stubApi();
      await openTeam();
      edit(agent);

      click("Retirer l'étape");

      expect(screen.getByText(TDD_WARNING)).toBeDefined();
      expect(cardAgents()).not.toContain(agent);
      review();
      expect(commitButton().disabled).toBe(false);
    },
  );

  it("given the developer removed, when the loop pointing to it is looked at, then the reviewer has no loop and there is no TDD warning", async () => {
    const calls = stubApi();
    await openTeam();
    edit("developer");

    click("Retirer l'étape");

    expect(screen.queryByText(TDD_WARNING)).toBeNull();
    review();
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps).toEqual([
      expect.objectContaining({ agent: "test-writer" }),
      { agent: "reviewer", does: "reviews the diff", loopTo: null, until: "" },
    ]);
  });
});

describe("decision 042 C: adding an agent from the right column", () => {
  it("given repo agents not in the team, when the tab opens, then only they have « Ajouter <agent> à l'équipe », and « Ajouter une étape » is gone", async () => {
    stubApi();

    await openTeam();

    expect(
      screen.getByRole("button", { name: "Ajouter doc-writer à l'équipe" }),
    ).toBeDefined();
    for (const agent of ["test-writer", "developer", "reviewer"])
      expect(
        screen.queryByRole("button", { name: `Ajouter ${agent} à l'équipe` }),
      ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Ajouter une étape" }),
    ).toBeNull();
  });

  it("given « Ajouter doc-writer à l'équipe », when it is clicked, then the step is last, its button is gone and the posted after ends with it", async () => {
    const calls = stubApi();
    await openTeam();

    addToTeam("doc-writer");

    await waitFor(() =>
      expect(cardAgents()).toEqual([
        "test-writer",
        "developer",
        "reviewer",
        "doc-writer",
      ]),
    );
    expect(
      screen.queryByRole("button", { name: "Ajouter doc-writer à l'équipe" }),
    ).toBeNull();
    review();
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps.map((s) => s.agent)).toEqual([
      "test-writer",
      "developer",
      "reviewer",
      "doc-writer",
    ]);
  });
});

describe("decision 042 A: the keyboard on the cards", () => {
  it("given a card, when it is looked at, then it is focusable", async () => {
    stubApi();
    await openTeam();

    for (const agent of ["test-writer", "developer", "reviewer"]) {
      expect(card(agent).tabIndex).toBeGreaterThanOrEqual(0);
      card(agent).focus();
      expect(document.activeElement).toBe(card(agent));
    }
  });

  it("given the developer focused, when Alt+ArrowRight is pressed, then it is last, the live region says « developer : étape 3 sur 3 » and the reviewer's loop to it no longer points back and is removed", async () => {
    const calls = stubApi();
    await openTeam();

    later("developer");

    await waitFor(() =>
      expect(cardAgents()).toEqual(["test-writer", "reviewer", "developer"]),
    );
    expect(announcement()).toContain("developer : étape 3 sur 3");
    review();
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps.map((s) => s.agent)).toEqual([
      "test-writer",
      "reviewer",
      "developer",
    ]);
    expect(posted(calls).after?.steps[1]).toMatchObject({
      agent: "reviewer",
      loopTo: null,
    });
  });

  it("given the developer focused, when Alt+ArrowLeft is pressed, then it is first with « developer : étape 1 sur 3 », and the reviewer's loop (to developer) still points back", async () => {
    const calls = stubApi();
    await openTeam();

    earlier("developer");

    await waitFor(() =>
      expect(cardAgents()).toEqual(["developer", "test-writer", "reviewer"]),
    );
    expect(announcement()).toContain("developer : étape 1 sur 3");
    review();
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps.map((s) => s.agent)).toEqual([
      "developer",
      "test-writer",
      "reviewer",
    ]);
    expect(posted(calls).after?.steps[2]).toMatchObject({
      loopTo: "developer",
      until: "the verdict is ready",
    });
  });

  it("given the first card with Alt+ArrowLeft and the last with Alt+ArrowRight, when they are pressed, then nothing moves and nothing is announced or committable", async () => {
    stubApi();
    await openTeam();

    earlier("test-writer");
    later("reviewer");

    expect(cardAgents()).toEqual(["test-writer", "developer", "reviewer"]);
    expect(announcement()).not.toMatch(/étape \d+ sur/);
    review();
    expect(commitButton().disabled).toBe(true);
  });

  it("given a card focused, when ArrowRight is pressed without Alt, then nothing moves", async () => {
    stubApi();
    await openTeam();

    press("developer", "ArrowRight");

    expect(cardAgents()).toEqual(["test-writer", "developer", "reviewer"]);
  });

  it("given a card focused, when Enter is pressed, then the step panel opens like a click", async () => {
    stubApi();
    await openTeam();

    press("developer", "Enter");

    expect(control("Ce qu'il fait").value).toBe("implements");
  });

  it.each(["test-writer", "reviewer"])(
    "given the %s card focused, when Delete is pressed, then the step goes and the TDD warning is shown",
    async (agent) => {
      stubApi();
      await openTeam();

      press(agent, "Delete");

      expect(cardAgents()).not.toContain(agent);
      expect(screen.getByText(TDD_WARNING)).toBeDefined();
    },
  );

  it("given the developer card focused, when Delete is pressed, then the step goes, the reviewer has no loop and there is no TDD warning", async () => {
    const calls = stubApi();
    await openTeam();

    press("developer", "Delete");

    expect(cardAgents()).toEqual(["test-writer", "reviewer"]);
    expect(screen.queryByText(TDD_WARNING)).toBeNull();
    review();
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps[1]).toMatchObject({
      agent: "reviewer",
      loopTo: null,
    });
  });

  it("given the graph, when the page is read, then a help text under it names the keys Alt, Entrée and Suppr", async () => {
    stubApi();
    await openTeam();

    const help = screen.getByText(
      (text) => /Alt/.test(text) && /Entrée/.test(text) && /Suppr/.test(text),
    );
    expect(
      card("developer").compareDocumentPosition(help) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("decision 042 A: focus follows the card (review)", () => {
  const helpText = () =>
    screen.getByText(
      (text) => /Alt/.test(text) && /Entrée/.test(text) && /Suppr/.test(text),
    );
  const focusIs = (el: HTMLElement) =>
    waitFor(() => expect(document.activeElement).toBe(el));

  it("given the developer card focused, when Alt+ArrowRight is pressed, then the developer card, now third, keeps the focus, and once last it still does", async () => {
    stubApi();
    await openTeam();

    later("developer");

    await waitFor(() =>
      expect(cardAgents()).toEqual(["test-writer", "reviewer", "developer"]),
    );
    await focusIs(card("developer"));
    later("developer");
    expect(cardAgents()).toEqual(["test-writer", "reviewer", "developer"]);
    await focusIs(card("developer"));
  });

  it("given the developer card focused, when Alt+ArrowLeft is pressed, then the developer card keeps the focus, and once first it still does", async () => {
    stubApi();
    await openTeam();

    earlier("developer");

    await waitFor(() =>
      expect(cardAgents()).toEqual(["developer", "test-writer", "reviewer"]),
    );
    await focusIs(card("developer"));
    earlier("developer");
    expect(cardAgents()).toEqual(["developer", "test-writer", "reviewer"]);
    await focusIs(card("developer"));
  });

  it("given the developer card focused, when Delete is pressed, then the focus goes to the card now at its position (the reviewer)", async () => {
    stubApi();
    await openTeam();

    press("developer", "Delete");

    expect(cardAgents()).toEqual(["test-writer", "reviewer"]);
    await focusIs(card("reviewer"));
  });

  it("given the last card focused, when Delete is pressed, then the focus goes to the previous card", async () => {
    stubApi();
    await openTeam();

    press("reviewer", "Delete");

    expect(cardAgents()).toEqual(["test-writer", "developer"]);
    await focusIs(card("developer"));
  });

  it("given a team of one step, when Delete is pressed on its card, then the focus goes to the help text under the graph", async () => {
    stubApi({
      team: '---\nsteps:\n  - agent: developer\n    does: "implements"\n---\n',
    });
    await openTeam();

    press("developer", "Delete");

    expect(screen.queryAllByTestId(/^team-card-/)).toEqual([]);
    await focusIs(helpText());
  });

  it("given a card focused, when Backspace is pressed, then the step is removed like with Delete", async () => {
    stubApi();
    await openTeam();

    press("developer", "Backspace");

    expect(cardAgents()).toEqual(["test-writer", "reviewer"]);
    await focusIs(card("reviewer"));
  });

  it("given the panel of the developer, when « Retirer l'étape » is clicked, then the focus goes to the card at that position (the reviewer)", async () => {
    stubApi();
    await openTeam();
    edit("developer");

    click("Retirer l'étape");

    expect(cardAgents()).toEqual(["test-writer", "reviewer"]);
    await focusIs(card("reviewer"));
  });

  it("given the panel of the last step, when « Retirer l'étape » is clicked, then the focus goes to the previous card", async () => {
    stubApi();
    await openTeam();
    edit("reviewer");

    click("Retirer l'étape");

    await focusIs(card("developer"));
  });

  it("given the panel of the only step, when « Retirer l'étape » is clicked, then the focus goes to the help text", async () => {
    stubApi({
      team: '---\nsteps:\n  - agent: developer\n    does: "implements"\n---\n',
    });
    await openTeam();
    edit("developer");

    click("Retirer l'étape");

    expect(screen.queryAllByTestId(/^team-card-/)).toEqual([]);
    await focusIs(helpText());
  });

  it("given an agent form open (« Ouvrir » on a repo agent), when the right column is looked at, then it shows no « Ajouter … à l'équipe » button", async () => {
    stubApi();
    await openTeam();
    expect(
      screen.getByRole("button", { name: "Ajouter doc-writer à l'équipe" }),
    ).toBeDefined();

    click("Ouvrir doc-writer");

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Ajouter .* à l'équipe$/ }),
      ).toBeNull(),
    );
  });
});

describe("decision 042 B: a loop gets its condition at once", () => {
  it.each(["test-writer", "developer"])(
    "given a loop to %s chosen in the panel of the developer with an empty condition, when it is chosen, then the condition is « l'étape <target> valide le travail » and it is posted with loop_to and until",
    async (target) => {
      const calls = stubApi();
      await openTeam();
      edit("developer");

      fireEvent.change(control("Boucle"), { target: { value: target } });

      const until = `l'étape ${target} valide le travail`;
      expect(control("Condition").value).toBe(until);
      expect(screen.queryByLabelText("Condition de la boucle")).toBeNull();
      review();
      fireEvent.click(commitButton());
      await screen.findByText(/C'est fait/);
      expect(posted(calls).after?.steps[1]).toEqual({
        agent: "developer",
        does: "implements",
        loopTo: target,
        until,
      });
    },
  );
});

describe("decision 031 H: the commit", () => {
  it("given the team as read and untouched, when the tab opens, then « Faire le commit » is disabled", async () => {
    stubApi();
    await openTeam();

    review();

    expect(commitButton().disabled).toBe(true);
  });

  it("given team null, when the tab opens, then the diff shows the whole file as added and the commit posts before: null with the default steps", async () => {
    const calls = stubApi({ team: null });
    await openTeam();

    review();

    const items = diffItems();
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.every((t) => /Ajoutée/.test(t) && !/Retirée/.test(t))).toBe(
      true,
    );
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies[0]?.before).toBeNull();
    expect(posted(calls).after?.steps.map((s) => s.agent)).toEqual([
      "test-writer",
      "developer",
      "reviewer",
    ]);
  });

  it("given every step removed, when the diff is looked at, then « Faire le commit » is disabled", async () => {
    stubApi();
    await openTeam();
    for (const agent of ["reviewer", "developer", "test-writer"]) {
      edit(agent);
      click("Retirer l'étape");
    }

    review();

    expect(commitButton().disabled).toBe(true);
  });

  it("given a loop without condition, when the condition is emptied, then « Faire le commit » is disabled", async () => {
    stubApi();
    await openTeam();
    edit("reviewer");

    fireEvent.change(control("Condition"), { target: { value: "" } });
    review();

    expect(commitButton().disabled).toBe(true);
  });

  it("given a protected default branch, when the commit is made, then the page says a pull request is open and links to it", async () => {
    stubApi({
      applies: [
        {
          status: 200,
          body: { commitSha: SHA, pullRequest: { number: 3, url: PR_URL } },
        },
      ],
    });
    await openTeam();
    later("test-writer");
    review();

    fireEvent.click(commitButton());

    await screen.findByText(PROTECTED_SENTENCE);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === PR_URL),
    ).toBe(true);
  });

  it("given repo_changed, when the commit is made, then the message is shown and the data is read again", async () => {
    const calls = stubApi({
      applies: [{ status: 409, body: { error: "repo_changed" } }],
    });
    await openTeam();
    later("test-writer");
    review();

    fireEvent.click(commitButton());

    await screen.findByText(REPO_CHANGED);
    await waitFor(() => expect(calls.reads).toBe(2));
  });

  it("given pull_request_forbidden, when the commit is made, then a French alert about « Pull requests » links to the settings of the App", async () => {
    stubApi({
      applies: [
        {
          status: 409,
          body: {
            error: "pull_request_forbidden",
            appSettingsUrl: SETTINGS_URL,
          },
        },
      ],
    });
    await openTeam();
    later("test-writer");
    review();

    fireEvent.click(commitButton());

    await screen.findByRole("alert");
    expect(alertText()).toMatch(/Pull requests/);
    expect(alertText()).not.toContain("pull_request_forbidden");
    expect(
      within(screen.getByRole("alert"))
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === SETTINGS_URL),
    ).toBe(true);
  });

  it("given an archived project, when the tab opens, then « Faire le commit » and « Ajouter doc-writer à l'équipe » are disabled", async () => {
    const calls = stubApi({ archived: true });
    await openTeam();
    later("test-writer");
    review();

    expect(commitButton().disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Ajouter doc-writer à l'équipe",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(commitButton());
    expect(calls.applyBodies).toEqual([]);
  });
});

describe("decision 031 G: a team.md Cockpit cannot rewrite", () => {
  it("given a comment line in the front matter, when the tab opens, then the sentence is shown and no card, no commit", async () => {
    stubApi({
      team: "---\n# why\nsteps:\n  - agent: developer\n---\n",
    });
    await openTeam();

    expect(screen.getByText(NOT_REWRITABLE)).toBeDefined();
    expect(screen.queryByTestId("team-card-developer")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Monter" })).toEqual([]);
    expect(screen.queryAllByRole("button", { name: "Modifier" })).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Faire le commit" }),
    ).toBeNull();
  });
});

describe("decision 029 demo: adding doc-writer after developer", () => {
  it("given the agents test-writer, developer, reviewer, doc-writer and no team.md, when I add doc-writer, move it one place earlier and commit, then the posted after lists test-writer, developer, doc-writer, reviewer with reviewer looping to developer", async () => {
    const calls = stubApi({ team: null });
    await openTeam();

    addToTeam("doc-writer");
    await screen.findByTestId("team-card-doc-writer");
    earlier("doc-writer");
    review();
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toHaveLength(1);
    expect(calls.applyBodies[0]?.before).toBeNull();
    const { after } = posted(calls);
    expect(after?.steps.map((s) => s.agent)).toEqual([
      "test-writer",
      "developer",
      "doc-writer",
      "reviewer",
    ]);
    expect(after?.steps[3]).toMatchObject({
      loopTo: "developer",
      until: "the verdict is ready",
    });
  });
});

describe("decision 031 D: renaming the agent of a step", () => {
  it("given a step looping to itself, when its agent is changed in the panel, then its loop follows the new name and the select keeps the focus", async () => {
    const calls = stubApi({
      team: '---\nsteps:\n  - agent: doc-writer\n    does: "writes"\n    loop_to: doc-writer\n    until: "docs build"\n---\n',
      agents: [...REPO_AGENTS, { name: "auditor", text: agentText("auditor") }],
    });
    await openTeam();
    edit("doc-writer");
    control("Agent").focus();

    fireEvent.change(control("Agent"), { target: { value: "auditor" } });

    expect(control("Boucle").value).toBe("auditor");
    expect(document.activeElement).toBe(control("Agent"));
    review();
    fireEvent.click(commitButton());
    await screen.findByText(/C'est fait/);
    expect(posted(calls).after?.steps).toEqual([
      {
        agent: "auditor",
        does: "writes",
        loopTo: "auditor",
        until: "docs build",
      },
    ]);
  });
});

describe("decision 031 H: a team.md that Cockpit would only reformat", () => {
  it("given a team.md with bare values, when the tab opens, then « Faire le commit » and « Voir les changements » are disabled", async () => {
    stubApi({
      team: "---\nsteps:\n  - agent: developer\n    does: implements\n\n  - agent: reviewer\n    does: reviews\n    loop_to: developer\n    until: the verdict is ready\n---\nBody",
    });
    await openTeam();

    expect(commitButton().disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Voir les changements",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
