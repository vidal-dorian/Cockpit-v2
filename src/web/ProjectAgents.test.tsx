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
import { parseAgent } from "./agent-file.ts";

// Slice E2 (decision 030 A, C to E, G, H): the tab « Agents » of /projets/:id, at /projets/:id/agents.
//
// Pinned where the decision leaves it open:
// - The page reads GET /api/projects/:id/agents -> { agents: [{ name, text }], catalog: [{ name, text }] } (server tests: agents.test.ts) when the tab opens.
//   Each agent is a list item (`li`) of the list of the tab that holds its name and its model (« Celui de la session » when it has none) and a button « Ouvrir <name> ».
// - The form of an open agent has the fields « Description » (text), « Outils » (text), « Modèle » (a select: « Celui de la session », sonnet, opus, haiku, fable, and the value
//   of the file when it is not one of these) and « Prompt » (textarea). The diff (DiffList: list items, « Retirée » / « Ajoutée ») goes from the text read to the text produced.
//   « Faire le commit » posts /api/projects/:id/agents/apply with { name, before, after } (before: the text read, null for an addition; after: null for a removal).
// - « Supprimer l'agent » shows « Le fichier sera retiré du repo par un commit » and a button « Confirmer la suppression », which posts after: null.
// - « Ajouter un agent » shows a field « Nom de l'agent », a select « Point de départ » (« Vide » then the agents of `catalog`) and a button « Continuer », disabled when the name is not
//   valid (a-z, 0-9, -, not starting with -) or already taken, in which case a message (« déjà pris » for a taken name) is shown.
// - The answer is 200 { commitSha, pullRequest?: { number, url } }: « C'est fait » with a link to https://github.com/<full_name>/commit/<sha>, or the protected-branch sentence with the
//   link of the pull request; the agents are then read again. A refusal is 409 { error } (a role="alert" in French, never the code); on repo_changed the agents are read again.
// - On an archived project (GET /api/projects gives `archived: true`) « Ajouter un agent », « Faire le commit » and « Supprimer l'agent » are disabled.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Answer = { status: number; body: unknown };
type AgentFile = { name: string; text: string };

const DEV_TEXT =
  "---\nname: developer\ndescription: Builds the thing\ntools: Read, Grep\nmodel: sonnet\ncolor: blue\n---\nYou are the developer.\n";
const REV_TEXT =
  "---\nname: reviewer\ndescription: Reviews the diff\n---\nYou review.\n";
const TW_TEXT =
  "---\nname: test-writer\ndescription: Writes the tests\nmodel: opus\n---\nYou write tests.\n";
const AGENTS: AgentFile[] = [
  { name: "developer", text: DEV_TEXT },
  { name: "reviewer", text: REV_TEXT },
];
const CATALOG: AgentFile[] = [{ name: "test-writer", text: TW_TEXT }];
const SHA = "a".repeat(40);
const COMMIT_URL = `https://github.com/octocat/hello/commit/${SHA}`;
const PR_URL = "https://github.com/octocat/hello/pull/3";
const SETTINGS_URL = "https://github.com/settings/apps/cockpit-test";
const REPO_CHANGED = "Le repo a changé entre-temps : regarde de nouveau";
const PROTECTED_SENTENCE =
  "La branche par défaut est protégée : une pull request est ouverte";
const SESSION_MODEL = "Celui de la session";
const UNREADABLE =
  "L'en-tête de ce fichier n'est pas lisible par Cockpit : modifie-le sur GitHub";

const GREEN = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];

/** A small fake server behind fetch; `reads` are served one per agents request, the last again after that. */
function stubApi(
  options: { reads?: Answer[]; applies?: Answer[]; archived?: boolean } = {},
) {
  const reads = options.reads ?? [
    { status: 200, body: { agents: AGENTS, catalog: CATALOG } },
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
      if (path === "/api/projects/5/agents/apply" && method === "POST") {
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

const open = async (name: string) =>
  fireEvent.click(
    await screen.findByRole("button", { name: `Ouvrir ${name}` }),
  );
const commitButton = () =>
  screen.getByRole("button", { name: "Faire le commit" }) as HTMLButtonElement;
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const rowOf = (name: string) => {
  const found = screen
    .getAllByRole("listitem")
    .filter(
      (li) =>
        within(li).queryByRole("button", { name: `Ouvrir ${name}` }) !== null,
    );
  expect(found.length, `a list item for ${name}`).toBeGreaterThan(0);
  return found[found.length - 1] as HTMLElement;
};
const diffItems = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "")
    .filter((t) => /Retirée|Ajoutée/.test(t));
const alertText = () => screen.getByRole("alert").textContent ?? "";

describe("decision 030 A, B: the list of the agents", () => {
  it("given the agents route answering two agents, when the tab opens, then each agent shows its name and its model, « Celui de la session » when it has none", async () => {
    const calls = stubApi();

    renderAt("/projets/5/agents");

    await screen.findByRole("button", { name: "Ouvrir developer" });
    expect(calls.reads).toBe(1);
    expect(rowOf("developer").textContent).toContain("developer");
    expect(rowOf("developer").textContent).toContain("sonnet");
    expect(rowOf("reviewer").textContent).toContain("reviewer");
    expect(rowOf("reviewer").textContent).toContain(SESSION_MODEL);
    expect(rowOf("developer").textContent).not.toContain(SESSION_MODEL);
  });

  it.each([
    [
      "409 repo_unreachable",
      { status: 409, body: { error: "repo_unreachable" } },
      "repo_unreachable",
    ],
    [
      "409 empty_repo",
      { status: 409, body: { error: "empty_repo" } },
      "empty_repo",
    ],
    [
      "502",
      { status: 502, body: { error: "github_unavailable" } },
      "github_unavailable",
    ],
  ])(
    "given the agents route answering %s, when the tab opens, then a French alert is shown without the code",
    async (_name, answer, code) => {
      stubApi({ reads: [answer] });

      renderAt("/projets/5/agents");

      await screen.findByRole("alert");
      expect(alertText().trim().length).toBeGreaterThan(10);
      expect(alertText()).not.toContain(code);
    },
  );
});

describe("decision 030 C, E: editing an agent", () => {
  it("given I open developer and change the model from sonnet to opus, when the form shows the diff, then model: sonnet is Retirée and model: opus Ajoutée, and « Faire le commit » posts { name, before, after } with only the model line changed, then « C'est fait » with the link of the commit and the list is read again", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await open("developer");
    expect(field("Description").value).toBe("Builds the thing");
    expect(field("Outils").value).toBe("Read, Grep");
    expect(field("Modèle").value).toBe("sonnet");
    expect(commitButton().disabled).toBe(true);

    fireEvent.change(field("Modèle"), { target: { value: "opus" } });

    const items = diffItems();
    expect(items).toHaveLength(2);
    expect(items.find((t) => t.includes("model: sonnet"))).toMatch(/Retirée/);
    expect(items.find((t) => t.includes("model: opus"))).toMatch(/Ajoutée/);
    expect(commitButton().disabled).toBe(false);

    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      {
        name: "developer",
        before: DEV_TEXT,
        after: DEV_TEXT.replace("model: sonnet", "model: opus"),
      },
    ]);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === COMMIT_URL),
    ).toBe(true);
    await waitFor(() => expect(calls.reads).toBe(2));
  });

  it("given the description emptied, when the form shows, then « Faire le commit » is disabled", async () => {
    stubApi();
    renderAt("/projets/5/agents");
    await open("developer");

    fireEvent.change(field("Description"), { target: { value: "" } });

    expect(commitButton().disabled).toBe(true);
  });

  it("given an edited description and tools, when the commit is made, then they are written as JSON double-quoted strings and the other lines and the prompt stay", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await open("developer");

    fireEvent.change(field("Description"), {
      target: { value: 'Does: "more"' },
    });
    fireEvent.change(field("Outils"), { target: { value: "Read, Edit" } });
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies[0]?.after).toBe(
      DEV_TEXT.replace(
        "description: Builds the thing",
        `description: ${JSON.stringify('Does: "more"')}`,
      ).replace("tools: Read, Grep", 'tools: "Read, Edit"'),
    );
  });

  it("given a description read in double quotes, when the agent is opened, then it is shown unquoted", async () => {
    const quoted = REV_TEXT.replace(
      "description: Reviews the diff",
      'description: "Reviews: the diff"',
    );
    stubApi({
      reads: [
        {
          status: 200,
          body: {
            agents: [{ name: "reviewer", text: quoted }],
            catalog: [],
          },
        },
      ],
    });
    renderAt("/projets/5/agents");

    await open("reviewer");

    expect(field("Description").value).toBe("Reviews: the diff");
    expect(commitButton().disabled).toBe(true);
  });

  it("given choosing « Celui de la session » and emptying the tools, when the commit is made, then the model and tools lines are removed", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await open("developer");

    fireEvent.change(field("Modèle"), { target: { value: "" } });
    fireEvent.change(field("Outils"), { target: { value: "" } });
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies[0]?.after).toBe(
      DEV_TEXT.replace("tools: Read, Grep\n", "").replace(
        "model: sonnet\n",
        "",
      ),
    );
  });

  it("given a model that is not in the list, when the agent is opened, then it is an option, selected, and an untouched form commits nothing", async () => {
    const custom = DEV_TEXT.replace("model: sonnet", "model: claude-opus-5-5");
    stubApi({
      reads: [
        {
          status: 200,
          body: { agents: [{ name: "developer", text: custom }], catalog: [] },
        },
      ],
    });
    renderAt("/projets/5/agents");

    await open("developer");

    const select = field("Modèle");
    expect(select.value).toBe("claude-opus-5-5");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(
      expect.arrayContaining([
        SESSION_MODEL,
        "sonnet",
        "opus",
        "haiku",
        "fable",
        "claude-opus-5-5",
      ]),
    );
    expect(commitButton().disabled).toBe(true);
  });

  it("given the prompt edited, when the commit is made, then only the prompt differs", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await open("developer");

    fireEvent.change(field("Consigne"), { target: { value: "New prompt\n" } });
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies[0]?.after).toBe(
      DEV_TEXT.replace("You are the developer.\n", "New prompt\n"),
    );
  });

  it.each([
    ["no --- on the first line", "name: developer\ndescription: x\n"],
    [
      "a YAML list under tools",
      "---\nname: developer\ndescription: x\ntools:\n  - Read\n---\nP\n",
    ],
  ])(
    "given an agent with %s, when it is opened, then no form is shown but the unreadable-header sentence, and « Supprimer l'agent » is still there",
    async (_name, text) => {
      stubApi({
        reads: [
          {
            status: 200,
            body: { agents: [{ name: "developer", text }], catalog: [] },
          },
        ],
      });
      renderAt("/projets/5/agents");

      await open("developer");

      expect(screen.getByText(UNREADABLE)).toBeDefined();
      expect(screen.queryByLabelText("Description")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Faire le commit" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Supprimer l'agent" }),
      ).toBeDefined();
    },
  );
});

describe("decision 030 D: adding an agent", () => {
  it("given « Ajouter un agent » and a name taken by an agent of the repo, when it is typed, then « Continuer » is disabled with a French message", async () => {
    stubApi();
    renderAt("/projets/5/agents");
    await screen.findByRole("button", { name: "Ouvrir developer" });

    fireEvent.click(screen.getByRole("button", { name: "+ Nouvel agent" }));
    fireEvent.change(field("Nom de l'agent"), {
      target: { value: "developer" },
    });

    expect(
      (screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/déjà pris/i)).toBeDefined();
  });

  it.each(["../x", "Dev", "-x", ""])(
    "given the name %j, when it is typed, then « Continuer » is disabled",
    async (name) => {
      stubApi();
      renderAt("/projets/5/agents");
      await screen.findByRole("button", { name: "Ouvrir developer" });

      fireEvent.click(screen.getByRole("button", { name: "+ Nouvel agent" }));
      fireEvent.change(field("Nom de l'agent"), { target: { value: name } });

      expect(
        (screen.getByRole("button", { name: "Continuer" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    },
  );

  it("given the starting point « Vide » and the name doc-writer, when the form is filled, then the diff shows the whole new file as added and the commit posts before: null with a readable file named doc-writer", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await screen.findByRole("button", { name: "Ouvrir developer" });

    fireEvent.click(screen.getByRole("button", { name: "+ Nouvel agent" }));
    fireEvent.change(field("Nom de l'agent"), {
      target: { value: "doc-writer" },
    });
    const start = field("Point de départ");
    expect(
      within(start)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Vide", "test-writer"]);
    fireEvent.change(start, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    fireEvent.change(field("Description"), {
      target: { value: "Writes the docs" },
    });

    const items = diffItems();
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.every((t) => /Ajoutée/.test(t) && !/Retirée/.test(t))).toBe(
      true,
    );
    expect(items.some((t) => t.includes("name: doc-writer"))).toBe(true);
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    const [sent] = calls.applyBodies;
    expect(sent).toMatchObject({ name: "doc-writer", before: null });
    expect(parseAgent(String(sent?.after))).toMatchObject({
      name: "doc-writer",
      description: "Writes the docs",
      prompt: "",
    });
  });

  it("given the starting point test-writer of the catalogue, when the form is filled, then it opens on the catalogue text, and the commit posts before: null with that text", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await screen.findByRole("button", { name: "Ouvrir developer" });

    fireEvent.click(screen.getByRole("button", { name: "+ Nouvel agent" }));
    fireEvent.change(field("Nom de l'agent"), {
      target: { value: "test-writer" },
    });
    fireEvent.change(field("Point de départ"), {
      target: { value: "test-writer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));

    expect(field("Description").value).toBe("Writes the tests");
    expect(field("Modèle").value).toBe("opus");
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { name: "test-writer", before: null, after: TW_TEXT },
    ]);
  });
});

describe("decision 030 G: removing an agent", () => {
  it("given « Supprimer l'agent », when it is clicked, then the confirmation is asked and nothing is sent, and once confirmed after: null is posted", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents");
    await open("reviewer");

    fireEvent.click(screen.getByRole("button", { name: "Supprimer l'agent" }));

    expect(
      screen.getByText("Le fichier sera retiré du repo par un commit"),
    ).toBeDefined();
    expect(calls.applyBodies).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la suppression" }),
    );

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { name: "reviewer", before: REV_TEXT, after: null },
    ]);
    await waitFor(() => expect(calls.reads).toBe(2));
  });

  it("given an agent whose header is unreadable, when it is removed and confirmed, then after: null is posted with the text read", async () => {
    const text = "no header at all\n";
    const calls = stubApi({
      reads: [
        {
          status: 200,
          body: { agents: [{ name: "odd", text }], catalog: [] },
        },
      ],
    });
    renderAt("/projets/5/agents");
    await open("odd");

    fireEvent.click(screen.getByRole("button", { name: "Supprimer l'agent" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la suppression" }),
    );

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { name: "odd", before: text, after: null },
    ]);
  });
});

describe("decision 030 H: after the commit and the refusals", () => {
  const change = async () => {
    await open("developer");
    fireEvent.change(field("Modèle"), { target: { value: "opus" } });
    fireEvent.click(commitButton());
  };

  it("given a protected default branch, when the commit is made, then the page says a pull request is open and links to it", async () => {
    const calls = stubApi({
      applies: [
        {
          status: 200,
          body: { commitSha: SHA, pullRequest: { number: 3, url: PR_URL } },
        },
      ],
    });
    renderAt("/projets/5/agents");

    await change();

    await screen.findByText(PROTECTED_SENTENCE);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === PR_URL),
    ).toBe(true);
    await waitFor(() => expect(calls.reads).toBe(2));
  });

  it("given repo_changed, when the commit is made, then « Le repo a changé entre-temps : regarde de nouveau » is shown and the agents are read again", async () => {
    const calls = stubApi({
      applies: [{ status: 409, body: { error: "repo_changed" } }],
    });
    renderAt("/projets/5/agents");

    await change();

    await screen.findByText(REPO_CHANGED);
    await waitFor(() => expect(calls.reads).toBe(2));
    expect(alertText()).not.toContain("repo_changed");
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
    renderAt("/projets/5/agents");

    await change();

    await screen.findByRole("alert");
    expect(alertText()).toMatch(/Pull requests/);
    expect(alertText()).not.toContain("pull_request_forbidden");
    expect(
      within(screen.getByRole("alert"))
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === SETTINGS_URL),
    ).toBe(true);
  });

  it.each([
    [
      "409 empty_repo",
      { status: 409, body: { error: "empty_repo" } },
      "empty_repo",
    ],
    [
      "502",
      { status: 502, body: { error: "github_unavailable" } },
      "github_unavailable",
    ],
  ])(
    "given the commit answered %s, when it is made, then a French alert is shown without the code",
    async (_name, answer, code) => {
      stubApi({ applies: [answer] });
      renderAt("/projets/5/agents");

      await change();

      await screen.findByRole("alert");
      expect(alertText().trim().length).toBeGreaterThan(10);
      expect(alertText()).not.toContain(code);
    },
  );

  it("given an archived project, when the tab opens, then « Ajouter un agent », « Faire le commit » and « Supprimer l'agent » are disabled", async () => {
    const calls = stubApi({ archived: true });
    renderAt("/projets/5/agents");

    await screen.findByRole("button", { name: "Ouvrir developer" });
    // The list steps aside while an agent is open: « + Nouvel agent » is checked before.
    expect(
      (
        screen.getByRole("button", {
          name: "+ Nouvel agent",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await open("developer");
    expect(
      (
        screen.getByRole("button", {
          name: "Supprimer l'agent",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(field("Modèle"), { target: { value: "opus" } });
    expect(commitButton().disabled).toBe(true);
    fireEvent.click(commitButton());
    expect(calls.applyBodies).toEqual([]);
  });
});
