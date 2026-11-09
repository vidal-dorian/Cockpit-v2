// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, type HomeData, PROJECT, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 14.6 (decision 044 and its amendments C', M', J): the night in the web page.
//
// Server shapes assumed (the same as the server tests, see src/server/test-launcher.ts):
// - GET /api/nights/current -> { night: null | { id, status: "planned" | "running" | "finished", startsAt, endsAt, items }, ready, toValidate }
//   with an item { storyId, iWant, project: { id, name }, estimatedSeconds: number | null, outcome: string | null };
// - GET /api/me/night-hours -> { startHour, endHour, timeZone }, saved by PUT /api/me/night-hours; GET /api/me/budgets gives nightUsd;
// - GET /api/home -> { ..., night: null | { id, delivered, total, items: [{ storyId, iWant, outcome, startedAt, finishedAt }] } };
// - writes: POST /api/nights { storyIds }, POST /api/nights/current/cancel and /stop, POST /api/nights/:id/hide, POST /api/stories/:id/validate.
// Pinned labels (the decision leaves them open):
// - sidebar link « ☾ Cette nuit » (plus the number of stories of the night) to /nuit;
// - launcher card (section « Lanceur Cockpit »): number inputs « Début », « Fin », « Plafond par nuit », button « Enregistrer les heures »;
// - /nuit: level 2 headings « Au programme » and « Pourrait s'ajouter » each in a section, « Les règles de la nuit »; buttons
//   « Monter », « Descendre », « Retirer » in each row of the programme, « Valider et ajouter », « ☾ Lancer la nuit · N user stories »,
//   « Annuler la nuit », « Arrêter la nuit »; reasons « Connecte le lanceur » and « Aucune user story » beside the disabled launch;
//   outcomes written « En pause : attend ta réponse » and « CI en échec »;
// - home: « Cette nuit, Claude a livré N PR sur M », « 1 question t'attend », the frise is a list named « Frise de la nuit », « Masquer ».

type Call = { method: string; path: string; body: unknown };
const story = (storyId: number, outcome: string | null = null) => ({
  storyId,
  iWant: `faire la chose ${storyId}`,
  project: PROJECT,
  estimatedSeconds: null,
  outcome,
});
type Options = {
  connected?: boolean;
  night?: { id: number; status: string; items: ReturnType<typeof story>[] };
  ready?: ReturnType<typeof story>[];
  toValidate?: ReturnType<typeof story>[];
  home?: Partial<HomeData> & { night?: unknown };
};

function stub(o: Options = {}) {
  stubHome({ ...empty(), ...o.home } as HomeData);
  const inner = globalThis.fetch;
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
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (method !== "GET") calls.push({ method, path, body });
      if (path === "/api/nights/current" && method === "GET")
        return Response.json({
          night: o.night ?? null,
          ready: o.ready ?? [],
          toValidate: o.toValidate ?? [],
        });
      if (path === "/api/nights" && method === "POST")
        return Response.json({ id: 1 }, { status: 201 });
      if (path.startsWith("/api/nights/") && method === "POST")
        return Response.json({});
      if (/^\/api\/stories\/\d+\/validate$/.test(path))
        return Response.json({ story: { id: 1 } });
      if (path === "/api/me/night-hours")
        return Response.json({ startHour: 22, endHour: 7, timeZone: "UTC" });
      if (path === "/api/me/budgets")
        return Response.json({ runUsd: null, nightUsd: 5, monthUsd: null });
      if (path === "/api/me/launcher")
        return Response.json({
          connected: o.connected ?? true,
          needsReconnect: false,
          prompt: "P",
          projectIds: [5],
          missingProjectIds: [],
          autoRelaunch: false,
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "R",
        });
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
      return inner(input, init);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () =>
  (screen.getByRole("main").textContent ?? "").replace(/\s+/g, " ");
const section = async (name: string) => {
  const heading = await screen.findByRole("heading", { level: 2, name });
  return heading.closest("section") as HTMLElement;
};
const row = (programme: HTMLElement, n: number) =>
  within(programme)
    .getAllByRole("listitem")
    .find((li) =>
      li.textContent?.includes(`faire la chose ${n}`),
    ) as HTMLElement;

describe("criterion 1: the night hours on the launcher card (C')", () => {
  it("given the launcher card, when it is shown and the start is changed and saved, then it shows Début 22, Fin 7 and the cap per night, and PUTs the hours", async () => {
    const calls = stub();
    renderAt("/reglages/taches-cloud");
    const card = await section("Lanceur Cockpit");

    const start = (await within(card).findByLabelText(
      "Début",
    )) as HTMLInputElement;
    expect(start.value).toBe("22");
    expect((within(card).getByLabelText("Fin") as HTMLInputElement).value).toBe(
      "7",
    );
    expect(
      (within(card).getByLabelText("Plafond par nuit") as HTMLInputElement)
        .value,
    ).toBe("5");
    fireEvent.change(start, { target: { value: "21" } });
    fireEvent.click(
      within(card).getByRole("button", { name: "Enregistrer les heures" }),
    );

    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/me/night-hours")).toMatchObject(
        {
          method: "PUT",
          body: { startHour: 21, endHour: 7, timeZone: expect.any(String) },
        },
      ),
    );
  });
});

describe("criterion 11: the pages (M')", () => {
  it("given a logged-in user, when a page is shown, then the sidebar has « ☾ Cette nuit » to /nuit with the number of stories of the night", async () => {
    stub({ night: { id: 1, status: "planned", items: [story(1), story(2)] } });
    renderAt("/journal");

    const link = await screen.findByRole("link", { name: /☾ Cette nuit/ });

    expect(link.getAttribute("href")).toBe("/nuit");
    await waitFor(() => expect(link.textContent).toContain("2"));
  });

  it("given the evening, when stories are moved, one validated and added, and the night launched, then the order and the stories are sent, and the rules are shown", async () => {
    const calls = stub({ ready: [story(1), story(2)], toValidate: [story(3)] });
    renderAt("/nuit");
    const programme = await section("Au programme");
    const maybe = await section("Pourrait s'ajouter");
    await waitFor(() => expect(row(programme, 1)).toBeDefined());

    fireEvent.click(
      within(row(programme, 1)).getByRole("button", { name: "Descendre" }),
    );
    fireEvent.click(
      within(maybe).getByRole("button", { name: "Valider et ajouter" }),
    );
    await waitFor(() => expect(row(programme, 3)).toBeDefined());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 3 user stories",
      }),
    );

    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/nights")?.body).toEqual({
        storyIds: [2, 1, 3],
      }),
    );
    expect(
      calls.find((c) => c.path === "/api/stories/3/validate")?.method,
    ).toBe("POST");
    expect(
      screen.getByRole("heading", { name: "Les règles de la nuit" }),
    ).toBeDefined();
  });

  it("given a story in the programme, when it is removed, then the launch button counts one less", async () => {
    stub({ ready: [story(1), story(2), story(3)] });
    renderAt("/nuit");
    const programme = await section("Au programme");
    await waitFor(() => expect(row(programme, 1)).toBeDefined());

    fireEvent.click(
      within(row(programme, 2)).getByRole("button", { name: "Retirer" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 2 user stories",
      }),
    ).toBeDefined();
  });

  it.each([
    [
      "no connected launcher",
      { connected: false, ready: [story(1)] },
      /Connecte le lanceur/,
    ],
    ["no story", { connected: true, ready: [] }, /Aucune user story/],
  ])(
    "given %s, when /nuit is shown, then the launch button is disabled and the reason is written",
    async (_name, options, reason) => {
      stub(options);
      renderAt("/nuit");

      const button = await screen.findByRole("button", {
        name: /☾ Lancer la nuit/,
      });

      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(main()).toMatch(reason);
    },
  );

  it("given the server refusing the night with 403 role, when the night is launched, then the sentence of the role is shown (076 G)", async () => {
    stub({ ready: [story(1)] });
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
        typeof input === "string" &&
        input === "/api/nights" &&
        init?.method === "POST"
          ? Response.json({ error: "role" }, { status: 403 })
          : inner(input, init),
      ),
    );
    renderAt("/nuit");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 1 user story",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Ton rôle sur ce projet ne le permet pas.",
    );
  });

  it("given a planned night, when « Annuler la nuit » is clicked, then the cancel is posted", async () => {
    const calls = stub({
      night: { id: 1, status: "planned", items: [story(1)] },
    });
    renderAt("/nuit");

    fireEvent.click(
      await screen.findByRole("button", { name: "Annuler la nuit" }),
    );

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/nights/current/cancel",
        body: undefined,
      }),
    );
  });

  it("given a running night, when /nuit is shown, then the items show their outcome and « Arrêter la nuit » posts the stop", async () => {
    const calls = stub({
      night: {
        id: 1,
        status: "running",
        items: [story(1, "pr"), story(2, "paused"), story(3, "ci_failed")],
      },
    });
    renderAt("/nuit");

    await screen.findByRole("button", { name: "Arrêter la nuit" });
    expect(main()).toContain("En pause : attend ta réponse");
    expect(main()).toContain("CI en échec");
    fireEvent.click(screen.getByRole("button", { name: "Arrêter la nuit" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/nights/current/stop",
        body: undefined,
      }),
    );
  });
});

describe("criterion 10: the morning on the home (J)", () => {
  const night = {
    id: 7,
    delivered: 1,
    total: 2,
    items: [
      {
        storyId: 1,
        iWant: "faire la chose 1",
        outcome: "paused",
        startedAt: "2026-11-08T22:00:00Z",
        finishedAt: "2026-11-08T23:10:00Z",
      },
      {
        storyId: 2,
        iWant: "faire la chose 2",
        outcome: "pr",
        startedAt: "2026-11-08T23:10:00Z",
        finishedAt: "2026-11-09T04:10:00Z",
      },
    ],
  };

  it("given a finished night, when the home is shown, then it tells the PR count, the frise, the question waiting, and « Masquer » hides it", async () => {
    const answer = {
      kind: "answer",
      questionId: 9,
      question: "Quel nom ?",
      suggestedAnswers: null,
      runId: 3,
      storyId: 1,
      iWant: "faire la chose 1",
      project: PROJECT,
    };
    const calls = stub({ home: { night, forYou: [answer] } });
    renderAt("/");

    await waitFor(() =>
      expect(main()).toContain("Cette nuit, Claude a livré 1 PR sur 2"),
    );
    expect(main()).toContain("1 question t'attend");
    const frise = screen.getByRole("list", { name: "Frise de la nuit" });
    const [first, second] = within(frise).getAllByRole("listitem");
    expect(first?.textContent).toContain("En pause");
    expect(second?.textContent).toContain("faire la chose 2");
    fireEvent.click(screen.getByRole("button", { name: "Masquer" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/nights/7/hide",
        body: undefined,
      }),
    );
  });
});
