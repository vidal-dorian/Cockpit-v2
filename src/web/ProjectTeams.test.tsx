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

// Slice E4 (decision 032 E): several teams in the section « Équipe » of the tab « Agents » (/projets/:id/agents). Builds on ProjectTeam.test.tsx (031).
//
// Pinned where the decision leaves it open:
// - GET /api/projects/:id/agents answers { agents, catalog, team, teams: [{ name, text }] } (server tests: teams.test.ts).
// - A select labelled « Équipe » (role combobox, name « Équipe »; the section itself is also labelled « Équipe », so getByLabelText would be ambiguous): the first option has value "" and the label « Par défaut (team.md) », then one option per named team (value and label = the name).
//   Choosing one loads its draft in the same cards (data-testid="team-card-<agent>") and list as in 031.
// - Switching with an unsaved change shows « Les changements non enregistrés seront perdus » with buttons « Confirmer le changement » and « Annuler »; nothing changes (select, draft) until the first one is clicked, and « Annuler » keeps both.
// - « Nouvelle équipe » reveals a text field « Nom de l'équipe » and a button « Créer l'équipe », disabled while the name is empty, invalid or taken. The messages are
//   « Nom invalide : lettres minuscules, chiffres et tirets, sans tiret au début » and « Ce nom est déjà pris ». Creating selects the new team (the select value is its name) with a copy of the steps shown; « Faire le commit » then posts { name, before: null, after }.
// - « Supprimer l'équipe » (absent for the default team) shows « L'équipe sera retirée du repo par un commit » with « Confirmer la suppression » and « Annuler »; confirming posts { name, before: <text read>, after: null }.
// - The command to copy is shown as text, for a named team only: `/dev-us <US> --team <name>` (the literal « <US> »).
// - A named team that Cockpit cannot rewrite shows the sentence of 031 (containing « modifie-le sur GitHub ») and no card, no commit; the select stays, and the other teams are not affected.
// - The commit of the default team posts no name, or name null.

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
  // jsdom 29 has neither: delete the stub instead of assigning undefined.
  if (realShowModal) HTMLDialogElement.prototype.showModal = realShowModal;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (realClose) HTMLDialogElement.prototype.close = realClose;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Answer = { status: number; body: unknown };

const agentText = (name: string) =>
  `---\nname: ${name}\ndescription: ${name} agent\n---\nYou are ${name}.\n`;
const REPO_AGENTS = ["test-writer", "developer", "reviewer", "doc-writer"].map(
  (name) => ({ name, text: agentText(name) }),
);
const team = (...steps: [string, string][]) =>
  `---\nsteps:\n${steps.map(([a, d]) => `  - agent: ${a}\n    does: "${d}"`).join("\n")}\n---\nBody kept.\n`;
const TEAM = team(
  ["test-writer", "writes the tests"],
  ["developer", "implements"],
  ["reviewer", "reviews the diff"],
);
const LEGER = team(
  ["developer", "implements lightly"],
  ["doc-writer", "documents"],
);
const BROKEN = "---\n# why\nsteps:\n  - agent: developer\n---\n";
const SHA = "a".repeat(40);
const LOST = "Les changements non enregistrés seront perdus";
const INVALID =
  "Nom invalide : lettres minuscules, chiffres et tirets, sans tiret au début";
const TAKEN = "Ce nom est déjà pris";
const DELETE_WARNING = "L'équipe sera retirée du repo par un commit";

function stubApi(
  options: {
    team?: string | null;
    teams?: { name: string; text: string }[];
    applies?: Answer[];
  } = {},
) {
  const read = {
    agents: REPO_AGENTS,
    catalog: [],
    team: options.team === undefined ? TEAM : options.team,
    teams: options.teams ?? [{ name: "leger", text: LEGER }],
  };
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
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      // The shell's banner « Cockpit ne répond plus » reads it (decision 072 I).
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
      if (path === "/api/projects/5/agents" && method === "GET") {
        calls.reads++;
        return Response.json(read);
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

async function openTeam() {
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
  await waitFor(() =>
    expect(screen.queryByText("Chargement du graphe…")).toBeNull(),
  );
  // The tests read the steps in the list.
  fireEvent.click(screen.getByRole("button", { name: "Liste" }));
}

// The teams are chips (aria-pressed); the default one is « Par défaut », the others are named after the team.
const chip = (value: string) =>
  screen.getByRole("button", {
    name: value || "Par défaut",
  }) as HTMLButtonElement;
const choose = (value: string) => fireEvent.click(chip(value));
const chosen = () => {
  const pressed = screen
    .getAllByRole("button", { pressed: true })
    .filter((b) => !["Graphe", "Liste"].includes(b.textContent ?? ""))[0];
  return pressed?.textContent === "Par défaut" ? "" : pressed?.textContent;
};
const chips = () =>
  within(screen.getByRole("group", { name: "Équipe" }))
    .getAllByRole("button")
    .map((b) => b.textContent);
const rowAgents = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => within(li).queryByRole("button", { name: "Monter" }))
    .map((li) => /^\s*\d+\s*([a-z0-9-]+)/.exec(li.textContent ?? "")?.[1]);
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const moveFirstDown = () => {
  const first = screen
    .getAllByRole("listitem")
    .find((li) =>
      within(li).queryByRole("button", { name: "Descendre" }),
    ) as HTMLElement;
  fireEvent.click(within(first).getByRole("button", { name: "Descendre" }));
};
const review = () => {
  const see = screen.getByRole("button", {
    name: "Voir les changements",
  }) as HTMLButtonElement;
  if (!see.disabled) fireEvent.click(see);
};
const commitButton = () =>
  screen.getByRole("button", { name: "Faire le commit" }) as HTMLButtonElement;
// Decision 079 D: the window of 042 is the full-screen canvas, titled « Nouvelle équipe · <field> ».
const dialog = () =>
  screen.getByRole("dialog", { name: /^Nouvelle équipe/ }) as HTMLDialogElement;
// 079 D3: the left column is two groups of buttons named after the agents; a click adds the agent as the last step (« + Ajouter une étape » is gone).
const palette = (group: string, agent: string) =>
  within(within(dialog()).getByRole("group", { name: group })).getByRole(
    "button",
    { name: agent },
  );
const rowsOf = (items: HTMLElement[]) =>
  items
    .filter((li) => within(li).queryByRole("button", { name: "Monter" }))
    .map((li) => /^\s*\d+\s*([a-z0-9-]+)/.exec(li.textContent ?? "")?.[1]);
const dialogRows = () =>
  screen.queryByRole("dialog")
    ? rowsOf(within(dialog()).queryAllByRole("listitem"))
    : [];
const outsideRows = () =>
  rowsOf(
    screen
      .queryAllByRole("listitem", { hidden: true })
      .filter((li) => !li.closest("dialog")),
  );
const nameField = () =>
  within(dialog()).getByLabelText("Nom de l'équipe") as HTMLInputElement;
const create = () =>
  within(dialog()).getByRole("button", {
    name: "Créer l'équipe",
  }) as HTMLButtonElement;
const typeName = (value: string) =>
  fireEvent.change(nameField(), { target: { value } });

describe("decision 032 E: choosing a team", () => {
  it("given two named teams, when the section opens, then the chips of the teams are « Par défaut » then each named team, and the default team is shown", async () => {
    stubApi({
      teams: [
        { name: "leger", text: LEGER },
        { name: "docs", text: LEGER },
      ],
    });

    await openTeam();

    expect(chips()).toEqual(["Par défaut", "leger", "docs"]);
    expect(chosen()).toBe("");
    expect(rowAgents()).toEqual(["test-writer", "developer", "reviewer"]);
  });

  it("given the leger team, when it is chosen, then its steps replace the draft in the same graph and list", async () => {
    stubApi();
    await openTeam();

    choose("leger");

    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Graphe" }));
    expect(screen.getByTestId("team-card-doc-writer").textContent).toContain(
      "documents",
    );
    expect(screen.queryByTestId("team-card-test-writer")).toBeNull();
  });

  it("given an unsaved change, when another team is chosen, then the warning is asked and the draft and the select are kept, and cancelling keeps them", async () => {
    stubApi();
    await openTeam();
    moveFirstDown();
    expect(rowAgents()).toEqual(["developer", "test-writer", "reviewer"]);

    choose("leger");

    expect(screen.getByText(LOST)).toBeDefined();
    expect(rowAgents()).toEqual(["developer", "test-writer", "reviewer"]);
    click("Annuler");
    expect(screen.queryByText(LOST)).toBeNull();
    expect(chosen()).toBe("");
    expect(rowAgents()).toEqual(["developer", "test-writer", "reviewer"]);
  });

  it("given an unsaved change, when the change of team is confirmed, then the chosen team is loaded", async () => {
    stubApi();
    await openTeam();
    moveFirstDown();

    choose("leger");
    click("Confirmer le changement");

    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
    expect(chosen()).toBe("leger");
    expect(screen.queryByText(LOST)).toBeNull();
  });

  it("given no change, when another team is chosen, then no warning is asked", async () => {
    stubApi();
    await openTeam();

    choose("leger");

    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
    expect(screen.queryByText(LOST)).toBeNull();
  });

  it("given the leger team changed and committed, when the commit is made, then { name: leger, before: its text, after } is posted", async () => {
    const calls = stubApi();
    await openTeam();
    choose("leger");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
    moveFirstDown();
    review();

    fireEvent.click(commitButton());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    const [sent] = calls.applyBodies;
    expect(sent).toMatchObject({ name: "leger", before: LEGER });
    expect(String(sent?.after).indexOf("doc-writer")).toBeLessThan(
      String(sent?.after).indexOf("developer"),
    );
    await screen.findByText("C'est fait");
  });

  it("given the default team changed, when the commit is made, then no name is posted (absent or null)", async () => {
    const calls = stubApi();
    await openTeam();
    moveFirstDown();
    review();

    fireEvent.click(commitButton());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    const [sent] = calls.applyBodies;
    expect(sent?.name ?? null).toBeNull();
    expect(sent?.before).toBe(TEAM);
  });
});

describe("decision 032 E: the command to copy", () => {
  it("given the leger team chosen, when it is shown, then /dev-us <US> --team leger is shown, and it is not for the default team", async () => {
    stubApi();
    await openTeam();
    expect(screen.queryByText(/--team/)).toBeNull();

    choose("leger");

    await screen.findByText(/\/dev-us <US> --team leger/);
    choose("");
    await waitFor(() => expect(screen.queryByText(/--team/)).toBeNull());
  });
});

describe("decision 032 E: a new team, in a dialog", () => {
  it("given the Agents tab, when « Nouvelle équipe » is clicked, then a canvas « Nouvelle équipe » opens with the field « Nom de l'équipe », a copy of the team read from the repo (not the unsaved draft) and the palette « Agents du repo », while the current editor is unchanged", async () => {
    stubApi();
    await openTeam();
    moveFirstDown();
    expect(dialogRows()).toEqual([]);

    click("Nouvelle équipe");

    const box = dialog();
    expect(within(box).getByLabelText("Nom de l'équipe")).toBeDefined();
    expect(dialogRows()).toEqual(["test-writer", "developer", "reviewer"]);
    expect(
      within(box).getByRole("group", { name: "Agents du repo" }),
    ).toBeDefined();
    expect(outsideRows()).toEqual(["developer", "test-writer", "reviewer"]);
    expect(chosen()).toBe("");
  });

  it("given the leger team shown, when « Nouvelle équipe » is clicked, then the dialog starts from leger as read from the repo", async () => {
    stubApi();
    await openTeam();
    choose("leger");
    await waitFor(() =>
      expect(outsideRows()).toEqual(["developer", "doc-writer"]),
    );

    click("Nouvelle équipe");

    expect(dialogRows()).toEqual(["developer", "doc-writer"]);
  });

  it("given the dialog, when a name is typed, a step added in it and « Créer l'équipe » clicked, then one POST { name, before: null, after } is sent, the dialog closes and the picker shows the new team with « C'est fait » and the commit link", async () => {
    const calls = stubApi();
    await openTeam();

    click("Nouvelle équipe");
    typeName("docs");
    fireEvent.click(palette("Agents du repo", "doc-writer"));
    expect(dialogRows()).toEqual([
      "test-writer",
      "developer",
      "reviewer",
      "doc-writer",
    ]);
    expect(create().disabled).toBe(false);
    fireEvent.click(create());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    const [sent] = calls.applyBodies;
    expect(sent).toMatchObject({ name: "docs", before: null });
    expect(String(sent?.after)).toContain("agent: doc-writer");
    await screen.findByText("C'est fait");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chosen()).toBe("docs");
    expect(screen.getByRole("link", { name: "Voir le commit" })).toBeDefined();
    expect(calls.applyBodies).toHaveLength(1);
  });

  it.each([
    ["empty", "", null],
    ["a capital", "Leger", INVALID],
    ["a leading dash", "-x", INVALID],
    ["a space", "a b", INVALID],
    ["a path", "../x", INVALID],
    ["239 characters", "a".repeat(239), INVALID],
    ["a name already taken", "leger", TAKEN],
  ])(
    "given the name %s, when the dialog is open, then « Créer l'équipe » is disabled and the message is shown",
    async (_n, value, expected) => {
      stubApi();
      await openTeam();

      click("Nouvelle équipe");
      typeName(value);

      expect(create().disabled).toBe(true);
      if (expected) expect(within(dialog()).getByText(expected)).toBeDefined();
    },
  );

  it("given a valid name, when every step is removed in the dialog, then « Créer l'équipe » is disabled", async () => {
    stubApi({ teams: [{ name: "mini", text: team(["developer", "x"]) }] });
    await openTeam();
    choose("mini");
    await waitFor(() => expect(outsideRows()).toEqual(["developer"]));

    click("Nouvelle équipe");
    typeName("vide");
    expect(create().disabled).toBe(false);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Modifier" }));
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Retirer l'étape" }),
    );

    expect(dialogRows()).toEqual([]);
    expect(create().disabled).toBe(true);
  });

  it("given the dialog with a typed name, when « Annuler » is clicked, then nothing is sent, the dialog closes and the current team is as before", async () => {
    const calls = stubApi();
    await openTeam();
    moveFirstDown();

    click("Nouvelle équipe");
    typeName("docs");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Annuler" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.applyBodies).toEqual([]);
    expect(chosen()).toBe("");
    expect(outsideRows()).toEqual(["developer", "test-writer", "reviewer"]);
  });

  it("given unsaved edits to the current team, when « Nouvelle équipe » is clicked, then the edits stay outside the dialog, are not copied into it, and are still there after « Annuler »", async () => {
    stubApi();
    await openTeam();
    moveFirstDown();

    click("Nouvelle équipe");

    expect(dialogRows()).toEqual(["test-writer", "developer", "reviewer"]);
    expect(outsideRows()).toEqual(["developer", "test-writer", "reviewer"]);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Annuler" }));
    expect(outsideRows()).toEqual(["developer", "test-writer", "reviewer"]);
  });

  it("given the dialog with a typed name, when it is closed like Escape does (close event), then nothing is sent, the dialog is gone and the current team is as before", async () => {
    const calls = stubApi();
    await openTeam();
    moveFirstDown();

    click("Nouvelle équipe");
    typeName("docs");
    act(() => dialog().close());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.applyBodies).toEqual([]);
    expect(chosen()).toBe("");
    expect(outsideRows()).toEqual(["developer", "test-writer", "reviewer"]);
  });

  it.each([
    [409, { error: "repo_changed" }],
    [502, { error: "github_unavailable" }],
  ])(
    "given a POST answering %s, when « Créer l'équipe » fails, then the error alert is inside the dialog, and after « Annuler » no alert remains on the page",
    async (status, body) => {
      const calls = stubApi({ applies: [{ status, body }] });
      await openTeam();

      click("Nouvelle équipe");
      typeName("docs");
      fireEvent.click(create());

      await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
      expect(await within(dialog()).findByRole("alert")).toBeDefined();
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Annuler" }),
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryAllByRole("alert", { hidden: true })).toEqual([]);
    },
  );

  it("given « Nouvelle équipe » clicked, when « Annuler » is clicked, then focus is back on the « Nouvelle équipe » button", async () => {
    stubApi();
    await openTeam();
    const opener = screen.getByRole("button", { name: "Nouvelle équipe" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("given a successful « Créer l'équipe », when the dialog closes, then focus is on the « Nouvelle équipe » button, outside the dialog", async () => {
    stubApi();
    await openTeam();
    const opener = screen.getByRole("button", { name: "Nouvelle équipe" });
    opener.focus();
    fireEvent.click(opener);
    typeName("docs");

    fireEvent.click(create());

    await screen.findByText("C'est fait");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("decision 032 E: layout of the tab", () => {
  it("given the Agents tab, when it is shown, then the sections « Équipe » and « Agents » are the two columns of one lg:grid-cols- container, the team first", async () => {
    stubApi();
    await openTeam();

    const sections = ["Équipe", "Les agents du repo"].map(
      (name) =>
        screen
          .getByRole("heading", { level: 2, name })
          .closest("section") as HTMLElement,
    );
    const [teamSection, agentsSection] = sections as [HTMLElement, HTMLElement];
    expect(teamSection.parentElement).toBe(agentsSection.parentElement);
    expect(teamSection.parentElement?.className).toContain("lg:grid-cols-");
    expect(
      teamSection.compareDocumentPosition(agentsSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given an agent form open, when it is shown, then the « Agents » section spans both columns (lg:col-span-2)", async () => {
    stubApi();
    await openTeam();

    click("Ouvrir developer");

    const agentsSection = screen
      .getByRole("heading", { level: 2, name: "Les agents du repo" })
      .closest("section") as HTMLElement;
    expect(agentsSection.className).toContain("lg:col-span-2");
  });
});

describe("decision 032 E: deleting a team", () => {
  it("given the default team, when it is shown, then « Supprimer l'équipe » is absent", async () => {
    stubApi();
    await openTeam();

    expect(
      screen.queryByRole("button", { name: "Supprimer l'équipe" }),
    ).toBeNull();
  });

  it("given the leger team, when « Supprimer l'équipe » is clicked, then the confirmation is asked and nothing is sent, and once confirmed { name, before, after: null } is posted", async () => {
    const calls = stubApi();
    await openTeam();
    choose("leger");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );

    click("Supprimer l'équipe");

    expect(screen.getByText(DELETE_WARNING)).toBeDefined();
    expect(calls.applyBodies).toEqual([]);
    click("Confirmer la suppression");
    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    expect(calls.applyBodies[0]).toEqual({
      name: "leger",
      before: LEGER,
      after: null,
    });
  });

  it("given the confirmation asked, when « Annuler » is clicked, then nothing is sent", async () => {
    const calls = stubApi();
    await openTeam();
    choose("leger");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );

    click("Supprimer l'équipe");
    click("Annuler");

    expect(screen.queryByText(DELETE_WARNING)).toBeNull();
    expect(calls.applyBodies).toEqual([]);
  });
});

describe("decision 032 E: a named team Cockpit cannot rewrite", () => {
  it("given a broken named team, when it is chosen, then the sentence « modifie-le sur GitHub » is shown with no card and no commit, and the default team is still editable", async () => {
    stubApi({
      teams: [
        { name: "vieux", text: BROKEN },
        { name: "leger", text: LEGER },
      ],
    });
    await openTeam();
    expect(screen.queryByText(/modifie-le sur GitHub/)).toBeNull();

    choose("vieux");

    await screen.findByText(/modifie-le sur GitHub/);
    expect(screen.queryByTestId("team-card-developer")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Faire le commit" }),
    ).toBeNull();
    expect(chip("")).toBeDefined();
    choose("");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["test-writer", "developer", "reviewer"]),
    );
    expect(screen.queryByText(/modifie-le sur GitHub/)).toBeNull();
    choose("leger");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
  });

  it("given a named team whose text is empty (not a readable file), when it is chosen, then the sentence is shown", async () => {
    stubApi({ teams: [{ name: "gros", text: "" }] });
    await openTeam();

    choose("gros");

    await screen.findByText(/modifie-le sur GitHub/);
  });
});

describe("decision 032 E: a save in flight", () => {
  it("given a removal waiting for its answer, when the team picker and the team buttons are looked at, then they are disabled until it answers", async () => {
    stubApi();
    const inner = globalThis.fetch;
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/team/apply")) await gate;
        return inner(input, init);
      }),
    );
    await openTeam();
    choose("leger");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
    click("Supprimer l'équipe");

    click("Confirmer la suppression");

    await waitFor(() => expect(chip("").disabled).toBe(true));
    expect(
      (
        screen.getByRole("button", {
          name: "Nouvelle équipe",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    answer();
    await waitFor(() => expect(chip("").disabled).toBe(false));
    expect(chosen()).toBe("");
  });
});
