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
import { readTeam, type TeamStep, writeTeam } from "./team-file.ts";

// Slice 11.6 (decision 063 F, H): « Repartir d'une équipe de départ » in the section « Équipe » of the tab « Agents » (/projets/:id/agents).
//
// Pinned where the decision leaves it open:
// - A button « Repartir d'une équipe de départ » (disabled for an archived project) shows a group (fieldset, aria-label « Équipe de départ ») of four buttons named Éco, Standard, Premium, Max.
// - GET /api/starter-teams answers { teams: [{ id, team, agents: [{ name, text }] }] } (server tests: starter-teams-prepare.test.ts); the page asks for it when the button is clicked (or sooner).
// - Choosing a level puts its team (`readTeam(team)`) in the draft of the editor, the same draft as the other edits: the list shows its steps. Nothing is sent to GitHub or the server (no POST).
// - « Voir les changements » then shows the diff of team.md and, for every agent file that will change, its path (`.claude/agents/<name>.md`). « Faire le commit » posts ONE request to
//   /api/projects/:id/team/apply: { before: <team text or null>, after: <team of the level>, starterTeam: <id>, agents: [...] } where agents holds one { name, before, after } for
//   - an agent of the level that is not in the repo: before null, after = the text of the starter team response (catalogue text, level's model);
//   - an agent of the level that is in the repo with another model: before = its text, after = its text with the `model:` line replaced by the level's (added last in the front matter when it has none);
//   and none for an agent that already has the level's model or that is not in the level.
// - After the commit: « C'est fait » and the agents are read again, as for any team commit.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type AgentFile = { name: string; text: string };
const agentText = (name: string, model?: string) =>
  `---\nname: ${name}\ndescription: ${name} agent\n${model ? `model: ${model}\n` : ""}---\nYou are ${name}.\n`;
const REPO_AGENTS: AgentFile[] = [
  { name: "test-writer", text: agentText("test-writer", "opus") },
  { name: "developer", text: agentText("developer", "sonnet") },
  { name: "reviewer", text: agentText("reviewer") },
  { name: "doc-writer", text: agentText("doc-writer") },
];
const step = (agent: string, loopTo: string | null = null): TeamStep => ({
  agent,
  does: `${agent} does its part`,
  loopTo,
  until: loopTo ? "the verdict is ready" : "",
});
const level = (id: string, steps: [string, string, (string | null)?][]) => ({
  id,
  team: writeTeam(
    steps.map(([agent, , loop]) => step(agent, loop ?? null)),
    "",
  ),
  agents: steps.map(([name, model]) => ({
    name,
    text: agentText(name, model),
  })),
});
const STARTERS = [
  level("eco", [
    ["test-writer", "haiku"],
    ["developer", "sonnet"],
  ]),
  level("standard", [
    ["test-writer", "sonnet"],
    ["developer", "sonnet"],
    ["reviewer", "opus", "developer"],
  ]),
  level("premium", [
    ["test-writer", "sonnet"],
    ["developer", "sonnet"],
    ["reviewer", "opus", "developer"],
    ["doc-writer", "sonnet"],
    ["doc-reviewer", "sonnet", "doc-writer"],
  ]),
  level("max", [
    ["test-writer", "opus"],
    ["developer", "opus"],
    ["reviewer", "opus", "developer"],
    ["security-reviewer", "opus", "developer"],
    ["doc-writer", "opus"],
    ["doc-reviewer", "opus", "doc-writer"],
  ]),
];
const TEAM = writeTeam(
  [step("test-writer"), step("developer"), step("reviewer", "developer")],
  "",
);
const SHA = "a".repeat(40);
const GREEN = ["claude_md", "ci", "mcp", "agents"].map((key) => ({
  key,
  ok: true,
  detail: "ok",
}));

function stubApi(
  options: {
    team?: string | null;
    archived?: boolean;
    agents?: AgentFile[];
    teams?: { name: string; text: string }[];
  } = {},
) {
  const calls = {
    applyBodies: [] as Record<string, unknown>[],
    reads: 0,
    posts: 0,
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
      if (method === "POST") calls.posts++;
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
              starterTeam: "standard",
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
        return Response.json({ lines: GREEN });
      if (path === "/api/projects/5/agents" && method === "GET") {
        calls.reads++;
        return Response.json({
          agents: options.agents ?? REPO_AGENTS,
          teams: options.teams ?? [],
          catalog: [],
          team: options.team === undefined ? TEAM : options.team,
        });
      }
      if (path === "/api/starter-teams")
        return Response.json({ teams: STARTERS });
      if (path === "/api/projects/5/team/apply" && method === "POST") {
        calls.applyBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ commitSha: SHA });
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
  await waitFor(() =>
    expect(screen.queryByText("Chargement du graphe…")).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Liste" }));
};
const rowAgents = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => within(li).queryByRole("button", { name: "Monter" }))
    .map((li) => /^\s*\d+\s*([a-z0-9-]+)/.exec(li.textContent ?? "")?.[1]);
const startFrom = (name: string) => {
  if (!screen.queryByRole("group", { name: "Équipe de départ" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Repartir d'une équipe de départ" }),
    );
  fireEvent.click(
    within(screen.getByRole("group", { name: "Équipe de départ" })).getByRole(
      "button",
      { name },
    ),
  );
};
const sentAgent = (calls: ReturnType<typeof stubApi>, name: string) =>
  (
    (calls.applyBodies[0] as { agents: unknown }).agents as {
      name: string;
      before: string | null;
      after: string;
    }[]
  ).find((a) => a.name === name);

describe("decision 063 F: « Repartir d'une équipe de départ »", () => {
  it("given the tab Agents, when it opens, then the button is there and the four levels appear once it is clicked, in order", async () => {
    stubApi();
    await openTeam();

    fireEvent.click(
      screen.getByRole("button", { name: "Repartir d'une équipe de départ" }),
    );

    const buttons = within(
      screen.getByRole("group", { name: "Équipe de départ" }),
    ).getAllByRole("button");
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      "Éco",
      "Standard",
      "Premium",
      "Max",
    ]);
  });

  it("given an archived project, when the tab opens, then the button is disabled", async () => {
    stubApi({ archived: true });
    await openTeam();

    expect(
      (
        screen.getByRole("button", {
          name: "Repartir d'une équipe de départ",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("given a level chosen, when the draft loads, then the list shows the steps of that team and nothing was sent", async () => {
    const calls = stubApi();
    await openTeam();

    startFrom("Premium");

    await waitFor(() =>
      expect(rowAgents()).toEqual([
        "test-writer",
        "developer",
        "reviewer",
        "doc-writer",
        "doc-reviewer",
      ]),
    );
    expect(calls.posts).toBe(0);
  });

  it("given a level chosen and not committed, when the tab is looked at, then « Modifier sur le canevas » is disabled (the level's agents are written only by the tab's commit)", async () => {
    stubApi();
    await openTeam();
    const canvasButton = () =>
      screen.getByRole("button", {
        name: "Modifier sur le canevas",
      }) as HTMLButtonElement;
    expect(canvasButton().disabled).toBe(false);

    startFrom("Premium");

    await waitFor(() => expect(rowAgents()).toHaveLength(5));
    expect(canvasButton().disabled).toBe(true);
  });

  it("given Éco chosen, when the draft loads, then the reviewer is gone from the steps", async () => {
    stubApi();
    await openTeam();

    startFrom("Éco");

    await waitFor(() =>
      expect(rowAgents()).toEqual(["test-writer", "developer"]),
    );
  });

  it("given Premium chosen, when « Voir les changements » is clicked, then the diff names the team file and every agent file that will change", async () => {
    stubApi();
    await openTeam();
    startFrom("Premium");
    await waitFor(() => expect(rowAgents()).toHaveLength(5));

    fireEvent.click(
      screen.getByRole("button", { name: "Voir les changements" }),
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain(".claude/team.md");
    for (const name of [
      "doc-reviewer",
      "doc-writer",
      "reviewer",
      "test-writer",
    ])
      expect(text, name).toContain(`.claude/agents/${name}.md`);
    expect(text).not.toContain(".claude/agents/developer.md");
  });

  it("given Premium chosen, when « Faire le commit » is clicked, then one request carries the team, the level and the agents to add or to change, and C'est fait follows", async () => {
    const calls = stubApi();
    await openTeam();
    startFrom("Premium");
    await waitFor(() => expect(rowAgents()).toHaveLength(5));
    fireEvent.click(
      screen.getByRole("button", { name: "Voir les changements" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Faire le commit" }));

    await screen.findByText("C'est fait");
    expect(calls.applyBodies).toHaveLength(1);
    const sent = calls.applyBodies[0] as Record<string, unknown>;
    expect(sent.before).toBe(TEAM);
    expect(sent.starterTeam).toBe("premium");
    expect(
      readTeam(String(sent.after))?.steps.map((s) => [s.agent, s.loopTo]),
    ).toEqual([
      ["test-writer", null],
      ["developer", null],
      ["reviewer", "developer"],
      ["doc-writer", null],
      ["doc-reviewer", "doc-writer"],
    ]);
    const agents = sent.agents as { name: string }[];
    expect(agents.map((a) => a.name).sort()).toEqual([
      "doc-reviewer",
      "doc-writer",
      "reviewer",
      "test-writer",
    ]);
    // Added from the catalogue (the starter team's text) with the level's model.
    expect(sentAgent(calls, "doc-reviewer")).toEqual({
      name: "doc-reviewer",
      before: null,
      after: agentText("doc-reviewer", "sonnet"),
    });
    // Existing agents take the model of the level and keep the rest of their file.
    expect(sentAgent(calls, "test-writer")).toEqual({
      name: "test-writer",
      before: agentText("test-writer", "opus"),
      after: agentText("test-writer", "sonnet"),
    });
    expect(sentAgent(calls, "doc-writer")).toEqual({
      name: "doc-writer",
      before: agentText("doc-writer"),
      after: agentText("doc-writer", "sonnet"),
    });
    const reviewer = sentAgent(calls, "reviewer");
    expect(reviewer?.before).toBe(agentText("reviewer"));
    expect(reviewer?.after).toMatch(/^model:\s*opus\s*$/m);
    expect(reviewer?.after.replace(/^model:.*\n/m, "")).toBe(
      agentText("reviewer"),
    );
    await waitFor(() => expect(calls.reads).toBeGreaterThan(1));
  });

  it("given a repo without team.md, when Max is chosen and committed, then before is null and the security-reviewer comes from the starter team", async () => {
    const calls = stubApi({ team: null });
    await openTeam();
    startFrom("Max");
    await waitFor(() => expect(rowAgents()).toHaveLength(6));
    fireEvent.click(
      screen.getByRole("button", { name: "Voir les changements" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Faire le commit" }));

    await screen.findByText("C'est fait");
    expect(calls.applyBodies[0]).toMatchObject({
      before: null,
      starterTeam: "max",
    });
    expect(sentAgent(calls, "security-reviewer")).toEqual({
      name: "security-reviewer",
      before: null,
      after: agentText("security-reviewer", "opus"),
    });
    expect(sentAgent(calls, "developer")?.after).toMatch(/^model:\s*opus\s*$/m);
  });
});

// Decision 063 review (B1, S3, S7), pinned:
// - B1: when the team text does not change but agents do, « Faire le commit » is enabled and sends before === after (the team text as read) with the agents; « C'est fait » follows.
// - S3: the `model:` line is replaced or added only inside the front matter; a `model:` line of the body is untouched; a file with no front matter gets `---\nmodel: <m>\n---\n` put in front of its text.
// - S7: choosing a level while the draft or the agent changes are unsaved shows the warning « Les changements non enregistrés seront perdus » with « Confirmer le changement » and « Annuler »
//   (the pattern of the team switch); nothing changes before the confirmation. A level that only changes agents counts as unsaved changes for switching teams too.
describe("decision 063 review: B1, S3, S7", () => {
  it.each([
    ["Premium", "premium"],
    ["Standard", "standard"],
  ])(
    "B1: given a team.md equal to the %s text and a reviewer changed by hand, when the level is chosen again and committed, then before === after with the agents, and C'est fait",
    async (name, id) => {
      const starter = STARTERS.find(
        (t) => t.id === id,
      ) as (typeof STARTERS)[number];
      const calls = stubApi({
        team: starter.team,
        agents: [
          ...starter.agents.map((a) => ({
            name: a.name,
            text:
              a.name === "reviewer" ? agentText("reviewer", "haiku") : a.text,
          })),
        ],
      });
      await openTeam();

      startFrom(name);
      fireEvent.click(
        await screen.findByRole("button", { name: "Voir les changements" }),
      );
      const commit = screen.getByRole("button", {
        name: "Faire le commit",
      }) as HTMLButtonElement;
      await waitFor(() => expect(commit.disabled).toBe(false));
      fireEvent.click(commit);

      await screen.findByText("C'est fait");
      const sent = calls.applyBodies[0] as Record<string, unknown>;
      expect(sent.before).toBe(starter.team);
      expect(sent.after).toBe(starter.team);
      expect(sent.starterTeam).toBe(id);
      expect((sent.agents as { name: string }[]).map((a) => a.name)).toEqual([
        "reviewer",
      ]);
    },
  );

  it("S3: given an agent whose body has a model: line and another with no front matter, when Premium is committed, then the model goes in the front matter only and the plain file gets one", async () => {
    const body = "---\nname: reviewer\n---\nText\nmodel: haiku\nmore\n";
    const plain = "Plain test-writer.\n";
    const calls = stubApi({
      agents: [
        ...REPO_AGENTS.filter(
          (a) => !["reviewer", "test-writer"].includes(a.name),
        ),
        { name: "reviewer", text: body },
        { name: "test-writer", text: plain },
      ],
    });
    await openTeam();
    startFrom("Premium");
    await waitFor(() => expect(rowAgents()).toHaveLength(5));
    fireEvent.click(
      screen.getByRole("button", { name: "Voir les changements" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Faire le commit" }));

    await screen.findByText("C'est fait");
    expect(sentAgent(calls, "reviewer")?.after).toBe(
      "---\nname: reviewer\nmodel: opus\n---\nText\nmodel: haiku\nmore\n",
    );
    expect(sentAgent(calls, "test-writer")?.after).toBe(
      `---\nmodel: sonnet\n---\n${plain}`,
    );
  });

  it("S7: given unsaved changes in the draft, when another level is chosen, then the warning shows first, the draft is kept until Confirmer le changement, and Annuler keeps it", async () => {
    stubApi();
    await openTeam();
    startFrom("Éco");
    await waitFor(() =>
      expect(rowAgents()).toEqual(["test-writer", "developer"]),
    );

    startFrom("Premium");

    expect(
      screen.getByText("Les changements non enregistrés seront perdus"),
    ).toBeDefined();
    expect(rowAgents()).toEqual(["test-writer", "developer"]);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(rowAgents()).toEqual(["test-writer", "developer"]);
    startFrom("Premium");
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer le changement" }),
    );
    await waitFor(() => expect(rowAgents()).toHaveLength(5));
  });

  it("S7: given a level that only changes agents, when another team is chosen in the picker, then the warning shows too", async () => {
    const premium = STARTERS.find(
      (t) => t.id === "premium",
    ) as (typeof STARTERS)[number];
    stubApi({
      team: premium.team,
      teams: [{ name: "leger", text: TEAM }],
      agents: premium.agents.map((a) => ({
        name: a.name,
        text: a.name === "reviewer" ? agentText("reviewer", "haiku") : a.text,
      })),
    });
    await openTeam();
    startFrom("Premium");

    fireEvent.click(screen.getByRole("button", { name: "leger" }));

    expect(
      screen.getByText("Les changements non enregistrés seront perdus"),
    ).toBeDefined();
  });

  // N1 (re-review): the front matter is found with CRLF line endings too, and written back verbatim (no `$` pattern of String.replace is interpreted).
  const commitPremium = async (agents: AgentFile[]) => {
    const calls = stubApi({
      agents: [
        ...REPO_AGENTS.filter((a) => !agents.some((x) => x.name === a.name)),
        ...agents,
      ],
    });
    await openTeam();
    startFrom("Premium");
    await waitFor(() => expect(rowAgents()).toHaveLength(5));
    fireEvent.click(
      screen.getByRole("button", { name: "Voir les changements" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Faire le commit" }));
    await screen.findByText("C'est fait");
    return calls;
  };

  it("S3/N1: given a CRLF agent file whose front matter already has the level's model, when Premium is committed, then it is not counted as changed", async () => {
    const crlf = "---\r\nname: test-writer\r\nmodel: sonnet\r\n---\r\nBody\r\n";

    const calls = await commitPremium([{ name: "test-writer", text: crlf }]);

    expect(sentAgent(calls, "test-writer")).toBeUndefined();
  });

  it("S3/N1: given a CRLF agent file with another model, when Premium is committed, then its model line is replaced in place, with no second front matter and the rest byte-identical", async () => {
    const crlf =
      "---\r\nname: test-writer\r\nmodel: opus\r\n---\r\nBody\r\nmore\r\n";

    const calls = await commitPremium([{ name: "test-writer", text: crlf }]);

    expect(sentAgent(calls, "test-writer")?.after).toBe(
      "---\r\nname: test-writer\r\nmodel: sonnet\r\n---\r\nBody\r\nmore\r\n",
    );
  });

  it("S3/N1: given a front matter with $$5, $' and $& in its description, when Premium is committed, then it is written back verbatim and only the model line changes", async () => {
    const text =
      "---\nname: reviewer\ndescription: costs $$5, see $' here and $&\nmodel: haiku\n---\nBody $& $'\n";

    const calls = await commitPremium([{ name: "reviewer", text }]);

    expect(sentAgent(calls, "reviewer")?.after).toBe(
      text.replace("model: haiku", "model: opus"),
    );
  });
});
