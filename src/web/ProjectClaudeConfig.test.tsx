// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${VAR} references are the data under test
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

// Slice 12.1 (decision 065 D to H): the chips of the tab « Agents » of /projets/:id and the editors of CLAUDE.md, the rules, the skills and .mcp.json.
//
// Pinned where the decision leaves it open:
// - The tab reads GET /api/projects/:id/claude-config -> { claudeMd, rules, skills, mcpJson } (server tests: claude-config.test.ts) and still GET .../agents.
// - The chips are links in the tab, named « CLAUDE.md », « Règles · N », « Skills · N », « Agents · N » and « .mcp.json », hrefs /projets/:id/agents with ?fichier=claude-md | regles | skills | mcp
//   (none for Agents); the open one has aria-current="true".
// - A rule or a skill is a list item (`li`) with a button « Ouvrir <name> ». « + Nouvelle règle » shows a field « Nom de la règle » and a button « Continuer » (as « Ajouter un agent » of 030);
//   « + Nouveau skill » shows a field « Nom » in the form (only when creating), with « Description », « Outils autorisés » and « Consigne ».
// - The text editors have a textarea « Ton texte », a diff under the heading « Ce qui change » (DiffList), « Faire le commit » (disabled while nothing changes) and « Annuler les changements ».
//   « Faire le commit » posts /api/projects/:id/claude-config/apply with { kind, name?, before, after } and the answer is { commitSha, pullRequest? }: « C'est fait » with a link to the commit.
// - « Supprimer la règle » / « Supprimer le skill » show a button « Confirmer la suppression », which posts after: null.
// - A refusal is 409 { error, at? } shown in a role="alert" in French, never the code.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Answer = { status: number; body: unknown };

const CLAUDE = "# App\n\nOld line\n";
const MCP = '{\n  "mcpServers": {}\n}\n';
const SK = "---\nname: lint\ndescription: Lints\n---\nLint it\n";
const CONFIG = {
  claudeMd: CLAUDE,
  mcpJson: MCP,
  rules: [
    { name: "style", text: "Use tabs\n" },
    { name: "naming", text: "Name well\n" },
  ],
  skills: [{ name: "lint", text: SK }],
};
const AGENT = "---\nname: developer\ndescription: Builds\n---\nYou build.\n";
const SHA = "a".repeat(40);
const COMMIT_URL = `https://github.com/octocat/hello/commit/${SHA}`;

/** A small fake server behind fetch; `config` is served for every read of claude-config. */
function stubApi(
  options: { config?: Answer; applies?: Answer[]; archived?: boolean } = {},
) {
  const config = options.config ?? { status: 200, body: CONFIG };
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
      const reply = (a: Answer) => Response.json(a.body, { status: a.status });
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
      if (path === "/api/projects/5/health")
        return Response.json({ lines: [] });
      if (path === "/api/projects/5/agents" && method === "GET")
        return Response.json({
          agents: [
            { name: "developer", text: AGENT },
            { name: "reviewer", text: AGENT },
          ],
          catalog: [],
        });
      if (path === "/api/projects/5/claude-config" && method === "GET") {
        calls.reads++;
        return reply(config);
      }
      if (path === "/api/projects/5/claude-config/apply" && method === "POST") {
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

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const commitButton = () => button("Faire le commit");
const open = async (name: string) =>
  fireEvent.click(
    await screen.findByRole("button", { name: `Ouvrir ${name}` }),
  );
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const diffItems = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "")
    .filter((t) => /Retirée|Ajoutée/.test(t));
const alertText = () => screen.getByRole("alert").textContent ?? "";

describe("decision 065 D: the chips of the tab Agents", () => {
  it("given a project, when /projets/:id/agents opens, then the five chips show with their counts, Agents is the open one and the agents list is unchanged", async () => {
    stubApi();

    renderAt("/projets/5/agents");

    const chip = async (name: string) => screen.findByRole("link", { name });
    expect((await chip("CLAUDE.md")).getAttribute("href")).toBe(
      "/projets/5/agents?fichier=claude-md",
    );
    expect((await chip("Règles · 2")).getAttribute("href")).toBe(
      "/projets/5/agents?fichier=regles",
    );
    expect((await chip("Skills · 1")).getAttribute("href")).toBe(
      "/projets/5/agents?fichier=skills",
    );
    expect((await chip(".mcp.json")).getAttribute("href")).toBe(
      "/projets/5/agents?fichier=mcp",
    );
    const agents = await chip("Agents · 2");
    expect(agents.getAttribute("href")).toBe("/projets/5/agents");
    expect(agents.getAttribute("aria-current")).toBe("true");
    expect((await chip("CLAUDE.md")).getAttribute("aria-current")).not.toBe(
      "true",
    );
    expect(
      await screen.findByRole("button", { name: "Ouvrir developer" }),
    ).toBeDefined();
    expect(screen.queryByText(/Ce que Claude lit dans/)).toBeNull();
  });

  it("given the tab, when a chip is clicked, then the address keeps it and the state sentence names the project", async () => {
    stubApi();
    renderAt("/projets/5/agents");

    fireEvent.click(await screen.findByRole("link", { name: "Règles · 2" }));

    await screen.findByRole("button", { name: "Ouvrir style" });
    expect(window.location.search).toBe("?fichier=regles");
    expect(
      screen.getByText(/Ce que Claude lit dans octocat\/hello\./),
    ).toBeDefined();
    expect(
      screen.getByText(
        /Chaque modification passe par un diff, puis un commit\./,
      ),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Règles · 2" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it.each([
    ["claude-md", "Ton texte"],
    ["mcp", "Ton texte"],
    ["regles", "Ouvrir style"],
    ["skills", "Ouvrir lint"],
  ])(
    "given the address ?fichier=%s, when the tab opens, then that chip is open",
    async (param, shown) => {
      stubApi();

      renderAt(`/projets/5/agents?fichier=${param}`);

      await waitFor(() =>
        expect(
          screen.queryByLabelText(shown) ??
            screen.queryByRole("button", { name: shown }),
        ).not.toBeNull(),
      );
      expect(
        screen.queryByRole("button", { name: "Ouvrir developer" }),
      ).toBeNull();
    },
  );
});

describe("decision 065 E: editing CLAUDE.md", () => {
  it("given CLAUDE.md, when a line is changed, then the diff shows it, the commit posts { kind, before, after }, then « C'est fait » with the commit link and the repo is read again", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents?fichier=claude-md");
    await screen.findByLabelText("Ton texte");
    expect(field("Ton texte").value).toBe(CLAUDE);
    expect(commitButton().disabled).toBe(true);
    expect(screen.getByText("Ce qui change")).toBeDefined();

    type("Ton texte", "# App\n\nNew line\n");

    const items = diffItems();
    expect(items.find((t) => t.includes("Old line"))).toMatch(/Retirée/);
    expect(items.find((t) => t.includes("New line"))).toMatch(/Ajoutée/);
    expect(commitButton().disabled).toBe(false);
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { kind: "claude_md", before: CLAUDE, after: "# App\n\nNew line\n" },
    ]);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === COMMIT_URL),
    ).toBe(true);
    await waitFor(() => expect(calls.reads).toBe(2));
  });

  it("given a change, when « Annuler les changements » is clicked, then the text is the one read and the commit is disabled again", async () => {
    stubApi();
    renderAt("/projets/5/agents?fichier=claude-md");
    await screen.findByLabelText("Ton texte");
    type("Ton texte", "other\n");

    fireEvent.click(button("Annuler les changements"));

    expect(field("Ton texte").value).toBe(CLAUDE);
    expect(commitButton().disabled).toBe(true);
  });

  it("given a repo without CLAUDE.md, when the editor opens, then it is empty and the commit creates the file with before: null", async () => {
    const calls = stubApi({
      config: { status: 200, body: { ...CONFIG, claudeMd: null } },
    });
    renderAt("/projets/5/agents?fichier=claude-md");
    await screen.findByLabelText("Ton texte");
    expect(field("Ton texte").value).toBe("");

    type("Ton texte", "# New\n");
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { kind: "claude_md", before: null, after: "# New\n" },
    ]);
  });
});

describe("decision 065 E: the rules", () => {
  it("given « + Nouvelle règle » and the name naming-2, when the editor is filled, then the commit posts kind rule with before: null", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents?fichier=regles");
    await screen.findByRole("button", { name: "Ouvrir style" });

    fireEvent.click(button("+ Nouvelle règle"));
    type("Nom de la règle", "naming-2");
    fireEvent.click(button("Continuer"));
    expect(field("Ton texte").value).toBe("");
    type("Ton texte", "Be kind\n");
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { kind: "rule", name: "naming-2", before: null, after: "Be kind\n" },
    ]);
  });

  it("given a rule name that is taken or not valid, when it is typed, then « Continuer » is disabled", async () => {
    stubApi();
    renderAt("/projets/5/agents?fichier=regles");
    await screen.findByRole("button", { name: "Ouvrir style" });
    fireEvent.click(button("+ Nouvelle règle"));

    for (const name of ["style", "Bad", "-x", ""]) {
      type("Nom de la règle", name);
      expect(button("Continuer").disabled).toBe(true);
    }
  });

  it("given an open rule, when « Supprimer la règle » is clicked, then a confirmation is asked and nothing is sent, and once confirmed after: null is posted", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents?fichier=regles");
    await open("style");

    fireEvent.click(button("Supprimer la règle"));

    expect(calls.applyBodies).toEqual([]);
    fireEvent.click(button("Confirmer la suppression"));
    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { kind: "rule", name: "style", before: "Use tabs\n", after: null },
    ]);
  });
});

describe("decision 065 F: the skills", () => {
  it("given an open skill, when the tools are filled, then the file is rewritten with the header of the decision (allowed-tools only when not empty, a blank line before the instruction) and posted", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents?fichier=skills");
    await open("lint");
    expect(field("Description").value).toBe("Lints");
    expect(field("Consigne").value).toBe("Lint it\n");
    expect(screen.queryByLabelText("Nom")).toBeNull();
    expect(commitButton().disabled).toBe(true);

    type("Outils autorisés", "Read, Grep");

    expect(
      diffItems().some((t) => t.includes("allowed-tools: Read, Grep")),
    ).toBe(true);
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      {
        kind: "skill",
        name: "lint",
        before: SK,
        after:
          "---\nname: lint\ndescription: Lints\nallowed-tools: Read, Grep\n---\n\nLint it\n",
      },
    ]);
  });

  it("given « + Nouveau skill », when Nom, Description and Consigne are filled, then the commit posts before: null with the header of the decision and no allowed-tools line", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents?fichier=skills");
    await screen.findByRole("button", { name: "Ouvrir lint" });

    fireEvent.click(button("+ Nouveau skill"));
    type("Nom", "deploy");
    type("Description", "Ships");
    type("Consigne", "Ship it\n");
    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      {
        kind: "skill",
        name: "deploy",
        before: null,
        after: "---\nname: deploy\ndescription: Ships\n---\n\nShip it\n",
      },
    ]);
  });

  it("given a skill whose header is not readable, when it is opened, then it opens as raw text", async () => {
    stubApi({
      config: {
        status: 200,
        body: { ...CONFIG, skills: [{ name: "lint", text: "no header\n" }] },
      },
    });
    renderAt("/projets/5/agents?fichier=skills");

    await open("lint");

    expect(field("Ton texte").value).toBe("no header\n");
    expect(screen.queryByLabelText("Description")).toBeNull();
  });

  it("given an open skill, when it is deleted and confirmed, then after: null is posted", async () => {
    const calls = stubApi();
    renderAt("/projets/5/agents?fichier=skills");
    await open("lint");

    fireEvent.click(button("Supprimer le skill"));
    fireEvent.click(button("Confirmer la suppression"));

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([
      { kind: "skill", name: "lint", before: SK, after: null },
    ]);
  });
});

describe("decision 065 G: the refusals", () => {
  const edit = async (fichier = "mcp") => {
    renderAt(`/projets/5/agents?fichier=${fichier}`);
    await screen.findByLabelText("Ton texte");
    type("Ton texte", '{"mcpServers":{"a":{"headers":{"K":"v"}}}}\n');
    fireEvent.click(commitButton());
    return screen.findByRole("alert");
  };

  it("given .mcp.json refused with secret_in_clear at a path, when the commit is made, then the alert says in French that the path must be a reference like ${GITHUB_TOKEN}, without the code", async () => {
    stubApi({
      applies: [
        {
          status: 409,
          body: {
            error: "secret_in_clear",
            at: "mcpServers.github.headers.Authorization",
          },
        },
      ],
    });

    await edit();

    expect(alertText()).toContain(
      "mcpServers.github.headers.Authorization doit être une référence comme ${GITHUB_TOKEN} : un secret n'est jamais écrit dans un repo.",
    );
    expect(alertText()).not.toContain("secret_in_clear");
  });

  it.each([
    ["invalid_json", "pas valide"],
    ["repo_changed", "Recharge la page pour repartir de la version de GitHub."],
    ["project_archived", "archiv"],
  ])(
    "given the commit refused with %s, when it is made, then a French alert says it, without the code",
    async (code, sentence) => {
      stubApi({ applies: [{ status: 409, body: { error: code } }] });

      await edit();

      expect(alertText()).toContain(sentence);
      expect(alertText()).not.toContain(code);
    },
  );

  it("given GitHub unreachable at the commit, when it is made, then the alert offers « Réessayer »", async () => {
    stubApi({
      applies: [{ status: 502, body: { error: "github_unavailable" } }],
    });

    await edit("claude-md");

    expect(
      within(screen.getByRole("alert")).queryByText(/github_unavailable/),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeDefined();
  });

  it("given an archived project, when the editors open, then everything reads, the buttons are disabled with the reason and nothing is posted", async () => {
    const calls = stubApi({ archived: true });
    renderAt("/projets/5/agents?fichier=claude-md");
    await screen.findByLabelText("Ton texte");
    expect(field("Ton texte").value).toBe(CLAUDE);

    type("Ton texte", "changed\n");

    expect(commitButton().disabled).toBe(true);
    expect(screen.getByText(/archiv/i)).toBeDefined();
    fireEvent.click(commitButton());
    expect(calls.applyBodies).toEqual([]);
    cleanup();
    renderAt("/projets/5/agents?fichier=regles");
    await screen.findByRole("button", { name: "Ouvrir style" });
    expect(button("+ Nouvelle règle").disabled).toBe(true);
  });
});
