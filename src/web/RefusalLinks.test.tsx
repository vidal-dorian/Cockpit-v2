// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, PROJECT, stubHome } from "./test-home.tsx";
import { patchProjects } from "./test-plans.tsx";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice S08 (decision 085 D): a refusal, a red line or an empty state that names the page where it is fixed links to it.
//
// Pinned (the map of the audit): launcher_* / project_not_in_launcher / routine_* -> /reglages/taches-cloud;
// monthly_budget_reached -> /claude/cout; not_prepared -> /projets/<id>/sante; no_plugin_repo -> /equipes/commun;
// the banner of a project locked by the plan of the user themself -> /reglages/abonnement (another person's: no link);
// a red `ci.missing` line -> /projets/<id>/ci; a red webhook line shows « Ouvrir les réglages de l'App ↗ » to the `url` of the line;
// the pause `run_failed` of the queue -> /runs/<id> of the failed run of finishedToday; `launch_failed` -> /reglages/taches-cloud.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

type Handler = (
  path: string,
  method: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

/** Lays `handler` over the fetch fake already stubbed: it answers first, the fake answers the rest. */
function lay(handler: Handler) {
  const inner = globalThis.fetch;
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
      return (await handler(path, method, init)) ?? inner(input, init);
    }),
  );
}

const hrefOf = (scope: HTMLElement, name: RegExp | string) =>
  within(scope).getByRole("link", { name }).getAttribute("href");

describe("085 D: « Développer avec Claude » refusals", () => {
  it.each([
    ["monthly_budget_reached", /Coût|coût/, "/claude/cout"],
    ["project_not_in_launcher", /Réglages/, "/reglages/taches-cloud"],
  ])(
    "given the launch refused with %s, when the user launches in the cloud, then the alert links to the page that fixes it",
    async (error, name, href) => {
      stubTicketApi(
        [ticket(7, "Idée")],
        [story(42, 7, "Me connecter", { status: "ready" })],
      );
      lay((path, method) => {
        if (path === "/api/stories/42" && method === "GET") return undefined;
        if (path === "/api/projects/5/branches")
          return Response.json({ branches: ["main"] });
        if (path === "/api/projects/5/agents")
          return Response.json({
            agents: [],
            catalog: [],
            team: null,
            teams: [],
          });
        if (path === "/api/me/launcher")
          return Response.json({
            prompt: "p",
            connected: true,
            needsReconnect: false,
            projectIds: [5],
          });
        if (path === "/api/me/budgets")
          return Response.json({
            runUsd: null,
            nightUsd: null,
            monthUsd: null,
          });
        if (path === "/api/stories/42/launch" && method === "POST")
          return Response.json({ error }, { status: 409 });
        return undefined;
      });
      renderAt("/us/42");
      fireEvent.click(
        await screen.findByRole("button", { name: "Développer avec Claude" }),
      );
      const panel = await screen.findByRole("complementary", {
        name: "Développer avec Claude",
      });
      fireEvent.click(
        await within(panel).findByRole("radio", { name: /Dans le cloud/ }),
      );

      fireEvent.click(
        within(panel).getByRole("button", { name: /Lancer dans le cloud/ }),
      );

      const alert = await within(panel).findByRole("alert");
      expect(hrefOf(alert, name)).toBe(href);
    },
  );
});

describe("085 D: a saved answer whose relaunch was refused", () => {
  it.each([
    ["launcher_needs_reconnect", "/reglages/taches-cloud"],
    ["monthly_budget_reached", "/claude/cout"],
  ])(
    "given the answer saved but the relaunch refused with %s, when it is sent, then the alert links to the page that fixes it",
    async (error, href) => {
      stubHome({
        ...empty(),
        forYou: [
          {
            kind: "answer",
            questionId: 7,
            question: "Quel nom ?",
            suggestedAnswers: ["Valider"],
            runId: 12,
            storyId: 21,
            iWant: "relire les exports",
            project: PROJECT,
          },
        ],
      });
      lay((path) =>
        path.includes("/answer")
          ? Response.json({ error, answerSaved: true }, { status: 409 })
          : undefined,
      );
      renderAt("/");

      fireEvent.click(await screen.findByRole("button", { name: /Valider/ }));

      const alert = await screen.findByRole("alert");
      await waitFor(() =>
        expect(alert.textContent).toMatch(/Réponse enregistrée/),
      );
      expect(within(alert).getByRole("link").getAttribute("href")).toBe(href);
    },
  );
});

describe("085 D: the page Tâches programmées", () => {
  it("given a run refused because the launcher is not connected, when « Lancer maintenant » is clicked, then the alert links to /reglages/taches-cloud", async () => {
    stubHome(empty());
    lay((path, method) => {
      if (path === "/api/me/launcher")
        return Response.json({
          connected: true,
          needsReconnect: false,
          prompt: "p",
          projectIds: [5],
          missingProjectIds: [],
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "p",
        });
      if (path === "/api/routines" && method === "GET")
        return Response.json({
          routines: [
            {
              id: 1,
              name: "Nettoyage",
              instruction: "Ranger",
              agents: [],
              projectIds: [5],
              frequency: "daily",
              hour: 12,
              weekday: null,
              timeZone: "Europe/Paris",
              nextRunAt: null,
              pausedAt: null,
              lastLaunch: null,
            },
          ],
        });
      if (path === "/api/routines/1/run" && method === "POST")
        return Response.json(
          { error: "launcher_not_connected" },
          { status: 409 },
        );
      return undefined;
    });
    renderAt("/claude/taches");
    fireEvent.click(await screen.findByRole("button", { name: /Nettoyage/ }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Lancer maintenant" }),
    );

    const alert = await screen.findByRole("alert");
    expect(hrefOf(alert, /Réglages/)).toBe("/reglages/taches-cloud");
  });
});

describe("085 D: the page Claude", () => {
  const queue = (pausedReason: string) =>
    lay((path) => {
      if (path === "/api/claude")
        return Response.json({
          questions: [],
          running: [],
          finishedToday: [
            {
              runId: 31,
              storyId: 41,
              iWant: "Faire 31",
              project: PROJECT,
              outcome: "failed",
              verdict: { acceptable: false, reasons: [] },
              prNumber: null,
              storyStatus: "ready",
              summary: null,
            },
          ],
          readyStories: [],
        });
      if (path.startsWith("/api/queue"))
        return Response.json({ paused: true, pausedReason, items: [] });
      return undefined;
    });

  it("given the queue paused by run_failed and a failed run today, when the page loads, then the pause sentence links to that run", async () => {
    stubHome(empty());
    queue("run_failed");
    renderAt("/claude");

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toMatch(/pause/));
    expect(hrefOf(status, /run|regarde/i)).toBe("/runs/31");
  });

  it("given the queue paused by launch_failed, when the page loads, then the pause sentence links to /reglages/taches-cloud", async () => {
    stubHome(empty());
    queue("launch_failed");
    renderAt("/claude");

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toMatch(/pause/));
    expect(hrefOf(status, /Réglages|lanceur/)).toBe("/reglages/taches-cloud");
  });
});

describe("085 D: the refusals of the project pages", () => {
  it.each([
    ["monthly_budget_reached", /Coût|coût/, "/claude/cout"],
    ["not_prepared", /Préparer|Santé|santé/, "/projets/5/sante"],
    ["no_plugin_repo", /plugins|Équipes|équipes/, "/equipes/commun"],
    ["launcher_not_connected", /Réglages/, "/reglages/taches-cloud"],
  ])(
    "given the plan of « Préparer pour Claude » refused with %s, when the button is clicked, then the alert links to the page that fixes it",
    async (error, name, href) => {
      stubTicketApi([ticket(7, "Idée")]);
      lay((path, method) => {
        if (path === "/api/projects/5/health")
          return Response.json({
            lines: [
              { key: "claude_md", ok: false, detail: "missing" },
              { key: "ci", ok: true, detail: "ok" },
              { key: "mcp", ok: true, detail: "ok" },
              { key: "agents", ok: true, detail: "ok" },
            ],
          });
        if (path === "/api/projects/5/prepare" && method === "POST")
          return Response.json({ error }, { status: 409 });
        return undefined;
      });
      renderAt("/projets/5/sante");

      fireEvent.click(
        await screen.findByRole("button", { name: "Préparer pour Claude" }),
      );

      const alert = await screen.findByRole("alert");
      expect(hrefOf(alert, name)).toBe(href);
    },
  );

  it("given a red workflow and « Demander à Claude » refused for the budget, when it is clicked, then the line of the workflow links to /claude/cout", async () => {
    stubTicketApi([ticket(7, "Idée")]);
    lay((path, method) => {
      if (path === "/api/projects/5/workflows" && method === "GET")
        return Response.json({
          workflows: [
            {
              path: ".github/workflows/nightly.yml",
              name: "Tests de bout en bout",
              event: "schedule",
              lastRun: {
                conclusion: "failure",
                at: new Date().toISOString(),
                url: "https://github.com/octocat/hello/actions/runs/2",
              },
              failingSince: 3,
              averageSeconds: 600,
            },
          ],
          starter: null,
          permission: { workflows: true, installationUrl: "https://x.test" },
          proposal: null,
        });
      if (path === "/api/projects/5/workflows/ask" && method === "POST")
        return Response.json(
          { error: "monthly_budget_reached" },
          { status: 409 },
        );
      return undefined;
    });
    renderAt("/projets/5/ci");
    const line = (await screen.findByText(/nightly\.yml/)).closest(
      "li",
    ) as HTMLElement;

    fireEvent.click(
      within(line).getByRole("button", { name: "Demander à Claude" }),
    );

    const alert = await within(line).findByRole("alert");
    expect(hrefOf(alert, /Coût|coût/)).toBe("/claude/cout");
  });

  it("given the routine of a project refused because no task is connected, when « Écrire les US maintenant » is clicked, then the alert links to Réglages", async () => {
    stubTicketApi([ticket(7, "Idée")]);
    lay((path, method) => {
      if (path === "/api/me/routine")
        return Response.json({
          connected: true,
          fireUrl: "https://api.anthropic.com/x/fire",
          needsReconnect: false,
          prompt: "p",
        });
      if (path === "/api/me/launcher")
        return Response.json({
          connected: false,
          needsReconnect: false,
          prompt: "p",
          projectIds: [],
          missingProjectIds: [],
          autoRelaunch: false,
        });
      if (path === "/api/projects/5/routine/run" && method === "POST")
        return Response.json(
          { error: "routine_needs_reconnect" },
          { status: 409 },
        );
      return undefined;
    });
    renderAt("/projets/5/ecriture-us");

    const run = await screen.findByRole("button", {
      name: "Écrire les US maintenant",
    });
    await waitFor(() =>
      expect((run as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(run);

    const alert = await screen.findByRole("alert");
    expect(hrefOf(alert, /Réglages/)).toMatch(/^\/reglages\//);
  });
});

describe("085 D: the banner of a read-only project", () => {
  it("given a project locked by the plan of the user themself, when a page loads, then the banner links to /reglages/abonnement", async () => {
    stubTicketApi([ticket(7, "Une idée")]);
    patchProjects({ role: "read_only", lockedBy: "octocat" });
    renderAt("/projets/5/tickets");

    const banner = await screen.findByText(/en lecture seule/);

    expect(hrefOf(banner, /abonnement|Abonnement/)).toBe(
      "/reglages/abonnement",
    );
  });

  it("given a project locked by the plan of someone else, when a page loads, then the banner has no link", async () => {
    stubTicketApi([ticket(7, "Une idée")]);
    patchProjects({ role: "read_only", lockedBy: "dorian" });
    renderAt("/projets/5/tickets");

    const banner = await screen.findByText(/en lecture seule/);

    expect(within(banner).queryByRole("link")).toBeNull();
  });
});

describe("085 D: the red lines of the health check lead to their fix", () => {
  const health = (lines: object[]) =>
    lay((path) =>
      path === "/api/projects/5/health" ? Response.json({ lines }) : undefined,
    );
  const rowOf = async (label: string) =>
    (await screen.findByText(label)).closest("li") as HTMLElement;

  it("given a red CI line, when the health loads, then its row links to the tab CI / CD of the project", async () => {
    stubTicketApi([ticket(7, "Idée")]);
    health([
      { key: "claude_md", ok: true, detail: "ok" },
      { key: "ci", ok: false, detail: "missing" },
      { key: "mcp", ok: true, detail: "ok" },
      { key: "agents", ok: true, detail: "ok" },
    ]);
    renderAt("/projets/5/sante");

    const row = await rowOf("CI");

    expect(hrefOf(row, /CI/)).toBe("/projets/5/ci");
  });

  it("given a red webhook line with the settings URL of the App, when the health loads, then its row links to it", async () => {
    stubTicketApi([ticket(7, "Idée")]);
    health([
      { key: "claude_md", ok: true, detail: "ok" },
      { key: "ci", ok: true, detail: "ok" },
      { key: "mcp", ok: true, detail: "ok" },
      { key: "agents", ok: true, detail: "ok" },
      {
        key: "webhook",
        ok: false,
        detail: "wrong_url",
        url: "https://github.com/settings/apps/cockpit-test",
      },
    ]);
    renderAt("/projets/5/sante");

    const row = await rowOf("Webhook de Cockpit");

    expect(hrefOf(row, /réglages de l'App/i)).toBe(
      "https://github.com/settings/apps/cockpit-test",
    );
  });
});
