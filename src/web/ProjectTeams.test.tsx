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

afterEach(() => {
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
}

const picker = () =>
  screen.getByRole("combobox", { name: "Équipe" }) as HTMLSelectElement;
const choose = (value: string) =>
  fireEvent.change(picker(), { target: { value } });
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
const nameField = () =>
  screen.getByLabelText("Nom de l'équipe") as HTMLInputElement;
const create = () =>
  screen.getByRole("button", { name: "Créer l'équipe" }) as HTMLButtonElement;
const typeName = (value: string) =>
  fireEvent.change(nameField(), { target: { value } });

describe("decision 032 E: choosing a team", () => {
  it("given two named teams, when the section opens, then the select « Équipe » lists « Par défaut (team.md) » first, then each named team, and the default team is shown", async () => {
    stubApi({
      teams: [
        { name: "leger", text: LEGER },
        { name: "docs", text: LEGER },
      ],
    });

    await openTeam();

    const options = within(picker()).getAllByRole(
      "option",
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["", "leger", "docs"]);
    expect(options[0]?.textContent).toBe("Par défaut (team.md)");
    expect(picker().value).toBe("");
    expect(rowAgents()).toEqual(["test-writer", "developer", "reviewer"]);
  });

  it("given the leger team, when it is chosen, then its steps replace the draft in the same graph and list", async () => {
    stubApi();
    await openTeam();

    choose("leger");

    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );
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
    expect(picker().value).toBe("");
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
    expect(picker().value).toBe("leger");
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

describe("decision 032 E: a new team", () => {
  it("given the default team shown, when « Nouvelle équipe » is used with the name docs, then the team starts from a copy of the default one and the commit posts { name: docs, before: null, after }", async () => {
    const calls = stubApi();
    await openTeam();

    click("Nouvelle équipe");
    typeName("docs");
    expect(create().disabled).toBe(false);
    fireEvent.click(create());

    await waitFor(() => expect(picker().value).toBe("docs"));
    expect(rowAgents()).toEqual(["test-writer", "developer", "reviewer"]);
    review();
    fireEvent.click(commitButton());
    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    const [sent] = calls.applyBodies;
    expect(sent).toMatchObject({ name: "docs", before: null });
    expect(String(sent?.after)).toContain("agent: reviewer");
  });

  it("given the leger team shown, when a new team is created, then it starts from a copy of leger", async () => {
    stubApi();
    await openTeam();
    choose("leger");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["developer", "doc-writer"]),
    );

    click("Nouvelle équipe");
    typeName("copie");
    fireEvent.click(create());

    await waitFor(() => expect(picker().value).toBe("copie"));
    expect(rowAgents()).toEqual(["developer", "doc-writer"]);
  });

  it.each([
    ["empty", "", null],
    ["a capital", "Leger", INVALID],
    ["a leading dash", "-x", INVALID],
    ["a space", "a b", INVALID],
    ["a path", "../x", INVALID],
    ["241 characters", "a".repeat(241), INVALID],
    ["a name already taken", "leger", TAKEN],
  ])(
    "given the name %s, when « Nouvelle équipe » is open, then « Créer l'équipe » is disabled and the message is shown",
    async (_n, value, expected) => {
      stubApi();
      await openTeam();

      click("Nouvelle équipe");
      typeName(value);

      expect(create().disabled).toBe(true);
      if (expected) expect(screen.getByText(expected)).toBeDefined();
    },
  );
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
    expect(picker()).toBeDefined();
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
