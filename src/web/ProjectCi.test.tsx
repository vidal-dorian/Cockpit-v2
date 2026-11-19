// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 12.4 (decision 067 A to D, F to H): the tab « CI / CD » of /projets/:id/ci (S15).
//
// Contract assumed where the decision leaves it open (server tests: workflows.test.ts, workflow-proposals.test.ts, workflow-ask.test.ts):
// - The tab reads GET /api/projects/:id/workflows -> { workflows: [{ path, name, event, lastRun: { conclusion, at, url } | null, failingSince, averageSeconds }],
//   starter: null | { language: null } | { language, path, content }, permission: { workflows: boolean, installationUrl }, proposal: null | { id, path, reason, before, content, createdAt } }.
// - The state sentence (a paragraph of the page): « La CI passe. », « <nom> échoue depuis N exécutions. » (the first red workflow, in the list order; when several are red and another has failed
//   for more runs, a second paragraph says the same of the one that failed the longest), « Pas encore de CI. » without workflow.
// - The section « Les workflows » (h2) lists one `li` per workflow: « <fichier> · <nom> » (fichier = last part of the path), ✓ or ✕ (alone in its element), « sur <événement> · N min en moyenne »
//   or « échoue depuis N exécutions », and « il y a … » (ago()). A red one has a button « Demander à Claude ».
// - « Demander à Claude » posts { path } to /api/projects/:id/workflows/ask (answer 201 { launchId, sessionUrl }): « Lancé dans le cloud » and a link « Voir la session » (as 054); a refusal is
//   a role="alert" in French, inside the line of the workflow, never the code.
// - The card « Une CI de départ » (h2) shows `starter.content` in full and « Faire le commit », which posts { language } to /api/projects/:id/workflows/starter/apply (answer { commitSha }):
//   « C'est fait » with a link to the commit. `{ language: null }`: « Cockpit ne reconnaît pas le langage de ce repo. » and no button; `null`: no card.
// - The section « Ce que Claude propose · un changement à la fois » (h2) shows the proposal: its reason, its file, the diff (DiffList: items « Ajoutée » / « Retirée »), « Faire le commit »
//   (posts to /api/workflow-proposals/:id/commit), « Ignorer » (posts to .../ignore) and the note « Cockpit ne modifie un workflow qu'avec ton accord. ». Without proposal there is no such button.
// - Without the permission, « Faire le commit » (starter and proposal) is disabled and the page says « Cockpit n'a pas encore le droit d'écrire les workflows. Approuve la nouvelle permission sur GitHub. »
//   with a link to `permission.installationUrl`.
// - A refusal of a commit is a role="alert" in French, never the code; `workflows_forbidden` says the permission sentence.
// - Colours (045, 067 H): the ✕ of a red workflow has the class `text-destructive` (the ✓ has not); « Faire le commit » has `bg-primary`, « Ignorer » and « Demander à Claude » have not.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Answer = { status: number; body: unknown };
type Workflow = {
  path: string;
  name: string;
  event: string | null;
  lastRun: { conclusion: string; at: string; url: string } | null;
  failingSince: number;
  averageSeconds: number | null;
};
type Proposal = {
  id: number;
  path: string;
  reason: string;
  before: string | null;
  content: string;
  createdAt: string;
};

const SHA = "a".repeat(40);
const SESSION = "https://claude.ai/code/session_01ABCDEFGHIJ";
const INSTALLATION = "https://github.com/settings/installations/77";
const NO_RIGHT =
  "Cockpit n'a pas encore le droit d'écrire les workflows. Approuve la nouvelle permission sur GitHub.";
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000 - 30_000).toISOString();

const GREEN: Workflow = {
  path: ".github/workflows/ci.yml",
  name: "lint, typecheck, test, build",
  event: "push",
  lastRun: {
    conclusion: "success",
    at: hoursAgo(2),
    url: "https://github.com/octocat/hello/actions/runs/1",
  },
  failingSince: 0,
  averageSeconds: 240,
};
const red = (name: string, file: string, since: number): Workflow => ({
  path: `.github/workflows/${file}`,
  name,
  event: "schedule",
  lastRun: {
    conclusion: "failure",
    at: hoursAgo(7),
    url: "https://github.com/octocat/hello/actions/runs/2",
  },
  failingSince: since,
  averageSeconds: 600,
});
const RED = red("Tests de bout en bout", "nightly.yml", 3);
const STARTER = {
  language: "node",
  path: ".github/workflows/ci.yml",
  content:
    "name: CI\non: [push, pull_request]\njobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npm test\n",
};
const PROPOSAL: Proposal = {
  id: 9,
  path: ".github/workflows/ci.yml",
  reason: "Mettre en cache les dépendances npm",
  before: "steps:\n  - run: npm ci\n",
  content: "steps:\n  - uses: actions/cache@v4\n  - run: npm ci\n",
  createdAt: "2026-11-08T10:00:00Z",
};

type State = {
  workflows: Workflow[];
  starter: unknown;
  permission: { workflows: boolean; installationUrl: string };
  proposal: Proposal | null;
};

/** A small fake server behind fetch; the answers of the writes are `answers`, the 200s empty the proposal like a refetch would. */
function stubApi(
  over: Partial<State> = {},
  answers: { post?: Answer; ask?: Answer } = {},
) {
  const state: State = {
    workflows: [GREEN, RED],
    starter: null,
    permission: { workflows: true, installationUrl: INSTALLATION },
    proposal: null,
    ...over,
  };
  const posts: { path: string; body: unknown }[] = [];
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
      if (path === "/api/projects/5/health")
        return Response.json({ lines: [] });
      if (path === "/api/projects/5/workflows" && method === "GET")
        return Response.json(state);
      if (method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        posts.push({ path, body });
        const isAsk = path === "/api/projects/5/workflows/ask";
        const answer = (isAsk ? answers.ask : answers.post) ?? {
          status: isAsk ? 201 : 200,
          body: isAsk
            ? { launchId: 1, sessionUrl: SESSION }
            : { commitSha: SHA },
        };
        if (answer.status === 200) state.proposal = null;
        return Response.json(answer.body, { status: answer.status });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return posts;
}

function renderAt(path = "/projets/5/ci") {
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
  screen.findByRole("button", { name }) as Promise<HTMLButtonElement>;
/** The line of a workflow, by its file name. */
const line = async (file: string) => {
  await screen.findByText(new RegExp(file.replace(".", "\\.")));
  const found = screen
    .getAllByRole("listitem")
    .filter((li) => li.textContent?.includes(file));
  return found.at(-1) as HTMLElement;
};
const section = async (title: RegExp) =>
  (await screen.findByRole("heading", { level: 2, name: title }))
    .parentElement as HTMLElement;

describe("decision 067 A: the tab and its state sentence", () => {
  it("given a project, when /projets/:id/ci opens, then the tab « CI / CD » is the open one and the section « Les workflows » shows", async () => {
    stubApi();

    renderAt();

    expect(
      await screen.findByRole("heading", { level: 2, name: /^Les workflows/ }),
    ).toBeDefined();
    const nav = screen.getByRole("navigation", { name: "Sections du projet" });
    const tab = within(nav).getByRole("link", { name: "CI / CD" });
    expect(tab.getAttribute("href")).toBe("/projets/5/ci");
    expect(tab.getAttribute("aria-current")).toBe("page");
  });

  it.each([
    ["every workflow passes", [GREEN], [/La CI passe\./], /échoue depuis/],
    ["no workflow exists", [], [/Pas encore de CI\./], /La CI passe\./],
    [
      "one workflow is red",
      [GREEN, RED],
      [/Tests de bout en bout échoue depuis 3 exécutions\./],
      /La CI passe\./,
    ],
    [
      "two workflows are red, the second for longer",
      [red("Build", "build.yml", 2), red("Deploy", "deploy.yml", 5)],
      [
        /Build échoue depuis 2 exécutions\./,
        /Deploy échoue depuis 5 exécutions\./,
      ],
      /La CI passe\./,
    ],
  ] as [string, Workflow[], RegExp[], RegExp][])(
    "given %s, when the tab opens, then the state sentence says so",
    async (_name, workflows, sentences, absent) => {
      stubApi({ workflows });

      renderAt();

      const found: Element[] = [];
      for (const sentence of sentences)
        found.push((await screen.findAllByText(sentence))[0] as Element);
      expect(screen.queryByText(absent)).toBeNull();
      // The sentence of the first red workflow comes first.
      if (found.length === 2)
        expect(found[0]?.compareDocumentPosition(found[1] as Element)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
    },
  );
});

describe("decision 067 B: the workflow lines", () => {
  it("given a green and a red workflow, when the tab opens, then each line shows its file and name, its mark, its event and average or its streak, and how long ago", async () => {
    stubApi();

    renderAt();

    const ci = await line("ci.yml");
    expect(ci.textContent).toContain("ci.yml · lint, typecheck, test, build");
    expect(ci.textContent).toContain("✓");
    expect(ci.textContent).toContain("sur push · 4 min en moyenne");
    expect(ci.textContent).toContain("il y a 2 h");
    expect(within(ci).queryByRole("button")).toBeNull();
    const night = await line("nightly.yml");
    expect(night.textContent).toContain("nightly.yml · Tests de bout en bout");
    expect(night.textContent).toContain("✕");
    expect(night.textContent).toContain("échoue depuis 3 exécutions");
    expect(night.textContent).not.toContain("en moyenne");
    expect(night.textContent).toContain("il y a 7 h");
    expect(
      within(night).getByRole("button", { name: "Demander à Claude" }),
    ).toBeDefined();
  });
});

describe("decision 067 C: the starter CI", () => {
  const empty = { workflows: [], starter: STARTER };

  it("given a repo with no workflow, when the tab opens, then the card « Une CI de départ » shows the whole template", async () => {
    stubApi(empty);

    renderAt();

    await screen.findByRole("heading", { level: 2, name: /Une CI de départ/ });
    expect(document.body.textContent).toContain(STARTER.content);
  });

  it("given a starter, when « Faire le commit » is clicked, then the language is posted and « C'est fait » links to the commit", async () => {
    const posts = stubApi(empty);
    renderAt();

    fireEvent.click(await button("Faire le commit"));

    expect(await screen.findByText(/C'est fait/)).toBeDefined();
    expect(posts).toEqual([
      {
        path: "/api/projects/5/workflows/starter/apply",
        body: { language: "node" },
      },
    ]);
    expect(
      screen
        .getAllByRole("link")
        .some(
          (l) =>
            l.getAttribute("href") ===
            `https://github.com/octocat/hello/commit/${SHA}`,
        ),
    ).toBe(true);
  });

  it("given nothing recognised, when the tab opens, then the card says so and offers no commit", async () => {
    stubApi({ workflows: [], starter: { language: null } });

    renderAt();

    expect(
      await screen.findByText(
        "Cockpit ne reconnaît pas le langage de ce repo.",
      ),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Faire le commit" }),
    ).toBeNull();
  });

  it("given a repo that has workflows, when the tab opens, then there is no starter card", async () => {
    stubApi({ starter: null });

    renderAt();

    await line("ci.yml");
    expect(screen.queryByText(/Une CI de départ/)).toBeNull();
  });
});

describe("decision 067 D: the permission workflows", () => {
  it.each([
    ["the starter", { workflows: [], starter: STARTER, proposal: null }],
    ["a proposal", { proposal: PROPOSAL }],
  ] as [string, Partial<State>][])(
    "given an installation without the permission, when the tab shows %s, then « Faire le commit » is disabled with the sentence and a link to the installation",
    async (_name, over) => {
      const posts = stubApi({
        ...over,
        permission: { workflows: false, installationUrl: INSTALLATION },
      });
      renderAt();

      const commit = await button("Faire le commit");

      expect(commit.disabled).toBe(true);
      expect(screen.getAllByText(NO_RIGHT).length).toBeGreaterThan(0);
      expect(
        screen
          .getAllByRole("link")
          .some((l) => l.getAttribute("href") === INSTALLATION),
      ).toBe(true);
      fireEvent.click(commit);
      expect(posts).toEqual([]);
    },
  );

  it("given the permission, when the tab shows a proposal, then « Faire le commit » is enabled and the sentence is not shown", async () => {
    stubApi({ proposal: PROPOSAL });

    renderAt();

    expect((await button("Faire le commit")).disabled).toBe(false);
    expect(screen.queryByText(NO_RIGHT)).toBeNull();
  });
});

describe("decision 067 F: what Claude proposes", () => {
  it("given a proposal, when the tab opens, then the section shows its reason, its file, the diff, the two buttons and the note", async () => {
    stubApi({ proposal: PROPOSAL });

    renderAt();

    const box = within(await section(/^Ce que Claude propose/));
    expect(box.getByText("Mettre en cache les dépendances npm")).toBeDefined();
    expect(box.getByText(/ci\.yml/)).toBeDefined();
    const items = box
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "")
      .filter((t) => /Retirée|Ajoutée/.test(t));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/Ajoutée.*actions\/cache@v4/);
    expect(box.getByRole("button", { name: "Faire le commit" })).toBeDefined();
    expect(box.getByRole("button", { name: "Ignorer" })).toBeDefined();
    expect(
      box.getByText("Cockpit ne modifie un workflow qu'avec ton accord."),
    ).toBeDefined();
  });

  it("given no proposal, when the tab opens, then there is nothing to commit or ignore", async () => {
    stubApi({ proposal: null });

    renderAt();

    await line("ci.yml");
    expect(
      screen.queryByRole("button", { name: "Faire le commit" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Ignorer" })).toBeNull();
  });

  it("given a proposal, when « Faire le commit » is clicked, then the commit is posted, « C'est fait » links to it and the proposal goes", async () => {
    const posts = stubApi({ proposal: PROPOSAL });
    renderAt();

    fireEvent.click(await button("Faire le commit"));

    expect(await screen.findByText(/C'est fait/)).toBeDefined();
    expect(posts.map((p) => p.path)).toEqual([
      "/api/workflow-proposals/9/commit",
    ]);
    expect(
      screen
        .getAllByRole("link")
        .some(
          (l) =>
            l.getAttribute("href") ===
            `https://github.com/octocat/hello/commit/${SHA}`,
        ),
    ).toBe(true);
  });

  it("given a proposal, when « Ignorer » is clicked, then the ignore is posted and the proposal goes", async () => {
    const posts = stubApi({ proposal: PROPOSAL });
    renderAt();

    fireEvent.click(await button("Ignorer"));

    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ignorer" })).toBeNull(),
    );
    expect(posts.map((p) => p.path)).toEqual([
      "/api/workflow-proposals/9/ignore",
    ]);
  });
});

describe("decisions 067 C, D, F: the refusals of a commit, in French", () => {
  it.each([
    ["repo_changed", 409],
    ["already_decided", 409],
    ["workflows_forbidden", 409],
    ["github_unavailable", 502],
  ])(
    "given a proposal commit refused with %s, when « Faire le commit » is clicked, then a French alert without the code shows",
    async (error, status) => {
      stubApi({ proposal: PROPOSAL }, { post: { status, body: { error } } });
      renderAt();

      fireEvent.click(await button("Faire le commit"));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent?.trim().length).toBeGreaterThan(10);
      expect(alert.textContent).not.toContain(error);
      if (error === "workflows_forbidden")
        expect(alert.textContent).toContain(NO_RIGHT);
    },
  );

  it.each(["wrong_language", "repo_changed", "workflows_forbidden"])(
    "given the starter refused with %s, when « Faire le commit » is clicked, then a French alert without the code shows",
    async (error) => {
      stubApi(
        { workflows: [], starter: STARTER },
        { post: { status: 409, body: { error } } },
      );
      renderAt();

      fireEvent.click(await button("Faire le commit"));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent?.trim().length).toBeGreaterThan(10);
      expect(alert.textContent).not.toContain(error);
    },
  );
});

describe("decision 067 G: Demander à Claude", () => {
  it("given a red workflow, when « Demander à Claude » is clicked, then its path is posted and the line says « Lancé dans le cloud » with a link to the session", async () => {
    const posts = stubApi();
    renderAt();
    const night = await line("nightly.yml");

    fireEvent.click(
      within(night).getByRole("button", { name: "Demander à Claude" }),
    );

    expect(await within(night).findByText(/Lancé dans le cloud/)).toBeDefined();
    expect(posts).toEqual([
      {
        path: "/api/projects/5/workflows/ask",
        body: { path: ".github/workflows/nightly.yml" },
      },
    ]);
    expect(
      within(night)
        .getByRole("link", { name: /Voir la session/ })
        .getAttribute("href"),
    ).toBe(SESSION);
  });

  it.each([
    [409, "launcher_not_connected"],
    [409, "project_not_in_launcher"],
    [409, "monthly_budget_reached"],
    [409, "project_archived"],
    [502, "fire_failed"],
  ])(
    "given the launch refused %i %s, when « Demander à Claude » is clicked, then a French alert without the code shows next to the button",
    async (status, error) => {
      stubApi({}, { ask: { status, body: { error } } });
      renderAt();
      const night = await line("nightly.yml");

      fireEvent.click(
        within(night).getByRole("button", { name: "Demander à Claude" }),
      );

      const alert = await within(night).findByRole("alert");
      expect(alert.textContent?.trim().length).toBeGreaterThan(10);
      expect(alert.textContent).not.toContain(error);
      expect(within(night).queryByText(/Lancé dans le cloud/)).toBeNull();
    },
  );
});

describe("decision 067 H: the colour", () => {
  it("given a red workflow and a proposal, when the tab opens, then only the ✕ is red and « Faire le commit » is the only white button", async () => {
    stubApi({ proposal: PROPOSAL });

    renderAt();

    expect((await screen.findByText("✕")).className).toContain(
      "text-destructive",
    );
    for (const ok of screen.getAllByText("✓"))
      expect(ok.className).not.toContain("text-destructive");
    expect((await button("Faire le commit")).className).toContain("bg-primary");
    expect((await button("Ignorer")).className).not.toContain("bg-primary");
    expect((await button("Demander à Claude")).className).not.toContain(
      "bg-primary",
    );
  });
});

// Story S12 (decision 085 B, E): `workflows[].claude` is null or { sessionUrl, startedAt, finishedAt, outcome, summary } (the last « Demander à Claude » of the path);
// the tab of the project says « CI / CD · N à relire » while a proposal waits.
const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();
const asked = (claude: Record<string, unknown>) => ({ ...RED, claude });
const RUNNING = {
  sessionUrl: SESSION,
  startedAt: minutesAgo(4),
  finishedAt: null,
  outcome: null,
  summary: null,
};

describe("S12: « Demander à Claude » stays visible after a reload", () => {
  it("given a launch in progress, when the tab opens, then the line says Claude is looking, links the session and the button is disabled", async () => {
    stubApi({ workflows: [asked(RUNNING) as never] });
    renderAt();
    const night = await line("nightly.yml");

    expect(
      await within(night).findByText(/Claude regarde depuis 4 min/),
    ).toBeDefined();
    expect(
      within(night)
        .getByRole("link", { name: /Voir la session/ })
        .getAttribute("href"),
    ).toBe(SESSION);
    expect(
      (
        within(night).getByRole("button", {
          name: "Demander à Claude",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("given a finished launch with a summary, when the tab opens, then the summary shows on the line and the button is enabled again", async () => {
    stubApi({
      workflows: [
        asked({
          ...RUNNING,
          finishedAt: minutesAgo(1),
          outcome: "succeeded",
          summary: "La cause est un test instable, pas le workflow.",
        }) as never,
      ],
    });
    renderAt();
    const night = await line("nightly.yml");

    expect(
      await within(night).findByText(
        /La cause est un test instable, pas le workflow\./,
      ),
    ).toBeDefined();
    expect(
      (
        within(night).getByRole("button", {
          name: "Demander à Claude",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("given a finished launch, when Claude is asked again and the server accepts, then the line says the new launch started, not the old summary", async () => {
    stubApi({
      workflows: [
        asked({
          ...RUNNING,
          finishedAt: minutesAgo(1),
          outcome: "succeeded",
          summary: "La cause est un test instable, pas le workflow.",
        }) as never,
      ],
    });
    renderAt();
    const night = await line("nightly.yml");

    fireEvent.click(
      within(night).getByRole("button", { name: "Demander à Claude" }),
    );

    expect(await within(night).findByText(/Lancé dans le cloud/)).toBeDefined();
    expect(within(night).queryByText(/test instable/)).toBeNull();
  });

  it("given the server refuses a second launch with launch_running, when the button is clicked, then the line shows an alert in French, never the code", async () => {
    stubApi({}, { ask: { status: 409, body: { error: "launch_running" } } });
    renderAt();
    const night = await line("nightly.yml");

    fireEvent.click(
      within(night).getByRole("button", { name: "Demander à Claude" }),
    );

    const alert = await within(night).findByRole("alert");
    expect(alert.textContent?.trim().length).toBeGreaterThan(10);
    expect(alert.textContent).not.toContain("launch_running");
  });
});

describe("S12: a proposal is signalled on the tab", () => {
  it("given a pending proposal, when another tab of the project is open, then the tab reads « CI / CD · 1 à relire » without the red of the destructive token", async () => {
    stubApi({ proposal: PROPOSAL });
    renderAt("/projets/5");

    const nav = await screen.findByRole("navigation", {
      name: "Sections du projet",
    });
    const tab = await within(nav).findByRole("link", {
      name: "CI / CD · 1 à relire",
    });
    expect(tab.getAttribute("href")).toBe("/projets/5/ci");
    expect(tab.className).not.toContain("destructive");
  });

  it("given no proposal, when the project opens, then the tab reads « CI / CD »", async () => {
    stubApi({ proposal: null });
    renderAt("/projets/5");

    const nav = await screen.findByRole("navigation", {
      name: "Sections du projet",
    });
    expect(within(nav).getByRole("link", { name: "CI / CD" })).toBeDefined();
    expect(within(nav).queryByRole("link", { name: /à relire/ })).toBeNull();
  });
});
