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

// Slice 14.2 (decision 056 F, G): the page « Tâches programmées » at /claude/taches.
//
// Pinned choices (the decision leaves them open):
// - The sidebar has a link « Claude » to /claude/taches. The page reads GET /api/routines ({ routines: [{ id, name, instruction,
//   agents, projectIds, frequency, hour, weekday, timeZone, nextRunAt, pausedAt, lastLaunch: { at, outcome, sessionUrl } | null }] }),
//   GET /api/me/launcher, GET /api/me/routine (the write-US task, shown when connected) and GET /api/projects.
// - Two <section>s found by their heading (level 2): « Tes tâches » (the write-US task, then each routine as a button named by the
//   routine) and « Prochains lancements » (the routines with a next run, in time order; a paused one is not there).
// - « + Nouvelle tâche » or a click on a routine opens the panel: the fields Nom, Consigne, Agents (comma-separated names), Quand
//   (a select: on_demand, daily or weekly) and one checkbox per project ticked in the launcher; « Enregistrer » sends POST (new) or
//   PUT /api/routines/:id with the body of the routes; the buttons « Lancer maintenant », « Mettre en pause » (« Reprendre » when
//   paused) and « Supprimer » call POST /run, POST /pause (/resume) and DELETE, with no confirmation.
// - Without a launcher the page has a link to /reglages/taches-cloud.

type Call = { method: string; path: string; body: string };
type Routine = Record<string, unknown>;
const routine = (over: Routine = {}): Routine => ({
  id: 1,
  name: "Nettoyage",
  instruction: "Ranger les imports",
  agents: ["bug-hunter"],
  projectIds: [5],
  frequency: "daily",
  hour: 12,
  weekday: null,
  timeZone: "Europe/Paris",
  nextRunAt: "2026-11-09T11:00:00.000Z",
  pausedAt: null,
  lastLaunch: {
    at: "2026-11-08T11:00:00.000Z",
    outcome: "succeeded",
    sessionUrl: "https://claude.ai/code/session_01ABC",
  },
  ...over,
});

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

function stubApi(routines: Routine[] = [], connected = true) {
  const calls: Call[] = [];
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
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ method, path, body });
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin: false,
        });
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x.test" });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
            {
              id: 6,
              fullName: "octocat/world",
              defaultBranch: "main",
              archived: false,
            },
          ],
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected,
          fireUrl: connected ? "https://api.anthropic.com/x/fire" : null,
          needsReconnect: false,
          prompt: "p",
        });
      if (path === "/api/me/launcher")
        return Response.json({
          connected,
          needsReconnect: false,
          prompt: "p",
          projectIds: connected ? [5] : [],
          missingProjectIds: [],
        });
      if (path === "/api/routines" && method === "GET")
        return Response.json({ routines });
      if (path.startsWith("/api/routines"))
        return Response.json(routine(), {
          status: method === "POST" ? 201 : 200,
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return calls;
}

const section = async (name: string) => {
  const heading = await screen.findByRole("heading", { level: 2, name });
  return heading.closest("section") as HTMLElement;
};
const sent = (calls: Call[], method: string, path: string) =>
  calls.find((c) => c.method === method && c.path === path);
/** Opens the panel of the routine « Nettoyage ». */
async function openRoutine() {
  fireEvent.click(
    within(await section("Tes tâches")).getByRole("button", {
      name: /Nettoyage/,
    }),
  );
  await screen.findByRole("button", { name: "Lancer maintenant" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("criterion 7: the page Tâches programmées", () => {
  it("given a user, when a page loads, then the sidebar has the link Claude to /claude/taches", async () => {
    stubApi();
    renderAt("/");

    const link = await within(
      await screen.findByRole("complementary"),
    ).findByRole("link", { name: /^Claude/ });

    expect(link.getAttribute("href")).toBe("/claude/taches");
  });

  it("given the write-US task and two routines, when the page loads, then Tes tâches lists them with their projects and Prochains lancements gives the unpaused ones in time order", async () => {
    stubApi([
      routine({ id: 1, name: "Tard", nextRunAt: "2026-11-10T11:00:00.000Z" }),
      routine({ id: 2, name: "Tôt", nextRunAt: "2026-11-09T11:00:00.000Z" }),
      routine({ id: 3, name: "Muette", pausedAt: "2026-11-08T09:00:00.000Z" }),
    ]);
    renderAt("/claude/taches");

    const mine = await section("Tes tâches");
    const next = await section("Prochains lancements");

    expect(mine.textContent).toMatch(/Écrire les US/);
    for (const name of ["Tard", "Tôt", "Muette"])
      expect(mine.textContent).toContain(name);
    expect(mine.textContent).toContain("octocat/hello");
    const text = next.textContent ?? "";
    expect(text.indexOf("Tôt")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Tôt")).toBeLessThan(text.indexOf("Tard"));
    expect(text).not.toContain("Muette");
  });

  it("given a connected launcher, when « + Nouvelle tâche » is clicked and the form is filled, then the panel offers only the ticked projects and Enregistrer POSTs the routine", async () => {
    const calls = stubApi();
    renderAt("/claude/taches");

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Nouvelle tâche" }),
    );
    fireEvent.change(await screen.findByLabelText("Nom"), {
      target: { value: "Nettoyage" },
    });
    fireEvent.change(screen.getByLabelText("Consigne"), {
      target: { value: "Ranger les imports" },
    });
    fireEvent.change(screen.getByLabelText("Agents"), {
      target: { value: "bug-hunter" },
    });
    fireEvent.change(screen.getByLabelText("Quand"), {
      target: { value: "on_demand" },
    });
    expect(
      screen.queryByRole("checkbox", { name: /octocat\/world/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /octocat\/hello/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(sent(calls, "POST", "/api/routines")).toBeDefined(),
    );
    expect(
      JSON.parse(sent(calls, "POST", "/api/routines")?.body ?? "{}"),
    ).toMatchObject({
      name: "Nettoyage",
      instruction: "Ranger les imports",
      agents: ["bug-hunter"],
      projectIds: [5],
      frequency: "on_demand",
    });
  });

  it("given a routine, when it is opened and « Lancer maintenant » is clicked, then POST /api/routines/1/run is sent and the panel links to the last session", async () => {
    const calls = stubApi([routine()]);
    renderAt("/claude/taches");
    await openRoutine();

    expect(
      screen
        .getByRole("link", { name: /voir la session/ })
        .getAttribute("href"),
    ).toBe("https://claude.ai/code/session_01ABC");
    fireEvent.click(screen.getByRole("button", { name: "Lancer maintenant" }));

    await waitFor(() =>
      expect(sent(calls, "POST", "/api/routines/1/run")).toBeDefined(),
    );
  });

  it("given a routine, when « Mettre en pause » is clicked, then POST /pause is sent; a paused one offers « Reprendre », which POSTs /resume", async () => {
    const calls = stubApi([routine()]);
    renderAt("/claude/taches");
    await openRoutine();
    fireEvent.click(screen.getByRole("button", { name: "Mettre en pause" }));
    await waitFor(() =>
      expect(sent(calls, "POST", "/api/routines/1/pause")).toBeDefined(),
    );
    cleanup();

    const again = stubApi([routine({ pausedAt: "2026-11-08T09:00:00.000Z" })]);
    renderAt("/claude/taches");
    await openRoutine();
    fireEvent.click(screen.getByRole("button", { name: "Reprendre" }));

    await waitFor(() =>
      expect(sent(again, "POST", "/api/routines/1/resume")).toBeDefined(),
    );
  });

  it("given a routine, when « Supprimer » is clicked, then DELETE /api/routines/1 is sent", async () => {
    const calls = stubApi([routine()]);
    renderAt("/claude/taches");
    await openRoutine();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() =>
      expect(sent(calls, "DELETE", "/api/routines/1")).toBeDefined(),
    );
  });

  it("given no launcher, when the page loads, then it links to /reglages/taches-cloud", async () => {
    stubApi([], false);
    renderAt("/claude/taches");

    await screen.findByRole("heading", { level: 2, name: "Tes tâches" });

    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === "/reglages/taches-cloud"),
    ).toBe(true);
  });
});
