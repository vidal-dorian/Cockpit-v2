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

// Slice C1 (decision 049 E, F): « Fichiers de Claude à jour » in the section « Bilan de santé » of /projets/:id/sante, and « Mettre à jour ».
//
// Pinned where the decision leaves it open (the developer follows these; the server side is in src/server/catalog-update.test.ts):
// - The health answers a line `{ key: "catalog", ok, detail: "ok" | "outdated", files: [{ path, state: "current" | "old" | "modified" | "absent" }] }`. The page shows it
//   as a list item of the bilan named « Fichiers de Claude à jour ». When it is red (the files `old` and `absent`, N of them) the item says « N fichiers ont une nouvelle version »
//   (« 1 fichier a une nouvelle version » for one) and holds a button « Mettre à jour », disabled for an archived project. A project with no catalog line shows none of this.
// - Every `modified` file is listed in the item, whatever the colour of the line, as a list item with its path and « modifié à la main, gardé tel quel ».
// - « Mettre à jour » reads the plan on click (POST /api/projects/5/catalog/plan, no body, not at the page load): `{ plan: { files: [{ path, state: "old" | "absent", current: string | null, content }] } }`.
//   Each file is a list item with its path: an `old` one shows the diff of `current` to `content` (list items, « Retirée » / « Ajoutée »), an `absent` one « Sera ajouté ».
// - « Faire le commit » sends POST /api/projects/5/catalog/apply with `{ files: [{ path, before: current }] }` for the files of the plan (in the plan order), and is disabled while in flight.
//   200 { commitSha, changed, pullRequest?: { number, url } }: « C'est fait » and a link to https://github.com/octocat/hello/commit/<sha>, or, with pullRequest, « La branche par défaut est protégée :
//   une pull request est ouverte » and a link to its url; the health is read again. A refusal is 409 { error }: a role="alert" in French, never the code; `repo_changed` reads the plan again;
//   `pull_request_forbidden` mentions « écriture » and links to `appSettingsUrl`. A plan that cannot be read (409 or 502) is a French alert with no « Faire le commit ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Line = {
  key: string;
  ok: boolean;
  detail: string;
  files?: { path: string; state: string }[];
};
type Answer = { status: number; body: unknown };

const DEV = ".claude/agents/developer.md";
const REVIEWER = ".claude/agents/reviewer.md";
const WRITE_US = ".claude/skills/write-us/SKILL.md";
const SKILL = ".claude/skills/dev-us/SKILL.md";
const GREEN: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];
const catalog = (states: Record<string, string>): Line => ({
  key: "catalog",
  ok: !Object.values(states).some((s) => s === "old" || s === "absent"),
  detail: Object.values(states).some((s) => s === "old" || s === "absent")
    ? "outdated"
    : "ok",
  files: Object.entries(states).map(([path, state]) => ({ path, state })),
});
const RED = catalog({
  [DEV]: "old",
  [REVIEWER]: "absent",
  [WRITE_US]: "modified",
  [SKILL]: "current",
});

const PLAN = {
  plan: {
    files: [
      {
        path: DEV,
        state: "old",
        current: "ligne un\nligne deux\nligne trois",
        content: "ligne un\nligne 2 modifiée\nligne trois",
      },
      {
        path: REVIEWER,
        state: "absent",
        current: null,
        content: "TEXTE-DU-REVIEWER",
      },
    ],
  },
};
const SHA = "a".repeat(40);
const COMMIT_URL = `https://github.com/octocat/hello/commit/${SHA}`;
const PR_URL = "https://github.com/octocat/hello/pull/3";
const SETTINGS_URL = "https://github.com/settings/apps/cockpit-test";
const REPO_CHANGED = "Le repo a changé entre-temps : regarde de nouveau";
const OK: Answer = {
  status: 200,
  body: { commitSha: SHA, changed: [DEV, REVIEWER] },
};

function stubApi(
  options: {
    healths?: Line[][];
    archived?: boolean;
    plans?: Answer[];
    applies?: (Answer | Promise<Answer>)[];
  } = {},
) {
  const healths = options.healths ?? [[...GREEN, RED]];
  const plans = options.plans ?? [{ status: 200, body: PLAN }];
  const applies = options.applies ?? [OK];
  const calls = { health: 0, plan: 0, applyBodies: [] as unknown[] };
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
        const lines = healths[Math.min(calls.health, healths.length - 1)];
        calls.health++;
        return Response.json({ lines });
      }
      if (path === "/api/projects/5/catalog/plan" && method === "POST") {
        const answer = plans[Math.min(calls.plan, plans.length - 1)];
        calls.plan++;
        return reply(answer as Answer);
      }
      if (path === "/api/projects/5/catalog/apply" && method === "POST") {
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

const updateButton = () =>
  screen.findByRole("button", { name: "Mettre à jour" });
const commitButton = () =>
  screen.getByRole("button", { name: "Faire le commit" }) as HTMLButtonElement;
async function open() {
  fireEvent.click(await updateButton());
  await screen.findByRole("button", { name: "Faire le commit" });
}
/** The list item holding the path, the innermost one (the catalogue line holds the whole list of files). */
const rowOf = (path: string) => {
  const found = screen
    .getAllByRole("listitem")
    .filter((li) => (li.textContent ?? "").includes(path));
  expect(found.length, `a list item for ${path}`).toBeGreaterThan(0);
  return found.reduce((a, b) =>
    (a.textContent ?? "").length <= (b.textContent ?? "").length ? a : b,
  ) as HTMLElement;
};
const alertText = () => screen.getByRole("alert").textContent ?? "";

describe("decision 049 E: the line « Fichiers de Claude à jour »", () => {
  it("given every file current, when the page loads, then the line is shown with no « Mettre à jour » and no « N fichiers » sentence", async () => {
    stubApi({
      healths: [[...GREEN, catalog({ [DEV]: "current", [SKILL]: "current" })]],
    });

    renderAt("/projets/5/sante");

    await screen.findByText("Fichiers de Claude à jour");
    expect(screen.queryByRole("button", { name: "Mettre à jour" })).toBeNull();
    expect(screen.queryByText(/nouvelle version/)).toBeNull();
  });

  it("given two files to update, when the page loads, then the line says « 2 fichiers ont une nouvelle version », offers « Mettre à jour » and asks nothing of the plan yet", async () => {
    const calls = stubApi();

    renderAt("/projets/5/sante");

    const button = (await updateButton()) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.getByText("Fichiers de Claude à jour")).toBeTruthy();
    expect(
      screen.getByText(/2 fichiers ont une nouvelle version/),
    ).toBeTruthy();
    expect(calls.plan).toBe(0);
  });

  it("given one file to update, when the page loads, then the line says « 1 fichier a une nouvelle version »", async () => {
    stubApi({
      healths: [[...GREEN, catalog({ [DEV]: "old", [SKILL]: "current" })]],
    });

    renderAt("/projets/5/sante");

    expect(
      await screen.findByText(/1 fichier a une nouvelle version/),
    ).toBeTruthy();
  });

  it("given a file modified by hand, when the page loads, then it is listed with « modifié à la main, gardé tel quel », also when the line is green", async () => {
    stubApi({
      healths: [
        [...GREEN, catalog({ [WRITE_US]: "modified", [SKILL]: "current" })],
      ],
    });

    renderAt("/projets/5/sante");

    await screen.findByText("Fichiers de Claude à jour");
    expect(rowOf(WRITE_US).textContent).toContain(
      "modifié à la main, gardé tel quel",
    );
    expect(screen.queryByRole("button", { name: "Mettre à jour" })).toBeNull();
  });

  it("given a red line and a modified file, when the page loads, then the modified file is listed too and the current one is not said to be modified", async () => {
    stubApi();

    renderAt("/projets/5/sante");

    await updateButton();
    expect(rowOf(WRITE_US).textContent).toContain(
      "modifié à la main, gardé tel quel",
    );
    expect(
      screen.getAllByText(/modifié à la main, gardé tel quel/),
    ).toHaveLength(1);
  });

  it("given no catalog line (a repo that is not prepared), when the page loads, then nothing about the files of Claude is shown", async () => {
    stubApi({ healths: [GREEN] });

    renderAt("/projets/5/sante");

    await screen.findByText("Agents et skill de développement");
    expect(screen.queryByText("Fichiers de Claude à jour")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mettre à jour" })).toBeNull();
  });

  it("given an archived project, when the page loads, then « Mettre à jour » is disabled and a click asks nothing", async () => {
    const calls = stubApi({ archived: true });

    renderAt("/projets/5/sante");

    const button = (await updateButton()) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(calls.plan).toBe(0);
  });

  it("given an archived project, when the page loads, then the archived hint describes the disabled « Mettre à jour »", async () => {
    stubApi({ archived: true });

    renderAt("/projets/5/sante");

    const button = await updateButton();
    const hint = document.getElementById(
      button.getAttribute("aria-describedby") ?? "none",
    );
    expect(hint?.textContent).toContain("archivé");
  });
});

describe("decision 049 F: the diff and the commit", () => {
  it("given « Mettre à jour » clicked, when the plan is read, then it is asked once, the old file shows its diff and the absent one « Sera ajouté »", async () => {
    const calls = stubApi();
    renderAt("/projets/5/sante");

    await open();

    expect(calls.plan).toBe(1);
    const dev = rowOf(DEV);
    expect(dev.textContent).toContain("Retirée");
    expect(dev.textContent).toContain("Ajoutée");
    expect(within(dev).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(rowOf(REVIEWER).textContent).toContain("Sera ajouté");
    // The codes of the server are never shown.
    expect(screen.getByRole("main").textContent).not.toMatch(
      /\babsent\b|\bold\b/,
    );
  });

  it("given the list shown, when « Faire le commit » is clicked, then the apply route gets the files with their current text as before, once, and the button is disabled meanwhile", async () => {
    let release: (answer: Answer) => void = () => {};
    const calls = stubApi({
      applies: [new Promise<Answer>((resolve) => (release = resolve))],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await waitFor(() => expect(calls.applyBodies).toHaveLength(1));
    expect(calls.applyBodies[0]).toEqual({
      files: [
        { path: DEV, before: "ligne un\nligne deux\nligne trois" },
        { path: REVIEWER, before: null },
      ],
    });
    expect(commitButton().disabled).toBe(true);
    release(OK);
    await screen.findByText("C'est fait");
  });

  it("given a commit that succeeded, when the answer comes, then « C'est fait » links to the commit and the health is read again", async () => {
    const calls = stubApi({
      healths: [
        [...GREEN, RED],
        [
          ...GREEN,
          catalog({
            [DEV]: "current",
            [REVIEWER]: "current",
            [WRITE_US]: "modified",
          }),
        ],
      ],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByText("C'est fait");
    expect(
      screen.getByRole("link", { name: /commit/i }).getAttribute("href"),
    ).toBe(COMMIT_URL);
    await waitFor(() => expect(calls.health).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Mettre à jour" }),
      ).toBeNull(),
    );
  });

  it("given a protected branch, when the commit succeeds with a pull request, then the page says so and links to the pull request", async () => {
    stubApi({
      applies: [
        {
          status: 200,
          body: {
            commitSha: SHA,
            changed: [DEV],
            pullRequest: { number: 3, url: PR_URL },
          },
        },
      ],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await screen.findByText(
      "La branche par défaut est protégée : une pull request est ouverte",
    );
    expect(
      screen.getByRole("link", { name: /pull request/i }).getAttribute("href"),
    ).toBe(PR_URL);
  });

  it("given a file changed on GitHub meanwhile, when the answer is repo_changed, then the message is shown, never the code, and the plan is read again", async () => {
    const calls = stubApi({
      applies: [{ status: 409, body: { error: "repo_changed" } }],
      plans: [
        { status: 200, body: PLAN },
        {
          status: 200,
          body: {
            plan: {
              files: [
                {
                  path: REVIEWER,
                  state: "absent",
                  current: null,
                  content: "TEXTE-DU-REVIEWER",
                },
              ],
            },
          },
        },
      ],
    });
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(commitButton());

    await waitFor(() => expect(alertText()).toContain(REPO_CHANGED));
    expect(alertText()).not.toContain("repo_changed");
    await waitFor(() => expect(calls.plan).toBe(2));
  });

  it("given a protected branch and an App without the right, when the answer is pull_request_forbidden, then the alert mentions « écriture » and links to the settings of the App", async () => {
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

    await waitFor(() => expect(alertText()).toContain("écriture"));
    expect(
      within(screen.getByRole("alert")).getByRole("link").getAttribute("href"),
    ).toBe(SETTINGS_URL);
  });

  it.each([
    ["409 not_prepared", { status: 409, body: { error: "not_prepared" } }],
    [
      "502 github_unavailable",
      { status: 502, body: { error: "github_unavailable" } },
    ],
  ])(
    "given a plan that cannot be read (%s), when « Mettre à jour » is clicked, then a French alert with no code is shown and there is no « Faire le commit »",
    async (_name, answer) => {
      stubApi({ plans: [answer] });
      renderAt("/projets/5/sante");

      fireEvent.click(await updateButton());

      await waitFor(() => expect(alertText().length).toBeGreaterThan(0));
      expect(alertText()).not.toMatch(/not_prepared|github_unavailable/);
      expect(
        screen.queryByRole("button", { name: "Faire le commit" }),
      ).toBeNull();
    },
  );

  it("given the list shown, when « Annuler » is clicked, then the list goes away and nothing was applied", async () => {
    const calls = stubApi();
    renderAt("/projets/5/sante");
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(
      screen.queryByRole("button", { name: "Faire le commit" }),
    ).toBeNull();
    expect(calls.applyBodies).toEqual([]);
  });
});
