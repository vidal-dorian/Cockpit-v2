// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { readTeam } from "./team-file.ts";

// Slice E6 (decision 079 D to F): the team canvas of the tab « Agents » (/projets/:id/agents). React Flow does not draw in jsdom: everything goes through the palette, the keyboard list and the panel.
//
// Pinned where the decision leaves it open (the developer builds these):
// - The canvas is a `dialog` named « Nouvelle équipe · <name field> » or « Modifier l'équipe · <name> ». It contains: the field « Nom de l'équipe », the text « brouillon », the summary of 079 D2, « Défaire », « Refaire », « Annuler », « Créer l'équipe » (« Enregistrer » when editing).
// - The palette: a search field with the accessible name « Chercher un agent… » (role textbox), then two groups (role `group`, accessible name « Agents du repo » and « Catalogue de Cockpit »); each agent is a button named after the agent; a click adds it as the last step.
//   « Catalogue de Cockpit » lists the agents of GET /api/starter-teams that the repo lacks.
// - A new team starts from the team shown, as read from the repo (042, unchanged).
// - The keyboard list is the one of 031: one `li` per step with « Monter », « Descendre », « Modifier »; « Modifier » selects the step and shows the panel (a region of the dialog) whose heading is « Étape sélectionnée ».
// - The step panel fields (labels): « Nom de l'étape » (text), « Consigne pour cette étape » (text), « En même temps que l'étape d'avant » (checkbox), « Quand plusieurs liens arrivent » (select, options « Attendre tous » / « Le premier suffit », shown on a step of a group, it sets `wait` on the first step of the group),
//   « Boucle » (select, « Aucune » first, then the keys of the steps of a previous group and of itself), « Quand suivre ce lien » (select of the four choices of 079 C, labelled « Si le <agent> bloque », « Si les tests échouent »... exactly as in the decision), « Jusqu'à ce que » (text, only for « Une condition à toi »), « Au plus » (number, 3 by default), the sentence « Si la limite est atteinte, Claude s'arrête et te pose la question ».
// - With nothing selected the panel shows « Ce que Cockpit vérifie », « Le fichier qui sera écrit » with `.claude/teams/<nom>.md` (the typed name once there is one) and `--team <nom>`.
// - The Agents tab: « Modifier sur le canevas » (button) and, for a team with a group or an `id`, the sentence « Cette équipe a des étapes en parallèle : modifie-la sur le canevas. » instead of the graph, the list and the « Graphe » / « Liste » switch.

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

type Answer = { status: number; body: unknown };
const agentText = (name: string, level = "repo") =>
  `---\nname: ${name}\ndescription: ${name} from ${level}\n---\nYou are ${name}.\n`;
const REPO_AGENTS = ["test-writer", "developer", "reviewer", "doc-writer"].map(
  (name) => ({ name, text: agentText(name) }),
);
const STARTERS = [
  {
    id: "max",
    team: "---\nsteps:\n  - agent: developer\n---\n",
    agents: [
      "test-writer",
      "developer",
      "reviewer",
      "doc-writer",
      "security-reviewer",
    ].map((name) => ({ name, text: agentText(name, "max") })),
  },
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
    max: 3
---
Body kept.
`;
const GROUP = `---
steps:
  - agent: developer
    does: "the screen"
  - agent: developer
    id: server
    does: "the server"
    parallel: true
---
`;
const SHA = "a".repeat(40);

function stubApi(
  options: {
    team?: string | null;
    teams?: { name: string; text: string }[];
    /** The teams read once a save was answered (the repo changed meanwhile). */
    teamsAfter?: { name: string; text: string }[];
    applies?: Answer[];
  } = {},
) {
  const calls = { applyBodies: [] as Record<string, unknown>[], reads: 0 };
  const read = () => ({
    agents: REPO_AGENTS,
    catalog: [],
    team: options.team === undefined ? TEAM : options.team,
    teams:
      calls.applyBodies.length > 0 && options.teamsAfter
        ? options.teamsAfter
        : (options.teams ?? []),
  });
  const applies = options.applies ?? [
    { status: 200, body: { commitSha: SHA } },
  ];
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
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
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
      if (path === "/api/starter-teams")
        return Response.json({ teams: STARTERS });
      if (path === "/api/projects/5/agents" && method === "GET") {
        calls.reads++;
        return Response.json(read());
      }
      if (path === "/api/projects/5/team/apply" && method === "POST") {
        const answer = applies[
          Math.min(calls.applyBodies.length, applies.length - 1)
        ] as Answer;
        calls.applyBodies.push(JSON.parse(String(init?.body)));
        return Response.json(answer.body, { status: answer.status });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

async function openTab() {
  window.history.replaceState({}, "", "/projets/5/agents");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Équipe" });
}
async function openCanvas() {
  await openTab();
  fireEvent.click(screen.getByRole("button", { name: "Nouvelle équipe" }));
  const box = await screen.findByRole("dialog", { name: /^Nouvelle équipe ·/ });
  // The catalogue comes from a query: wait for it.
  await within(box).findByRole("button", { name: "security-reviewer" });
  return box;
}
const ui = () => within(screen.getByRole("dialog"));
const group = (name: string) => within(ui().getByRole("group", { name }));
const addFromPalette = (agent: string, from = "Agents du repo") =>
  fireEvent.click(group(from).getByRole("button", { name: agent }));
const rows = () =>
  ui()
    .getAllByRole("listitem")
    .filter((li) => within(li).queryByRole("button", { name: "Monter" }))
    .map((li) => /^\s*\d+\s*([a-z0-9-]+)/.exec(li.textContent ?? "")?.[1]);
const rowAt = (i: number) =>
  ui()
    .getAllByRole("listitem")
    .filter((li) => within(li).queryByRole("button", { name: "Monter" }))[
    i
  ] as HTMLElement;
const select = (i: number) =>
  fireEvent.click(within(rowAt(i)).getByRole("button", { name: "Modifier" }));
const field = (label: string) => ui().getByLabelText(label) as HTMLInputElement;
const typeName = (value: string) =>
  fireEvent.change(field("Nom de l'équipe"), { target: { value } });
async function openEditCanvas() {
  await openTab();
  fireEvent.click(await screen.findByRole("button", { name: "leger" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Modifier sur le canevas" }),
  );
  await screen.findByRole("dialog", { name: /^Modifier l'équipe · leger/ });
  await ui().findByRole("button", { name: "doc-writer" });
}
const create = () =>
  ui().getByRole("button", { name: "Créer l'équipe" }) as HTMLButtonElement;

describe("decision 079 D2, D3, D6: the canvas of a new team", () => {
  it("given the Agents tab, when « Nouvelle équipe » is clicked, then a full-screen dialog opens with the header, the draft badge, the summary and its buttons", async () => {
    stubApi();
    await openCanvas();

    expect(
      screen.getByRole("dialog", { name: /^Nouvelle équipe ·/ }),
    ).toBeDefined();
    expect(field("Nom de l'équipe").value).toBe("");
    expect(ui().getByText("brouillon")).toBeDefined();
    expect(ui().getByText("3 étapes · 1 boucle")).toBeDefined();
    expect(ui().getByRole("button", { name: "Annuler" })).toBeDefined();
    expect(create()).toBeDefined();
  });

  it("given the canvas, when the left column is read, then it has the search, « Agents du repo » and « Catalogue de Cockpit » with the catalogue agents the repo lacks, and typing filters both lists by name", async () => {
    stubApi();
    await openCanvas();

    expect(
      ui().getByRole("textbox", { name: "Chercher un agent…" }),
    ).toBeDefined();
    const repo = group("Agents du repo");
    for (const name of ["test-writer", "developer", "reviewer", "doc-writer"])
      expect(repo.getByRole("button", { name })).toBeDefined();
    const catalogue = group("Catalogue de Cockpit");
    expect(
      catalogue.getByRole("button", { name: "security-reviewer" }),
    ).toBeDefined();
    expect(catalogue.queryByRole("button", { name: "developer" })).toBeNull();

    fireEvent.change(
      ui().getByRole("textbox", { name: "Chercher un agent…" }),
      {
        target: { value: "review" },
      },
    );

    expect(repo.queryByRole("button", { name: "developer" })).toBeNull();
    expect(repo.getByRole("button", { name: "reviewer" })).toBeDefined();
    expect(
      catalogue.getByRole("button", { name: "security-reviewer" }),
    ).toBeDefined();
  });

  it("given the canvas, when a palette agent is clicked, then it is the last step in the keyboard list", async () => {
    stubApi();
    await openCanvas();

    addFromPalette("doc-writer");

    expect(rows()).toEqual([
      "test-writer",
      "developer",
      "reviewer",
      "doc-writer",
    ]);
  });

  it("given an agent already in the team, when it is clicked in the palette again, then it is added with the id 2 and shown as « developer · 2 »", async () => {
    stubApi();
    await openCanvas();

    addFromPalette("developer");

    expect(rows()).toHaveLength(4);
    expect(rowAt(3).textContent).toContain("developer · 2");
  });

  it("given nothing selected, when the panel is read, then it shows what Cockpit checks, the file that will be written and the command", async () => {
    stubApi();
    await openCanvas();

    expect(ui().getByText("Ce que Cockpit vérifie")).toBeDefined();
    expect(
      ui().getByText("La boucle de reviewer a une limite : 3 fois"),
    ).toBeDefined();
    expect(ui().getByText("Le fichier qui sera écrit")).toBeDefined();
    expect(ui().getByText(/\.claude\/teams\/<nom>\.md/)).toBeDefined();
    expect(ui().getByText(/--team <nom>/)).toBeDefined();
    typeName("docs");
    expect(ui().getByText(/\.claude\/teams\/docs\.md/)).toBeDefined();
    expect(ui().getByText(/--team docs/)).toBeDefined();
  });
});

describe("decision 079 D6: the panel of a step", () => {
  it("given « Modifier » on the first step, when the panel opens, then it shows its fields and « En même temps que l'étape d'avant » is disabled", async () => {
    stubApi();
    await openCanvas();

    select(0);

    expect(ui().getByText("Étape sélectionnée")).toBeDefined();
    expect(field("Nom de l'étape")).toBeDefined();
    expect(field("Consigne pour cette étape").value).toBe("writes the tests");
    expect(field("En même temps que l'étape d'avant").disabled).toBe(true);
    expect(ui().getByRole("button", { name: "Retirer l'étape" })).toBeDefined();
    expect(ui().queryByLabelText("Quand plusieurs liens arrivent")).toBeNull();
  });

  it("given the second step made parallel, when its panel is read, then « Quand plusieurs liens arrivent » offers « Attendre tous » and « Le premier suffit », and the summary counts the group", async () => {
    stubApi();
    await openCanvas();
    select(1);

    fireEvent.click(field("En même temps que l'étape d'avant"));

    const wait = field(
      "Quand plusieurs liens arrivent",
    ) as unknown as HTMLSelectElement;
    expect(
      within(wait)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Attendre tous", "Le premier suffit"]);
    expect(
      ui().getByText("3 étapes · 2 en parallèle · 1 boucle"),
    ).toBeDefined();
    expect(
      ui().getByText(
        /Les branches test-writer et developer se rejoignent avant reviewer/,
      ),
    ).toBeDefined();
  });

  it("given the loop of the reviewer, when its panel opens, then it shows « Quand suivre ce lien », « Au plus » at 3 and the sentence about the limit", async () => {
    stubApi();
    await openCanvas();

    select(2);

    expect(field("Boucle").value).toBe("developer");
    expect(field("Quand suivre ce lien").value).not.toBe("");
    expect(field("Au plus").value).toBe("3");
    expect(
      ui().getByText(
        "Si la limite est atteinte, Claude s'arrête et te pose la question",
      ),
    ).toBeDefined();
  });

  it("given a catalogue agent added, when its step is selected, then the panel says it will be added to .claude/agents/ at the commit; a repo agent says « Agent du repo »", async () => {
    stubApi();
    await openCanvas();
    addFromPalette("security-reviewer", "Catalogue de Cockpit");

    select(3);

    expect(
      ui().getByText(
        "Agent du catalogue · sera ajouté à .claude/agents/ au commit.",
      ),
    ).toBeDefined();
    select(0);
    expect(ui().getByText(/Agent du repo/)).toBeDefined();
  });
});

describe("decision 079 E: creating the team", () => {
  it("given a valid name, a catalogue agent and a parallel step, when « Créer l'équipe » is clicked, then one POST carries { name, before: null, after, agents } with the catalogue text, the canvas closes and « C'est fait » shows", async () => {
    const calls = stubApi();
    await openCanvas();
    typeName("docs");
    addFromPalette("security-reviewer", "Catalogue de Cockpit");
    select(1);
    fireEvent.click(field("En même temps que l'étape d'avant"));
    expect(create().disabled).toBe(false);

    fireEvent.click(create());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    const [sent] = calls.applyBodies;
    expect(sent).toMatchObject({ name: "docs", before: null });
    expect(sent?.agents).toEqual([
      {
        name: "security-reviewer",
        before: null,
        after: agentText("security-reviewer", "max"),
      },
    ]);
    const written = readTeam(String(sent?.after));
    expect(written?.steps.map((s) => s.agent)).toEqual([
      "test-writer",
      "developer",
      "reviewer",
      "security-reviewer",
    ]);
    expect(written?.steps[1]?.parallel).toBe(true);
    await screen.findByText("C'est fait");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["no name", () => {}],
    ["an invalid name", () => typeName("Majuscule")],
  ])(
    "given %s, when the canvas is open, then « Créer l'équipe » is disabled",
    async (_n, act2) => {
      stubApi();
      await openCanvas();

      act2();

      expect(create().disabled).toBe(true);
    },
  );

  it("given a loop with « Une condition à toi » left empty, when the canvas is read, then « Créer l'équipe » is disabled and the check says the loop has no condition", async () => {
    stubApi();
    await openCanvas();
    typeName("docs");
    select(2);

    fireEvent.change(field("Quand suivre ce lien"), {
      target: { value: "Une condition à toi" },
    });
    fireEvent.change(field("Jusqu'à ce que"), { target: { value: "" } });

    expect(create().disabled).toBe(true);
    expect(
      ui().getByText("La boucle de reviewer n'a pas de condition"),
    ).toBeDefined();
  });

  it("given the loop with « Au plus » emptied, when the canvas is read, then « Créer l'équipe » is disabled and the check says the loop has no limit", async () => {
    stubApi();
    await openCanvas();
    typeName("docs");
    select(2);

    fireEvent.change(field("Au plus"), { target: { value: "" } });

    expect(create().disabled).toBe(true);
    expect(
      ui().getByText("La boucle de reviewer n'a pas de limite"),
    ).toBeDefined();
  });

  it("given the choice « Toujours », when the team is created, then until always is written with the limit", async () => {
    const calls = stubApi();
    await openCanvas();
    typeName("docs");
    select(2);
    fireEvent.change(field("Quand suivre ce lien"), {
      target: { value: "Toujours" },
    });

    fireEvent.click(create());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    expect(
      readTeam(String(calls.applyBodies[0]?.after))?.steps[2],
    ).toMatchObject({
      until: "always",
      max: 3,
    });
  });

  it.each([
    [409, { error: "repo_changed" }],
    [502, { error: "github_unavailable" }],
  ])(
    "given a POST answering %s, when it fails, then the error is inside the canvas, which stays open",
    async (status, body) => {
      const calls = stubApi({ applies: [{ status, body }] });
      await openCanvas();
      typeName("docs");

      fireEvent.click(create());

      await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
      expect(await ui().findByRole("alert")).toBeDefined();
      expect(screen.getByRole("dialog")).toBeDefined();
    },
  );

  it("given a typed name, when « Annuler » is clicked or the dialog closes like Escape does, then nothing is sent", async () => {
    const calls = stubApi();
    await openCanvas();
    typeName("docs");
    fireEvent.click(ui().getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Nouvelle équipe" }));
    await screen.findByRole("dialog", { name: /^Nouvelle équipe ·/ });
    act(() => (screen.getByRole("dialog") as HTMLDialogElement).close());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.applyBodies).toEqual([]);
  });
});

describe("decision 079 D5, D6: the gestures of the panel", () => {
  it("given the panel of the developer, when « Nom de l'étape » is changed, then the step is labelled with it and the loop that named developer follows the new key", async () => {
    const calls = stubApi();
    await openCanvas();
    typeName("docs");
    select(1);

    fireEvent.change(field("Nom de l'étape"), { target: { value: "impl" } });

    expect(rowAt(1).textContent).toContain("developer · impl");
    fireEvent.click(create());
    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    const written = readTeam(String(calls.applyBodies[0]?.after));
    expect(written?.steps[1]).toMatchObject({ agent: "developer", id: "impl" });
    expect(written?.steps[2]?.loopTo).toBe("impl");
  });

  it("given the panel of the developer, when « Retirer l'étape » is clicked, then the step is gone from the list", async () => {
    stubApi();
    await openCanvas();
    select(0);

    fireEvent.click(ui().getByRole("button", { name: "Retirer l'étape" }));

    expect(rows()).toEqual(["developer", "reviewer"]);
  });
});

describe("decision 079 D4: undo and redo", () => {
  it("given a step added, when « Défaire » then « Refaire » are clicked, then the draft goes back then forward", async () => {
    stubApi();
    await openCanvas();
    addFromPalette("doc-writer");
    expect(rows()).toHaveLength(4);

    fireEvent.click(ui().getByRole("button", { name: "Défaire" }));
    expect(rows()).toHaveLength(3);

    fireEvent.click(ui().getByRole("button", { name: "Refaire" }));
    expect(rows()).toHaveLength(4);
  });
});

describe("decision 079 D, F: the Agents tab", () => {
  it("given a team shown, when « Modifier sur le canevas » is clicked, then the canvas « Modifier l'équipe · <name> » opens and « Enregistrer » posts before = the repo text", async () => {
    const calls = stubApi({ teams: [{ name: "leger", text: TEAM }] });
    await openTab();
    fireEvent.click(await screen.findByRole("button", { name: "leger" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Modifier sur le canevas" }),
      ).toBeDefined(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Modifier sur le canevas" }),
    );

    await screen.findByRole("dialog", { name: /^Modifier l'équipe · leger/ });
    await ui().findByRole("button", { name: "doc-writer" });
    addFromPalette("doc-writer");
    fireEvent.click(ui().getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    expect(calls.applyBodies[0]).toMatchObject({ name: "leger", before: TEAM });
  });

  it("given the canvas opened on a named team, when « Enregistrer » is refused with repo_changed, the teams are read again with another text and « Enregistrer » is clicked again, then before is still the text read when the canvas opened", async () => {
    const changed = TEAM.replace("implements", "implements it");
    const calls = stubApi({
      teams: [{ name: "leger", text: TEAM }],
      teamsAfter: [{ name: "leger", text: changed }],
      applies: [{ status: 409, body: { error: "repo_changed" } }],
    });
    await openEditCanvas();
    fireEvent.click(ui().getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    await waitFor(() => expect(calls.reads).toBeGreaterThanOrEqual(2));
    await ui().findByRole("alert");

    fireEvent.click(ui().getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(calls.applyBodies).toHaveLength(2));
    expect(calls.applyBodies[0]?.before).toBe(TEAM);
    expect(calls.applyBodies[1]?.before).toBe(TEAM);
  });

  it("given an unsaved edit of the team shown in the tab, when « Modifier sur le canevas » is clicked, then the canvas opens with that edit and « Enregistrer » posts before = the repo text", async () => {
    const calls = stubApi();
    await openTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Ajouter une étape" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajouter à l'équipe" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Modifier sur le canevas" }),
    );

    await screen.findByRole("dialog", { name: /^Modifier l'équipe ·/ });
    expect(rows()).toEqual([
      "test-writer",
      "developer",
      "reviewer",
      "doc-writer",
    ]);
    fireEvent.click(ui().getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    expect(calls.applyBodies[0]?.before).toBe(TEAM);
    expect(
      readTeam(String(calls.applyBodies[0]?.after))?.steps.map((s) => s.agent),
    ).toEqual(["test-writer", "developer", "reviewer", "doc-writer"]);
  });

  it("given a team with a group and an id, when the tab opens, then the graph and the list are replaced by the sentence and « Modifier sur le canevas »", async () => {
    stubApi({ team: GROUP });

    await openTab();

    expect(
      await screen.findByText(
        "Cette équipe a des étapes en parallèle : modifie-la sur le canevas.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Modifier sur le canevas" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Monter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Liste" })).toBeNull();
  });
});
