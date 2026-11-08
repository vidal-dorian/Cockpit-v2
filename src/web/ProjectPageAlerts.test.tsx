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

// Slice R6 (decision 052 B, L): the sixth and seventh lines of the health tab, « Alertes GitHub » and « Mises à jour automatiques », and the fix « Ajouter .github/dependabot.yml ».
//
// Pinned where the decision leaves it open (the developer follows these; the server answers as pinned in src/server/health-alerts.test.ts and src/server/dependabot.test.ts):
// - The labels are exactly « Alertes GitHub » (key github_alerts) and « Mises à jour automatiques » (key updates), after the other lines, with OK / À corriger in text like the others.
// - A red github_alerts line has one French sentence per code, no internal code ever shown:
//   * app_missing_permissions: tells what to tick in « Permissions & events » of the App: the words « Permissions & events », « Dependabot alerts », « Code scanning alerts » and
//     « Secret scanning alerts »; and a link named « Modifier l'App sur GitHub ↗ » to the `url` of the line;
//   * installation_not_approved: « GitHub attend ton accord pour les nouvelles permissions de l'App », and a link named « Approuver sur GitHub ↗ » to the `url` of the line;
//   * unknown: « impossible » and « GitHub », and no link.
//   An ok line has no link.
// - A red updates line says that no automatic update is configured, naming « .github/dependabot.yml » and « Renovate », and has the button « Ajouter .github/dependabot.yml » (disabled
//   on an archived project, GET /api/projects gives `archived: true`). An ok line has no button.
// - The button reads the plan when it is clicked (GET /api/projects/5/dependabot/plan, not when the page loads) and shows it as « Préparer pour Claude » does: a list item holding the path
//   `.github/dependabot.yml` and « Sera ajouté » (« Déjà là, différent : laissé tel quel » for an `exists` file with a current text), the content in a <details>; the button « Faire le commit »
//   (disabled when no file is `create`) posts /api/projects/5/dependabot/apply with { plan } as received. 200: « C'est fait » and a link « Voir le commit » to https://github.com/octocat/hello/commit/<sha>, or with
//   pullRequest « La branche par défaut est protégée : une pull request est ouverte » and a link « Voir la pull request » to its url; then the health is read again.
// - A refusal is an alert in French, never the code: 409 no_ecosystem says no ecosystem was found (« écosystème »), 409 repo_changed « Le repo a changé entre-temps », 409 project_archived
//   and any 502 an alert too; a failing plan has no « Faire le commit ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Line = { key: string; ok: boolean; detail: string; url?: string };
type Answer = { status: number; body: unknown };

const BASE: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
  { key: "webhook", ok: true, detail: "ok" },
];
const ALERTS_OK: Line = { key: "github_alerts", ok: true, detail: "ok" };
const UPDATES_OK: Line = { key: "updates", ok: true, detail: "ok" };
const UPDATES_RED: Line = { key: "updates", ok: false, detail: "missing" };
const PERMISSIONS_URL =
  "https://github.com/settings/apps/cockpit-test/permissions";
const INSTALLATION_URL = "https://github.com/settings/installations/77";
const PLAN = {
  baseSha: "d".repeat(40),
  signature: "signed-by-the-server",
  files: [
    {
      path: ".github/dependabot.yml",
      content:
        'version: 2\nupdates:\n  - package-ecosystem: "npm"\n    directory: "/"\n    schedule:\n      interval: "weekly"\n',
      status: "create",
    },
  ],
};

function stub(
  lines: Line[][],
  options: { archived?: boolean; plan?: Answer; apply?: Answer } = {},
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let healthReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const text = typeof init?.body === "string" ? init.body : "";
      calls.push({ method, path, body: text ? JSON.parse(text) : undefined });
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
              archived: options.archived ?? false,
            },
          ],
        });
      if (path === "/api/projects/5/health") {
        const answer = lines[Math.min(healthReads++, lines.length - 1)];
        return Response.json({ lines: answer });
      }
      if (path === "/api/projects/5/dependabot/plan" && method === "GET") {
        const answer = options.plan ?? { status: 200, body: { plan: PLAN } };
        return Response.json(answer.body, { status: answer.status });
      }
      if (path === "/api/projects/5/dependabot/apply" && method === "POST") {
        const answer = options.apply ?? {
          status: 200,
          body: {
            commitSha: "c".repeat(40),
            created: [".github/dependabot.yml"],
          },
        };
        return Response.json(answer.body, { status: answer.status });
      }
      if (/^\/api\/projects\/[^/]+\/stories$/.test(path))
        return Response.json({ stories: [] });
      if (/^\/api\/projects\/[^/]+\/tickets$/.test(path))
        return Response.json({ tickets: [] });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return {
    calls,
    paths: () => calls.map((c) => `${c.method} ${c.path}`),
  };
}

function renderProject() {
  window.history.replaceState({}, "", "/projets/5/sante");
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

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};
const GREEN = /\bOK\b/;
const RED = /À corriger/;

describe("decision 052 B: the line « Alertes GitHub »", () => {
  it("given the line is ok, when the page loads, then « Alertes GitHub » reads OK with no link, after the webhook line", async () => {
    stub([[...BASE, ALERTS_OK, UPDATES_OK]]);

    renderProject();

    await screen.findByText("Alertes GitHub");
    const row = rowOf("Alertes GitHub");
    expect(within(row).getByText(GREEN)).toBeDefined();
    expect(within(row).queryByText(RED)).toBeNull();
    expect(within(row).queryByRole("link")).toBeNull();
    expect(
      rowOf("Webhook de Cockpit").compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given the App does not ask for the permissions, when the page loads, then the line is À corriger, says what to tick in « Permissions & events » and links « Modifier l'App sur GitHub ↗ » to the permissions page", async () => {
    stub([
      [
        ...BASE,
        {
          key: "github_alerts",
          ok: false,
          detail: "app_missing_permissions",
          url: PERMISSIONS_URL,
        },
        UPDATES_OK,
      ],
    ]);

    renderProject();

    await screen.findByText("Alertes GitHub");
    const row = rowOf("Alertes GitHub");
    expect(within(row).getByText(RED)).toBeDefined();
    for (const word of [
      "Permissions & events",
      "Dependabot alerts",
      "Code scanning alerts",
      "Secret scanning alerts",
    ])
      expect(row.textContent, word).toContain(word);
    // Review O5: it also names the three events to tick (« alert » not followed by an s, so not the permissions above).
    for (const event of [
      /Dependabot alert(?!s)/,
      /Code scanning alert(?!s)/,
      /Secret scanning alert(?!s)/,
    ])
      expect(row.textContent, String(event)).toMatch(event);
    expect(
      within(row)
        .getByRole("link", { name: "Modifier l'App sur GitHub ↗" })
        .getAttribute("href"),
    ).toBe(PERMISSIONS_URL);
    expect(row.textContent).not.toMatch(/app_missing_permissions/);
  });

  it("given the installation did not approve the permissions, when the page loads, then the line says GitHub waits for the agreement and links « Approuver sur GitHub ↗ » to the installation", async () => {
    stub([
      [
        ...BASE,
        {
          key: "github_alerts",
          ok: false,
          detail: "installation_not_approved",
          url: INSTALLATION_URL,
        },
        UPDATES_OK,
      ],
    ]);

    renderProject();

    await screen.findByText("Alertes GitHub");
    const row = rowOf("Alertes GitHub");
    expect(within(row).getByText(RED)).toBeDefined();
    expect(row.textContent).toContain(
      "GitHub attend ton accord pour les nouvelles permissions de l'App",
    );
    const link = within(row).getByRole("link", {
      name: "Approuver sur GitHub ↗",
    });
    expect(link.getAttribute("href")).toBe(INSTALLATION_URL);
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    expect(row.textContent).not.toMatch(/installation_not_approved/);
  });

  it("given GitHub does not answer, when the page loads, then the line says it cannot be read, with no link and no internal code", async () => {
    stub([
      [
        ...BASE,
        { key: "github_alerts", ok: false, detail: "unknown" },
        UPDATES_OK,
      ],
    ]);

    renderProject();

    await screen.findByText("Alertes GitHub");
    const row = rowOf("Alertes GitHub");
    expect(within(row).getByText(RED)).toBeDefined();
    expect(row.textContent).toMatch(/impossible/i);
    expect(row.textContent).toMatch(/GitHub/);
    expect(within(row).queryByRole("link")).toBeNull();
    expect(row.textContent).not.toMatch(/unknown/);
  });
});

describe("decision 052 L: the line « Mises à jour automatiques »", () => {
  it("given the line is ok, when the page loads, then it reads OK with no button, after « Alertes GitHub »", async () => {
    stub([[...BASE, ALERTS_OK, UPDATES_OK]]);

    renderProject();

    await screen.findByText("Mises à jour automatiques");
    const row = rowOf("Mises à jour automatiques");
    expect(within(row).getByText(GREEN)).toBeDefined();
    expect(
      within(row).queryByRole("button", {
        name: "Ajouter .github/dependabot.yml",
      }),
    ).toBeNull();
    expect(
      rowOf("Alertes GitHub").compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given the line is red, when the page loads, then it says no automatic update is configured and offers « Ajouter .github/dependabot.yml », and the plan is not read yet", async () => {
    const api = stub([[...BASE, ALERTS_OK, UPDATES_RED]]);

    renderProject();

    await screen.findByText("Mises à jour automatiques");
    const row = rowOf("Mises à jour automatiques");
    expect(within(row).getByText(RED)).toBeDefined();
    expect(row.textContent).toContain(".github/dependabot.yml");
    expect(row.textContent).toContain("Renovate");
    expect(row.textContent).not.toMatch(/\bmissing\b/);
    expect(
      (
        within(row).getByRole("button", {
          name: "Ajouter .github/dependabot.yml",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(api.paths()).not.toContain("GET /api/projects/5/dependabot/plan");
  });

  it("given an archived project, when the page loads, then the button is disabled", async () => {
    stub([[...BASE, ALERTS_OK, UPDATES_RED]], { archived: true });

    renderProject();

    await screen.findByText("Mises à jour automatiques");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Ajouter .github/dependabot.yml",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });
});

describe("decision 052 L: the fix", () => {
  const start = async (options: Parameters<typeof stub>[1] = {}) => {
    const api = stub(
      [
        [...BASE, ALERTS_OK, UPDATES_RED],
        [...BASE, ALERTS_OK, UPDATES_OK],
      ],
      options,
    );
    renderProject();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ajouter .github/dependabot.yml",
      }),
    );
    return api;
  };

  it("given the button, when it is clicked, then the plan is read and the file is shown « Sera ajouté » with its content, and « Faire le commit » is there", async () => {
    const api = await start();

    await waitFor(() =>
      expect(api.paths()).toContain("GET /api/projects/5/dependabot/plan"),
    );
    const li = (await screen.findAllByRole("listitem")).find((el) =>
      (el.textContent ?? "").includes("Sera ajouté"),
    ) as HTMLElement;
    expect(li.textContent).toContain(".github/dependabot.yml");
    expect(li.querySelector("details")).not.toBeNull();
    expect(li.textContent).toContain("package-ecosystem");
    expect(
      (
        screen.getByRole("button", {
          name: "Faire le commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("given the plan shown, when « Faire le commit » is clicked, then POST apply carries the plan untouched, « C'est fait » and the commit link are shown, and the health is read again", async () => {
    const api = await start();
    fireEvent.click(
      await screen.findByRole("button", { name: "Faire le commit" }),
    );

    await screen.findByText(/C'est fait/);
    const sent = api.calls.find(
      (c) =>
        c.method === "POST" && c.path === "/api/projects/5/dependabot/apply",
    );
    expect(sent?.body).toEqual({ plan: PLAN });
    expect(
      screen.getByRole("link", { name: "Voir le commit" }).getAttribute("href"),
    ).toBe(`https://github.com/octocat/hello/commit/${"c".repeat(40)}`);
    await waitFor(() =>
      expect(
        api.paths().filter((p) => p === "GET /api/projects/5/health").length,
      ).toBeGreaterThan(1),
    );
  });

  it("given a protected default branch, when the apply answers a pull request, then the page says so with a link to it", async () => {
    await start({
      apply: {
        status: 200,
        body: {
          commitSha: "c".repeat(40),
          created: [".github/dependabot.yml"],
          pullRequest: {
            number: 3,
            url: "https://github.com/octocat/hello/pull/3",
          },
        },
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Faire le commit" }),
    );

    await screen.findByText(
      /La branche par défaut est protégée : une pull request est ouverte/,
    );
    expect(
      screen
        .getByRole("link", { name: "Voir la pull request" })
        .getAttribute("href"),
    ).toBe("https://github.com/octocat/hello/pull/3");
  });

  it.each([
    [409, "no_ecosystem", /écosystème/i],
    [502, "github_unavailable", /./],
  ])(
    "given the plan refused with %s %s, when the button is clicked, then a French alert without the code is shown and there is no « Faire le commit »",
    async (status, code, words) => {
      await start({ plan: { status, body: { error: code } } });

      const box = await screen.findByRole("alert");
      expect(box.textContent).toMatch(words);
      expect(box.textContent).not.toContain(code);
      expect(
        screen.queryByRole("button", { name: "Faire le commit" }),
      ).toBeNull();
    },
  );

  it("given the repo changed since the plan, when « Faire le commit » is clicked, then the alert says « Le repo a changé entre-temps » and no code", async () => {
    await start({ apply: { status: 409, body: { error: "repo_changed" } } });
    fireEvent.click(
      await screen.findByRole("button", { name: "Faire le commit" }),
    );

    const box = await screen.findByRole("alert");
    expect(box.textContent).toContain("Le repo a changé entre-temps");
    expect(box.textContent).not.toContain("repo_changed");
  });
});
