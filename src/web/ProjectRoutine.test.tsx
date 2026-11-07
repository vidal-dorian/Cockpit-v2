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

// Decision 022 D, H: the section « Écriture automatique des US » of the project page.
//
// Pinned choices (the decision leaves them open):
// - The page reads GET /api/projects/:id/routine ({ frequency, hour, weekday, timeZone, nextRunAt, lastRun }) and,
//   to know whether a routine is connected, GET /api/me/routine ({ connected, needsReconnect, ... }).
// - The frequency is a group of four radios (« Fréquence »), their values off / on_demand / daily / weekly
//   (labels: Désactivée, À la demande, Chaque jour, Chaque semaine). « Heure » is a <select> of 24 options (values
//   0..23), shown for daily and weekly only; « Jour » a <select> of 7 options (values 1..7, Monday 1), shown for weekly only.
// - « Enregistrer » saves with PUT /api/projects/:id/routine, always with the time zone of the browser
//   (Intl.DateTimeFormat().resolvedOptions().timeZone); the page then shows what the server answers.
// - « Écrire les US maintenant » posts to /api/projects/:id/routine/run, then reads the schedule again.
// - The last run reads « Dernier lancement », « Réussi » or « Échec », with the link « Voir la session » when there is
//   a session url; the next one reads « Prochain passage » and a French date, or nothing when there is none.

const choose = (section: HTMLElement, value: string) =>
  fireEvent.click(
    within(section)
      .getAllByRole("radio")
      .find((r) => (r as HTMLInputElement).value === value) as HTMLElement,
  );

type Schedule = {
  frequency: "off" | "on_demand" | "daily" | "weekly";
  hour: number | null;
  weekday: number | null;
  timeZone: string;
  nextRunAt: string | null;
  lastRun: { at: string; result: string; sessionUrl: string | null } | null;
};
type State = {
  schedule: Schedule;
  routine: { connected: boolean; needsReconnect: boolean };
  /** What POST .../run answers instead of firing. */
  runAnswer?: Response;
  /** What PUT answers instead of saving. */
  putAnswer?: Response;
  /** What the next GET of the schedule shows after a successful run. */
  lastRunAfterRun?: Schedule["lastRun"];
};
type Call = { method: string; path: string; body: string };

const OFF: Schedule = {
  frequency: "off",
  hour: null,
  weekday: null,
  timeZone: "Europe/Paris",
  nextRunAt: null,
  lastRun: null,
};
const DAILY_AT_7: Schedule = {
  ...OFF,
  frequency: "daily",
  hour: 7,
  nextRunAt: "2026-10-30T12:00:00.000Z",
};
const CONNECTED = { connected: true, needsReconnect: false };
const SESSION = "https://claude.ai/code/session_01HJKLMNOPQRSTUVWXYZ";
const NEW_SESSION = "https://claude.ai/code/session_NEW";

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

/** A small fake server behind fetch, for the page of project 5. */
function stubApi(state: State) {
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
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({ method, path, body });

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
              archived: false,
            },
          ],
        });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: false,
          repositories: [],
        });
      if (path === "/api/projects/5/health")
        return Response.json({
          lines: ["claude_md", "ci", "mcp", "agents"].map((key) => ({
            key,
            ok: true,
            detail: "ok",
          })),
        });
      if (path === "/api/projects/5/tickets" && method === "GET")
        return Response.json({ tickets: [] });
      if (path === "/api/projects/5/stories" && method === "GET")
        return Response.json({ stories: [] });
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          ...state.routine,
          fireUrl: state.routine.connected
            ? "https://api.anthropic.com/v1/claude_code/routines/trig_1/fire"
            : null,
          prompt: "This task is started by Cockpit.",
        });
      if (path === "/api/projects/5/routine") {
        if (method === "GET") return Response.json(state.schedule);
        if (method === "PUT") {
          if (state.putAnswer) return state.putAnswer.clone();
          const sent = JSON.parse(body) as Partial<Schedule>;
          state.schedule = {
            ...OFF,
            ...sent,
            hour: sent.hour ?? null,
            weekday: sent.weekday ?? null,
            nextRunAt:
              sent.frequency === "daily" || sent.frequency === "weekly"
                ? "2026-11-02T08:00:00.000Z"
                : null,
            lastRun: state.schedule.lastRun,
          } as Schedule;
          return Response.json(state.schedule);
        }
      }
      if (path === "/api/projects/5/routine/run" && method === "POST") {
        if (state.runAnswer) return state.runAnswer.clone();
        state.schedule = {
          ...state.schedule,
          lastRun: state.lastRunAfterRun ?? {
            at: "2026-10-29T12:00:00.000Z",
            result: "ok",
            sessionUrl: NEW_SESSION,
          },
        };
        return Response.json({ sessionUrl: NEW_SESSION });
      }
      if (path === "/api/projects/5/archive" && method === "POST")
        return Response.json({ ok: true });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

/** The section, found by its heading, once the schedule and the routine are read. */
async function routineSection() {
  const heading = await screen.findByRole("heading", {
    name: "Écriture automatique des US",
  });
  const section = heading.closest("section");
  expect(section, "the heading must be inside a section").not.toBeNull();
  await waitFor(() =>
    expect(
      within(section as HTMLElement).queryByText("Chargement…"),
      "the schedule is loaded",
    ).toBeNull(),
  );
  return section as HTMLElement;
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");
const sent = (call: Call | undefined) => JSON.parse(call?.body ?? "{}");

function browserTimeZone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Project page, the section Écriture automatique des US", () => {
  it("given a project, when /projets/5 loads, then the section is a heading and reads the schedule and the routine of the project", async () => {
    const calls = stubApi({ schedule: OFF, routine: CONNECTED });

    renderAt("/projets/5/ecriture-us");

    await routineSection();
    const gets = calls.filter((c) => c.method === "GET").map((c) => c.path);
    expect(gets).toContain("/api/projects/5/routine");
    expect(gets).toContain("/api/me/routine");
  });

  it("given the frequency off, when the section loads, then the choice shows the four frequencies, off is selected, and neither the hour nor the weekday is shown", async () => {
    stubApi({ schedule: OFF, routine: CONNECTED });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    const radios = within(section).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual([
      "off",
      "on_demand",
      "daily",
      "weekly",
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
    expect(within(section).queryByLabelText("Heure")).toBeNull();
    expect(within(section).queryByLabelText("Jour")).toBeNull();
  });

  it("given a daily schedule, when the section loads, then the hour is shown with its 24 values and the saved hour selected, and the weekday is not shown", async () => {
    stubApi({ schedule: DAILY_AT_7, routine: CONNECTED });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    const hour = (await within(section).findByLabelText(
      "Heure",
    )) as HTMLSelectElement;
    expect(within(hour).getAllByRole("option")).toHaveLength(24);
    expect(hour.value).toBe("7");
    expect(
      (
        within(section).getByRole("radio", {
          name: "Chaque jour",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(within(section).queryByLabelText("Jour")).toBeNull();
  });

  it("given a weekly schedule, when the section loads, then the hour and the weekday (7 values, Monday 1) are shown with the saved values", async () => {
    stubApi({
      schedule: { ...DAILY_AT_7, frequency: "weekly", hour: 9, weekday: 1 },
      routine: CONNECTED,
    });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    const day = (await within(section).findByLabelText(
      "Jour",
    )) as HTMLSelectElement;
    expect(
      within(day)
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(day.value).toBe("1");
    expect(
      (within(section).getByLabelText("Heure") as HTMLSelectElement).value,
    ).toBe("9");
  });

  it("given the frequency off, when Chaque jour then Chaque semaine then À la demande is chosen, then the hour and the weekday appear and disappear as they apply", async () => {
    stubApi({ schedule: OFF, routine: CONNECTED });
    renderAt("/projets/5/ecriture-us");
    const section = await routineSection();
    choose(section, "daily");
    expect(within(section).getByLabelText("Heure")).toBeDefined();
    expect(within(section).queryByLabelText("Jour")).toBeNull();
    choose(section, "weekly");
    expect(within(section).getByLabelText("Heure")).toBeDefined();
    expect(within(section).getByLabelText("Jour")).toBeDefined();
    choose(section, "on_demand");
    expect(within(section).queryByLabelText("Heure")).toBeNull();
    expect(within(section).queryByLabelText("Jour")).toBeNull();
  });

  it("given Chaque jour at 7 h chosen, when Enregistrer is clicked, then PUT sends the frequency, the hour and the time zone of the browser, and the next run it answers is shown in French", async () => {
    browserTimeZone("Europe/Paris");
    const calls = stubApi({ schedule: OFF, routine: CONNECTED });
    renderAt("/projets/5/ecriture-us");
    const section = await routineSection();
    choose(section, "daily");
    fireEvent.change(within(section).getByLabelText("Heure"), {
      target: { value: "7" },
    });

    fireEvent.click(
      within(section).getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: "PUT",
      path: "/api/projects/5/routine",
    });
    expect(sent(writes(calls)[0])).toEqual({
      frequency: "daily",
      hour: 7,
      timeZone: "Europe/Paris",
    });
    await waitFor(() =>
      expect(section.textContent).toMatch(/Prochain passage/),
    );
    expect(section.textContent).toMatch(/2 novembre|02\/11\/2026/);
  });

  it("given Chaque semaine on Wednesday at 18 h chosen in another time zone, when Enregistrer is clicked, then PUT sends the weekday as a number and the time zone of the browser", async () => {
    browserTimeZone("America/New_York");
    const calls = stubApi({ schedule: OFF, routine: CONNECTED });
    renderAt("/projets/5/ecriture-us");
    const section = await routineSection();
    choose(section, "weekly");
    fireEvent.change(within(section).getByLabelText("Jour"), {
      target: { value: "3" },
    });
    fireEvent.change(within(section).getByLabelText("Heure"), {
      target: { value: "18" },
    });

    fireEvent.click(
      within(section).getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(sent(writes(calls)[0])).toEqual({
      frequency: "weekly",
      weekday: 3,
      hour: 18,
      timeZone: "America/New_York",
    });
  });

  it("given À la demande chosen, when Enregistrer is clicked, then PUT sends the frequency and the time zone, no hour, and no next run is shown", async () => {
    browserTimeZone("Europe/Paris");
    const calls = stubApi({ schedule: DAILY_AT_7, routine: CONNECTED });
    renderAt("/projets/5/ecriture-us");
    const section = await routineSection();
    await within(section).findByLabelText("Heure");
    choose(section, "on_demand");

    fireEvent.click(
      within(section).getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(sent(writes(calls)[0])).toMatchObject({
      frequency: "on_demand",
      timeZone: "Europe/Paris",
    });
    expect(sent(writes(calls)[0]).hour ?? null).toBeNull();
    await waitFor(() =>
      expect(section.textContent).not.toMatch(/Prochain passage/),
    );
  });

  it("given a schedule with a next run, when the section loads, then it reads Prochain passage with the date in French", async () => {
    stubApi({ schedule: DAILY_AT_7, routine: CONNECTED });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    expect(section.textContent).toMatch(/Prochain passage/);
    expect(section.textContent).toMatch(/30 octobre|30\/10\/2026/);
  });

  it("given a project, when the section loads, then the sentence about nothing to write is scoped to the planning, since the button always fires (022 D, E)", async () => {
    stubApi({ schedule: DAILY_AT_7, routine: CONNECTED });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    expect(section.textContent).toMatch(/au planning|lancement automatique/i);
    expect(
      within(section).getByRole("button", { name: "Écrire les US maintenant" }),
    ).not.toBeNull();
  });

  it("given a project with no schedule, when the section loads, then it shows no next run and no last run", async () => {
    stubApi({ schedule: OFF, routine: CONNECTED });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    expect(section.textContent).not.toMatch(/Prochain passage/);
    expect(section.textContent).not.toMatch(/Dernier lancement/);
    expect(
      within(section).queryByRole("link", { name: "Voir la session" }),
    ).toBeNull();
  });

  it("given a successful last run, when the section loads, then it reads Dernier lancement, Réussi and the link Voir la session to the session, opened in a new tab with rel noreferrer", async () => {
    stubApi({
      schedule: {
        ...DAILY_AT_7,
        lastRun: {
          at: "2026-10-29T05:00:00.000Z",
          result: "ok",
          sessionUrl: SESSION,
        },
      },
      routine: CONNECTED,
    });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    expect(section.textContent).toMatch(/Dernier lancement/);
    expect(section.textContent).toMatch(/Réussi/);
    expect(section.textContent).toMatch(/29 octobre|29\/10\/2026/);
    const link = within(section).getByRole("link", { name: "Voir la session" });
    expect(link.getAttribute("href")).toBe(SESSION);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/\bnoreferrer\b/);
  });

  it("given a failed last run without a session, when the section loads, then it reads Échec, not Réussi, and offers no link", async () => {
    stubApi({
      schedule: {
        ...DAILY_AT_7,
        lastRun: {
          at: "2026-10-29T05:00:00.000Z",
          result: "error",
          sessionUrl: null,
        },
      },
      routine: CONNECTED,
    });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    expect(section.textContent).toMatch(/Échec/);
    expect(section.textContent).not.toMatch(/Réussi/);
    expect(
      within(section).queryByRole("link", { name: "Voir la session" }),
    ).toBeNull();
  });

  it("given a connected routine, when « Écrire les US maintenant » is clicked, then it posts to the run route and then shows the new last run with its Voir la session link", async () => {
    const calls = stubApi({ schedule: OFF, routine: CONNECTED });
    renderAt("/projets/5/ecriture-us");
    const section = await routineSection();
    expect(
      within(section).queryByRole("link", { name: "Voir la session" }),
    ).toBeNull();

    fireEvent.click(
      within(section).getByRole("button", { name: "Écrire les US maintenant" }),
    );

    await waitFor(() =>
      expect(
        within(section)
          .getByRole("link", { name: "Voir la session" })
          .getAttribute("href"),
      ).toBe(NEW_SESSION),
    );
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({
      method: "POST",
      path: "/api/projects/5/routine/run",
    });
    expect(section.textContent).toMatch(/Dernier lancement/);
    expect(section.textContent).toMatch(/Réussi/);
  });

  it("given no routine connected, when the section loads, then it links to Réglages and cannot fire", async () => {
    stubApi({
      schedule: OFF,
      routine: { connected: false, needsReconnect: false },
    });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    const link = await within(section).findByRole("link", { name: /Réglages/ });
    expect(link.getAttribute("href")).toBe("/reglages/ecriture-us");
    const button = within(section).queryByRole("button", {
      name: "Écrire les US maintenant",
    });
    expect(button === null || (button as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("given a routine that needs reconnecting, when the section loads, then it says so with a link to Réglages and cannot fire", async () => {
    stubApi({
      schedule: OFF,
      routine: { connected: true, needsReconnect: true },
    });

    renderAt("/projets/5/ecriture-us");

    const section = await routineSection();
    await waitFor(() => expect(section.textContent).toMatch(/reconnecter/));
    expect(
      within(section)
        .getByRole("link", { name: /Réglages/ })
        .getAttribute("href"),
    ).toBe("/reglages/ecriture-us");
    const button = within(section).queryByRole("button", {
      name: "Écrire les US maintenant",
    });
    expect(button === null || (button as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it.each([
    ["routine_not_connected", 409, /connecte|Réglages/i],
    ["routine_needs_reconnect", 409, /reconnecter|Réglages/i],
    ["project_archived", 409, /archiv/i],
    ["fire_failed", 502, /réessaie|échoué|Claude/i],
  ])(
    "given the run answers %s (%i), when « Écrire les US maintenant » is clicked, then an alert explains it in French, without the raw code",
    async (code, status, french) => {
      stubApi({
        schedule: OFF,
        routine: CONNECTED,
        runAnswer: Response.json({ error: code }, { status }),
      });
      renderAt("/projets/5/ecriture-us");
      const section = await routineSection();

      fireEvent.click(
        within(section).getByRole("button", {
          name: "Écrire les US maintenant",
        }),
      );

      const alert = await within(section).findByRole("alert");
      expect(alert.textContent).toMatch(french);
      expect(alert.textContent).not.toContain(code);
      expect(alert.textContent).not.toMatch(/\b(409|502)\b|HTTP/);
    },
  );

  it.each([
    ["Bad request", 400],
    ["project_archived", 409],
    ["Internal Server Error", 500],
  ])(
    "given the save answers %s (%i), when Enregistrer is clicked, then an alert explains it in French, without the raw code",
    async (code, status) => {
      stubApi({
        schedule: OFF,
        routine: CONNECTED,
        putAnswer: Response.json({ error: code }, { status }),
      });
      renderAt("/projets/5/ecriture-us");
      const section = await routineSection();
      choose(section, "on_demand");

      fireEvent.click(
        within(section).getByRole("button", { name: "Enregistrer" }),
      );

      const alert = await within(section).findByRole("alert");
      expect(alert.textContent?.trim()).not.toBe("");
      expect(alert.textContent).not.toContain(code);
      expect(alert.textContent).not.toMatch(/\b(400|409|500)\b|HTTP/);
    },
  );

  it("given the Réglages tab, when « Archiver le projet » is clicked and confirmed, then the archive route is posted once; Annuler posts nothing", async () => {
    const calls = stubApi({ schedule: OFF, routine: CONNECTED });
    renderAt("/projets/5/reglages");
    await routineSection();
    const archives = () => calls.filter((c) => c.path.endsWith("/archive"));

    fireEvent.click(screen.getByRole("button", { name: "Archiver le projet" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(archives()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Archiver le projet" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer l'archivage" }),
    );
    await waitFor(() => expect(archives()).toHaveLength(1));
    expect(archives()[0]?.method).toBe("POST");
  });

  it("given a folder remembered by « Développer avec Claude », when the Réglages tab loads, then the clone folder shows it, and typing another one stores it under the same key", async () => {
    window.localStorage.setItem("cockpit.clone.5", "/home/me/hello");
    stubApi({ schedule: OFF, routine: CONNECTED });
    renderAt("/projets/5/reglages");
    await routineSection();

    const input = screen.getByLabelText("Dossier du clone") as HTMLInputElement;
    expect(input.value).toBe("/home/me/hello");
    fireEvent.change(input, { target: { value: "/work/hello" } });

    expect(window.localStorage.getItem("cockpit.clone.5")).toBe("/work/hello");
    window.localStorage.removeItem("cockpit.clone.5");
  });
});
