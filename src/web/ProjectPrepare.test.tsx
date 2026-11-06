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

// Slice 6.2 (decision 027 F): « Préparer pour Claude » in the section « Bilan de santé » of /projets/:id.
//
// Pinned where the decision leaves it open:
// - The button is a <button> named « Préparer pour Claude », shown when the line claude_md or agents is red (and only then); disabled on an archived project
//   (GET /api/projects gives `archived: true`). The plan is read when the button is clicked (POST /api/projects/:id/prepare, no body), not when the page loads.
// - The plan is `{ plan: { baseSha, signature, files: [{ path, content, status, current? }] } }` (server tests: prepare.test.ts). Each file is a list item
//   (`li`) that holds its path and one of the four labels of the decision, in French, whole:
//   « Sera ajouté » (the content is in a closed <details>), « Déjà là, identique », « Déjà là, différent : laissé tel quel » (with the diff of the current
//   text to the proposed one: list items, a removed line holding the word « Retirée », an added one « Ajoutée », as on the page of a diverged issue, 025 E)
//   and « Déjà là, pas un simple fichier : laissé tel quel » (an `exists` file with no `current`).
// - « Faire le commit » (a button) is disabled when no file is `create`. Clicking it sends POST /api/projects/:id/prepare/apply with the body { plan } where
//   plan is the one received, untouched (it is signed), and is disabled while the request is in flight.
// - The answer is 200 { commitSha, created, pullRequest?: { number, url } }: « C'est fait » and a link to https://github.com/<full_name>/commit/<sha>; or, with pullRequest,
//   « La branche par défaut est protégée : une pull request est ouverte » and a link to its url. Then the health is read again (its lines are shown again).
// - A refusal is 409 { error: "<code>" } (`pull_request_forbidden` also has `appSettingsUrl`): a role="alert" in French, never the code.
//   `repo_changed`: « Le repo a changé entre-temps : regarde de nouveau », and the plan is read again (a second POST /prepare, its files shown).
//   `pull_request_forbidden`: it says the App needs « Pull requests » in write access (« écriture ») and links to `appSettingsUrl`.
//   Any other failure of /prepare (409 empty_repo or repo_unreachable, 502): a French alert, no code, no « Faire le commit ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Line = { key: string; ok: boolean; detail: string };
type PlanFile = {
  path: string;
  content: string;
  status: "create" | "same" | "exists";
  current?: string;
};
type Plan = { baseSha: string; signature: string; files: PlanFile[] };
type Answer = { status: number; body: unknown };

const GREEN: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];
const lines = (red: string[]): Line[] =>
  GREEN.map((l) =>
    red.includes(l.key) ? { ...l, ok: false, detail: "missing" } : l,
  );

const TEST_WRITER = ".claude/agents/test-writer.md";
const DEVELOPER = ".claude/agents/developer.md";
const REVIEWER = ".claude/agents/reviewer.md";
const WRITE_US = ".claude/skills/write-us/SKILL.md";
const PLAN: Plan = {
  baseSha: "b".repeat(40),
  signature: "signed-by-the-server",
  files: [
    {
      path: TEST_WRITER,
      content: "TEXTE-DU-NOUVEL-AGENT",
      status: "create",
    },
    {
      path: DEVELOPER,
      content: "ligne un\nligne 2 modifiée\nligne trois",
      status: "exists",
      current: "ligne un\nligne deux\nligne trois",
    },
    { path: REVIEWER, content: "reviewer du catalogue", status: "exists" },
    { path: WRITE_US, content: "write-us", status: "same" },
  ],
};
const NOTHING_TO_ADD: Plan = {
  ...PLAN,
  files: PLAN.files.filter((f) => f.status !== "create"),
};
const OTHER_PLAN: Plan = {
  baseSha: "c".repeat(40),
  signature: "signed-again",
  files: [
    {
      path: ".claude/agents/test-writer.md",
      content: "NOUVEAU-PLAN",
      status: "create",
    },
  ],
};

const LABEL = {
  create: "Sera ajouté",
  same: "Déjà là, identique",
  differs: "Déjà là, différent : laissé tel quel",
  special: "Déjà là, pas un simple fichier : laissé tel quel",
};
const SHA = "a".repeat(40);
const COMMIT_URL = `https://github.com/octocat/hello/commit/${SHA}`;
const PR_URL = "https://github.com/octocat/hello/pull/3";
const SETTINGS_URL = "https://github.com/settings/apps/cockpit-test";
const REPO_CHANGED = "Le repo a changé entre-temps : regarde de nouveau";
const PROTECTED_SENTENCE =
  "La branche par défaut est protégée : une pull request est ouverte";

/** A small fake server behind fetch; `healths` are served one per health request, the last again after that. */
function stubApi(
  options: {
    healths?: Line[][];
    archived?: boolean;
    plans?: Answer[];
    applies?: (Answer | Promise<Answer>)[];
  } = {},
) {
  const healths = options.healths ?? [lines(["claude_md", "agents"])];
  const plans = options.plans ?? [{ status: 200, body: { plan: PLAN } }];
  const applies = options.applies ?? [
    { status: 200, body: { commitSha: SHA, created: [TEST_WRITER] } },
  ];
  const calls = {
    health: 0,
    prepare: 0,
    applyBodies: [] as unknown[],
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
      if (path === "/api/projects/5/health" && method === "GET") {
        const lastHealth = healths[Math.min(calls.health, healths.length - 1)];
        calls.health++;
        return Response.json({ lines: lastHealth });
      }
      if (path === "/api/projects/5/prepare" && method === "POST") {
        const answer = plans[Math.min(calls.prepare, plans.length - 1)];
        calls.prepare++;
        return reply(answer as Answer);
      }
      if (path === "/api/projects/5/prepare/apply" && method === "POST") {
        const answer =
          applies[Math.min(calls.applyBodies.length, applies.length - 1)];
        calls.applyBodies.push(JSON.parse(String(init?.body)));
        return reply(await (answer as Answer | Promise<Answer>));
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

const prepareButton = () =>
  screen.findByRole("button", { name: "Préparer pour Claude" });
const commitButton = () =>
  screen.getByRole("button", { name: "Faire le commit" }) as HTMLButtonElement;
/** Opens the list of the files and waits for it. */
async function open() {
  fireEvent.click(await prepareButton());
  await screen.findByRole("button", { name: "Faire le commit" });
}
/** The list item of a file: the one that holds its path and none of the other paths of the plan. */
function rowOf(path: string, all = PLAN.files.map((f) => f.path)) {
  const rows = screen
    .getAllByRole("listitem")
    .filter(
      (li) =>
        (li.textContent ?? "").includes(path) &&
        all
          .filter((other) => other !== path && !other.startsWith(path))
          .every((other) => !(li.textContent ?? "").includes(other)),
    );
  expect(rows.length, `a list item for ${path}`).toBeGreaterThan(0);
  return rows[0] as HTMLElement;
}
const alertText = () => screen.getByRole("alert").textContent ?? "";

describe("decision 027 F: the button", () => {
  it.each([
    ["claude_md", ["claude_md"]],
    ["agents", ["agents"]],
    ["claude_md and agents", ["claude_md", "agents"]],
  ])(
    "given the line %s red, when the page loads, then « Préparer pour Claude » is shown and nothing is asked of the plan yet",
    async (_name, red) => {
      const calls = stubApi({ healths: [lines(red)] });

      renderAt("/projets/5/sante");

      const found = (await prepareButton()) as HTMLButtonElement;
      expect(found.disabled).toBe(false);
      expect(calls.prepare).toBe(0);
    },
  );

  it.each([
    ["every line is green", []],
    ["only ci is red", ["ci"]],
    ["ci and mcp are red", ["ci", "mcp"]],
  ])(
    "given %s, when the page loads, then there is no « Préparer pour Claude »",
    async (_name, red) => {
      stubApi({ healths: [lines(red)] });

      renderAt("/projets/5/sante");

      await screen.findByText("Agents et skill de développement");
      expect(
        screen.queryByRole("button", { name: "Préparer pour Claude" }),
      ).toBeNull();
    },
  );

  it("given an archived project with a red line, when the page loads, then « Préparer pour Claude » is shown but disabled and a click asks nothing", async () => {
    const calls = stubApi({ archived: true });

    renderAt("/projets/5/sante");

    const found = (await prepareButton()) as HTMLButtonElement;
    expect(found.disabled).toBe(true);
    fireEvent.click(found);
    expect(calls.prepare).toBe(0);
  });
});

describe("decision 027 F: the list of the files", () => {
  it("given the button clicked, when the plan is read, then the plan is asked once and each file is a list item with its path and its own French label", async () => {
    const calls = stubApi();
    renderAt("/projets/5/sante");

    await open();

    expect(calls.prepare).toBe(1);
    const expected = [
      [TEST_WRITER, "create"],
      [DEVELOPER, "differs"],
      [REVIEWER, "special"],
      [WRITE_US, "same"],
    ] as const;
    for (const [path, kind] of expected) {
      const row = rowOf(path);
      expect(row.textContent, path).toContain(LABEL[kind]);
      for (const [other, label] of Object.entries(LABEL))
        if (other !== kind)
          expect(row.textContent, `${path} is not ${other}`).not.toContain(
            label,
          );
    }
    // Neither the status codes nor the signature are shown.
    const main = screen.getByRole("main").textContent ?? "";
    expect(main).not.toMatch(/\bexists\b|signed-by-the-server/);
  });

  it("given a file to add, when the list is shown, then its content is in a closed details", async () => {
    stubApi();
    renderAt("/projets/5/sante");

    await open();

    const details = rowOf(TEST_WRITER).querySelector("details");
    expect(details, "a <details> in the row").not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(details?.textContent).toContain("TEXTE-DU-NOUVEL-AGENT");
  });

  it("given a file that is there but different, when the list is shown, then its diff goes from the current text to the proposed one: a removed line is marked Retirée, an added one Ajoutée, an unchanged one neither", async () => {
    stubApi();
    renderAt("/projets/5/sante");

    await open();

    const items = within(rowOf(DEVELOPER))
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    const only = (text: string) => items.findIndex((i) => i.includes(text));
    expect(items[only("ligne deux")]).toMatch(/Retirée/);
    expect(items[only("ligne deux")]).not.toMatch(/Ajoutée/);
    expect(items[only("ligne 2 modifiée")]).toMatch(/Ajoutée/);
    expect(items[only("ligne 2 modifiée")]).not.toMatch(/Retirée/);
    for (const same of ["ligne un", "ligne trois"])
      expect(items[only(same)]).not.toMatch(/Retirée|Ajoutée/);
    expect(only("ligne un")).toBeLessThan(only("ligne deux"));
    expect(only("ligne deux")).toBeLessThan(only("ligne 2 modifiée"));
    expect(only("ligne 2 modifiée")).toBeLessThan(only("ligne trois"));
  });

  it("given a file that is identical and a file that is not a plain file, when the list is shown, then neither has a diff", async () => {
    stubApi();
    renderAt("/projets/5/sante");

    await open();

    expect(rowOf(WRITE_US).textContent).not.toMatch(/Retirée|Ajoutée/);
    expect(rowOf(REVIEWER).textContent).not.toMatch(/Retirée|Ajoutée/);
  });

  it("given a plan with files to add, when the list is shown, then « Faire le commit » is enabled", async () => {
    stubApi();
    renderAt("/projets/5/sante");

    await open();

    expect(commitButton().disabled).toBe(false);
  });

  it("given a plan with nothing to add, when the list is shown, then « Faire le commit » is disabled and a click sends nothing", async () => {
    const calls = stubApi({
      plans: [{ status: 200, body: { plan: NOTHING_TO_ADD } }],
    });
    renderAt("/projets/5/sante");

    await open();

    expect(commitButton().disabled).toBe(true);
    fireEvent.click(commitButton());
    expect(calls.applyBodies).toEqual([]);
  });

  it.each([
    [
      "409 empty_repo",
      { status: 409, body: { error: "empty_repo" } },
      "empty_repo",
    ],
    [
      "409 repo_unreachable",
      { status: 409, body: { error: "repo_unreachable" } },
      "repo_unreachable",
    ],
    [
      "502 github_unavailable",
      { status: 502, body: { error: "github_unavailable" } },
      "github_unavailable",
    ],
  ])(
    "given the plan refused with %s, when the button is clicked, then a French alert is shown, without the code, and there is no « Faire le commit »",
    async (_name, answer, code) => {
      stubApi({ plans: [answer] });
      renderAt("/projets/5/sante");

      fireEvent.click(await prepareButton());

      await screen.findByRole("alert");
      expect(alertText().trim().length).toBeGreaterThan(10);
      expect(alertText()).not.toContain(code);
      expect(
        screen.queryByRole("button", { name: "Faire le commit" }),
      ).toBeNull();
    },
  );
});

describe("decision 027 F: the commit", () => {
  it("given the list, when « Faire le commit » is clicked, then the plan received is sent back untouched, « C'est fait » is shown with the link of the commit, and the health is read again", async () => {
    const calls = stubApi({
      healths: [lines(["claude_md", "agents"]), GREEN],
    });
    renderAt("/projets/5/sante");
    await open();
    expect(calls.health).toBe(1);

    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(calls.applyBodies).toEqual([{ plan: PLAN }]);
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === COMMIT_URL);
    expect(link, "a link to the commit").toBeDefined();
    await waitFor(() => expect(calls.health).toBe(2));
    // The second answer is green: the preparation is no longer offered.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Préparer pour Claude" }),
      ).toBeNull(),
    );
    expect(screen.getByText(/C'est fait/)).toBeDefined();
  });

  it("given the commit in flight, when « Faire le commit » is clicked, then it is disabled until the answer, so only one request leaves", async () => {
    let answer: (value: Answer) => void = () => {};
    const calls = stubApi({
      applies: [
        new Promise<Answer>((resolve) => {
          answer = resolve;
        }),
      ],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    await waitFor(() => expect(commitButton().disabled).toBe(true));
    fireEvent.click(commitButton());
    expect(calls.applyBodies).toHaveLength(1);
    answer({ status: 200, body: { commitSha: SHA, created: [TEST_WRITER] } });
    await screen.findByText(/C'est fait/);
  });

  it("given a protected default branch, when the commit is made, then the page says a pull request is open, links to it, and reads the health again", async () => {
    const calls = stubApi({
      applies: [
        {
          status: 200,
          body: {
            commitSha: SHA,
            created: [TEST_WRITER],
            pullRequest: { number: 3, url: PR_URL },
          },
        },
      ],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByText(PROTECTED_SENTENCE);
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === PR_URL);
    expect(link, "a link to the pull request").toBeDefined();
    await waitFor(() => expect(calls.health).toBe(2));
  });

  it("given a pull request opened, when the health is still red, then « Préparer pour Claude » is gone and the link of the pull request stays", async () => {
    stubApi({
      applies: [
        {
          status: 200,
          body: {
            commitSha: SHA,
            created: [TEST_WRITER],
            pullRequest: { number: 3, url: PR_URL },
          },
        },
      ],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByText(PROTECTED_SENTENCE);
    expect(
      screen.queryByRole("button", { name: "Préparer pour Claude" }),
    ).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === PR_URL),
    ).toBe(true);
  });

  it.each([
    [400, { error: "Bad request" }],
    [404, { error: "Not found" }],
    [500, { error: "Internal Server Error" }],
  ])(
    "given the commit answered %s, when the answer comes, then the alert does not blame GitHub",
    async (status, body) => {
      stubApi({ applies: [{ status, body }] });
      renderAt("/projets/5/sante");
      await open();

      fireEvent.click(commitButton());

      await screen.findByRole("alert");
      expect(alertText()).not.toContain("GitHub");
    },
  );

  it("given a session that ended, when the commit is made, then the alert offers the login", async () => {
    stubApi({ applies: [{ status: 401, body: { error: "Unauthorized" } }] });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    const alert = await screen.findByRole("alert");
    expect(alertText()).not.toContain("GitHub ne répond pas");
    expect(within(alert).getByRole("link").getAttribute("href")).toBe(
      "/api/auth/login",
    );
  });

  it("given a commit that went straight to the branch, when it is done, then the protected-branch sentence is not shown", async () => {
    stubApi();
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByText(/C'est fait/);
    expect(screen.queryByText(PROTECTED_SENTENCE)).toBeNull();
  });
});

describe("decision 027 F: the refusals", () => {
  it("given the repo changed since the plan, when the commit is made, then the French message is shown without the code and the plan is read again and shown", async () => {
    const calls = stubApi({
      plans: [
        { status: 200, body: { plan: PLAN } },
        { status: 200, body: { plan: OTHER_PLAN } },
      ],
      applies: [{ status: 409, body: { error: "repo_changed" } }],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await waitFor(() => expect(alertText()).toContain(REPO_CHANGED));
    expect(alertText()).not.toContain("repo_changed");
    await waitFor(() => expect(calls.prepare).toBe(2));
    await waitFor(() => {
      const text = screen.getByRole("main").textContent ?? "";
      expect(text).not.toContain("ligne deux");
      expect(text).toContain(".claude/agents/test-writer.md");
    });
    expect(screen.queryByText(/C'est fait/)).toBeNull();
  });

  it("given an App without Pull requests: write, when the commit is made, then the message says so in French and links to the settings of the App", async () => {
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
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByRole("alert");
    expect(alertText()).toMatch(/Pull requests/);
    expect(alertText()).toMatch(/écriture/);
    expect(alertText()).not.toContain("pull_request_forbidden");
    const link = within(screen.getByRole("alert")).getByRole("link");
    expect(link.getAttribute("href")).toBe(SETTINGS_URL);
    expect(screen.queryByText(/C'est fait/)).toBeNull();
  });

  it("given GitHub that fails while the commit is made, when the answer comes, then a French alert is shown, without « C'est fait » and without a code", async () => {
    stubApi({
      applies: [{ status: 502, body: { error: "github_unavailable" } }],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByRole("alert");
    expect(alertText().trim().length).toBeGreaterThan(10);
    expect(alertText()).not.toContain("github_unavailable");
    expect(screen.queryByText(/C'est fait/)).toBeNull();
  });
});
