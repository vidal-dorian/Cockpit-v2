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
// - /nuit (decision 084 E1): « Cette nuit, Claude a livré N PR sur M », « 1 question t'attend », « Masquer » (the frise and the outcome groups: NightVisual.test.tsx).

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
const has = (part: HTMLElement, n: number) =>
  within(part)
    .queryAllByRole("listitem")
    .some((li) => li.textContent?.includes(`faire la chose ${n}`));
/** Clicks « Ajouter » on each story, in this order, waiting for it to reach the programme. */
const addAll = async (ids: number[]) => {
  const programme = await section("Au programme");
  const maybe = await section("Pourrait s'ajouter");
  for (const n of ids) {
    const li = await waitFor(() => {
      const found = within(maybe)
        .getAllByRole("listitem")
        .find((i) => i.textContent?.includes(`faire la chose ${n}`));
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(within(li).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(has(programme, n)).toBe(true));
  }
};

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
    await addAll([1, 2]);

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
    await addAll([1, 2, 3]);

    fireEvent.click(
      within(row(programme, 2)).getByRole("button", { name: "Retirer" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 2 user stories",
      }),
    ).toBeDefined();
  });

  it("given ready stories and no open night, when /nuit opens, then the programme is empty, the stories are under « Pourrait s'ajouter » with « Ajouter », and the launch is disabled with its reason", async () => {
    const calls = stub({
      ready: [story(1), story(2)],
      toValidate: [story(3)],
    });
    renderAt("/nuit");
    const programme = await section("Au programme");
    const maybe = await section("Pourrait s'ajouter");

    await waitFor(() => expect(has(maybe, 1)).toBe(true));
    expect(has(programme, 1)).toBe(false);
    expect(has(programme, 2)).toBe(false);
    expect(within(programme).queryAllByRole("button")).toHaveLength(0);
    expect(programme.textContent).toContain("Aucune user story au programme.");
    expect(
      within(maybe).getAllByRole("button", { name: "Ajouter" }),
    ).toHaveLength(2);
    expect(
      within(maybe).getAllByRole("button", { name: "Valider et ajouter" }),
    ).toHaveLength(1);
    expect(has(maybe, 3)).toBe(true);
    const launch = screen.getByRole("button", {
      name: "☾ Lancer la nuit · 0 user story",
    }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(main()).toContain("Aucune user story à lancer.");
    expect(calls).toEqual([]);
  });

  it("given ready stories, when some are added in a chosen order and the night is launched, then only those storyIds are posted in click order", async () => {
    const calls = stub({ ready: [story(1), story(2), story(3)] });
    renderAt("/nuit");
    const programme = await section("Au programme");
    const maybe = await section("Pourrait s'ajouter");

    await addAll([3, 1]);

    expect(calls).toEqual([]);
    expect(has(maybe, 3)).toBe(false);
    expect(has(maybe, 1)).toBe(false);
    expect(has(maybe, 2)).toBe(true);
    const items = within(programme).getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("faire la chose 3");
    expect(items[1]?.textContent).toContain("faire la chose 1");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 2 user stories",
      }),
    );

    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/nights")?.body).toEqual({
        storyIds: [3, 1],
      }),
    );
  });

  it("given stories 1 and 2 added, when a refetch no longer returns story 1, then only story 2 is shown and launching posts only [2]", async () => {
    const options: Options = { ready: [story(1), story(2)] };
    const calls = stub(options);
    renderAt("/nuit");
    const programme = await section("Au programme");
    await addAll([1, 2]);

    options.ready = [story(2)];
    window.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(has(programme, 1)).toBe(false));
    expect(has(programme, 2)).toBe(true);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 1 user story",
      }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/nights")?.body).toEqual({
        storyIds: [2],
      }),
    );
  });

  it("given stories 1, 2 and 3 added, when a refetch no longer returns story 1 and story 2 goes down, then 3 is before 2 and launching posts [3, 2]", async () => {
    const options: Options = { ready: [story(1), story(2), story(3)] };
    const calls = stub(options);
    renderAt("/nuit");
    const programme = await section("Au programme");
    await addAll([1, 2, 3]);

    options.ready = [story(2), story(3)];
    window.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(has(programme, 1)).toBe(false));
    fireEvent.click(
      within(row(programme, 2)).getByRole("button", { name: "Descendre" }),
    );

    await waitFor(() => {
      const items = within(programme).getAllByRole("listitem");
      expect(items[0]?.textContent).toContain("faire la chose 3");
      expect(items[1]?.textContent).toContain("faire la chose 2");
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 2 user stories",
      }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/nights")?.body).toEqual({
        storyIds: [3, 2],
      }),
    );
  });

  it("given a story added to the programme, when « Retirer » is clicked, then it is listed again under « Pourrait s'ajouter » with « Ajouter »", async () => {
    stub({ ready: [story(1), story(2)] });
    renderAt("/nuit");
    const programme = await section("Au programme");
    const maybe = await section("Pourrait s'ajouter");
    await addAll([1]);

    fireEvent.click(
      within(row(programme, 1)).getByRole("button", { name: "Retirer" }),
    );

    await waitFor(() => expect(has(programme, 1)).toBe(false));
    expect(has(maybe, 1)).toBe(true);
    expect(
      within(
        within(maybe)
          .getAllByRole("listitem")
          .find((li) =>
            li.textContent?.includes("faire la chose 1"),
          ) as HTMLElement,
      ).getByRole("button", { name: "Ajouter" }),
    ).toBeDefined();
  });

  it("given no ready and no toValidate story, when /nuit opens, then « Pourrait s'ajouter » says « Aucune user story à ajouter. »", async () => {
    stub();
    renderAt("/nuit");
    const maybe = await section("Pourrait s'ajouter");

    expect(maybe.textContent).toContain("Aucune user story à ajouter.");
  });

  it("given an empty programme, when /nuit opens, then the state sentence asks to choose, and once a story is added it says Claude can develop it", async () => {
    stub({ ready: [story(1), story(2)] });
    renderAt("/nuit");
    await section("Au programme");

    await waitFor(() =>
      expect(main()).toContain(
        "Choisis les user stories que Claude développera cette nuit.",
      ),
    );
    await addAll([1, 2]);

    expect((await section("Pourrait s'ajouter")).textContent).toContain(
      "Aucune user story à ajouter.",
    );
    expect(main()).toContain(
      "Claude peut développer 2 user stories pendant que tu dors.",
    );
    expect(main()).not.toContain("Choisis les user stories");
  });

  it("given ready stories not yet added, when /nuit opens, then « Aucune user story à ajouter. » is not shown before they are added", async () => {
    stub({ ready: [story(1), story(2)] });
    renderAt("/nuit");
    const maybe = await section("Pourrait s'ajouter");

    await waitFor(() => expect(has(maybe, 1)).toBe(true));

    expect(maybe.textContent).not.toContain("Aucune user story à ajouter.");
  });

  it("given stories 1 and 2 added and the night launched, when the night is cancelled, then the programme is empty again and nothing comes back without a new gesture", async () => {
    const options: Options = { ready: [story(1), story(2)] };
    stub(options);
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const res = await inner(input, init);
        const path = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          "http://localhost",
        ).pathname;
        if (init?.method === "POST" && path === "/api/nights")
          options.night = {
            id: 1,
            status: "planned",
            items: [story(1), story(2)],
          };
        if (init?.method === "POST" && path === "/api/nights/current/cancel")
          options.night = undefined;
        return res;
      }),
    );
    renderAt("/nuit");
    await section("Au programme");
    await addAll([1, 2]);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 2 user stories",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Annuler la nuit" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "☾ Lancer la nuit · 0 user story" }),
      ).toBeDefined(),
    );
    const after = await section("Au programme");
    expect(has(after, 1)).toBe(false);
    expect(has(after, 2)).toBe(false);
    expect(after.textContent).toContain("Aucune user story au programme.");
  });

  it("given a running night whose response is delayed, when /nuit is loading, then the choose sentence is never shown, and once loaded it says Claude develops while you sleep", async () => {
    stub({ night: { id: 1, status: "running", items: [story(1)] } });
    const inner = globalThis.fetch;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          new URL(raw, "http://localhost").pathname === "/api/nights/current" &&
          (init?.method ?? "GET") === "GET"
        )
          await gate;
        return inner(input, init);
      }),
    );
    renderAt("/nuit");
    await screen.findByRole("main");
    await new Promise((r) => setTimeout(r, 50));

    expect(main()).not.toContain("Choisis les user stories");
    release();

    await waitFor(() =>
      expect(main()).toContain("Claude développe pendant que tu dors."),
    );
    expect(main()).not.toContain("Choisis les user stories");
  });

  it("given GET /api/nights/current failing, when /nuit opens, then the alert is shown and the choose sentence is not", async () => {
    stub();
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
        if (
          new URL(raw, "http://localhost").pathname === "/api/nights/current" &&
          (init?.method ?? "GET") === "GET"
        )
          return Response.json({ error: "boom" }, { status: 500 });
        return inner(input, init);
      }),
    );
    renderAt("/nuit");

    await screen.findByRole("alert");

    expect(main()).not.toContain("Choisis les user stories");
  });

  it("given the page loaded with an empty programme, when a refetch of the night then fails with a 500, then the alert « Impossible de lire la page » is shown and the choose sentence is not", async () => {
    const options: Options = {};
    stub(options);
    const inner = globalThis.fetch;
    let failing = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          failing &&
          new URL(raw, "http://localhost").pathname === "/api/nights/current" &&
          (init?.method ?? "GET") === "GET"
        )
          return Response.json({ error: "boom" }, { status: 500 });
        return inner(input, init);
      }),
    );
    renderAt("/nuit");
    await section("Au programme");
    await waitFor(() =>
      expect(main()).toContain(
        "Choisis les user stories que Claude développera cette nuit.",
      ),
    );

    failing = true;
    window.dispatchEvent(new Event("visibilitychange"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Impossible de lire la page");
    expect(main()).not.toContain(
      "Choisis les user stories que Claude développera cette nuit.",
    );
  });

  it("given GET /api/me/launcher failing with a 500 and the night read succeeding with an empty programme, when /nuit opens, then the alert is shown and the choose sentence is not", async () => {
    stub();
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
        if (
          new URL(raw, "http://localhost").pathname === "/api/me/launcher" &&
          (init?.method ?? "GET") === "GET"
        )
          return Response.json({ error: "boom" }, { status: 500 });
        return inner(input, init);
      }),
    );
    renderAt("/nuit");

    await screen.findByRole("alert");

    expect(main()).not.toContain(
      "Choisis les user stories que Claude développera cette nuit.",
    );
  });

  it("given a planned night of 2 stories and GET /api/me/launcher failing with a 500, when /nuit opens, then the alert is shown and the title still reads Claude can develop 2 user stories", async () => {
    stub({
      night: { id: 1, status: "planned", items: [story(1), story(2)] },
    });
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
        if (
          new URL(raw, "http://localhost").pathname === "/api/me/launcher" &&
          (init?.method ?? "GET") === "GET"
        )
          return Response.json({ error: "boom" }, { status: 500 });
        return inner(input, init);
      }),
    );
    renderAt("/nuit");

    await screen.findByRole("alert");

    expect(main()).toContain(
      "Claude peut développer 2 user stories pendant que tu dors.",
    );
  });

  it("given no open night and 2 stories added, when a refetch of the night then fails with a 500, then the alert is shown and the title still reads Claude can develop 2 user stories", async () => {
    stub({ ready: [story(1), story(2)] });
    const inner = globalThis.fetch;
    let failing = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          failing &&
          new URL(raw, "http://localhost").pathname === "/api/nights/current" &&
          (init?.method ?? "GET") === "GET"
        )
          return Response.json({ error: "boom" }, { status: 500 });
        return inner(input, init);
      }),
    );
    renderAt("/nuit");
    await addAll([1, 2]);

    failing = true;
    window.dispatchEvent(new Event("visibilitychange"));

    await screen.findByRole("alert");
    expect(main()).toContain(
      "Claude peut développer 2 user stories pendant que tu dors.",
    );
  });

  it("given only stories to validate, when /nuit opens, then « Pourrait s'ajouter » shows « Valider et ajouter » and not « Aucune user story à ajouter. »", async () => {
    stub({ ready: [], toValidate: [story(3)] });
    renderAt("/nuit");
    const maybe = await section("Pourrait s'ajouter");

    await waitFor(() =>
      expect(within(maybe).getByText("Valider et ajouter")).toBeDefined(),
    );
    expect(maybe.textContent).not.toContain("Aucune user story à ajouter.");
  });

  it("given stories 1 and 2 added locally, when a refetch shows a planned night launched elsewhere and it is cancelled here, then the programme is empty and the button reads 0 user story", async () => {
    const options: Options = { ready: [story(1), story(2)] };
    stub(options);
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const res = await inner(input, init);
        const path = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          "http://localhost",
        ).pathname;
        if (init?.method === "POST" && path === "/api/nights/current/cancel")
          options.night = undefined;
        return res;
      }),
    );
    renderAt("/nuit");
    await section("Au programme");
    await addAll([1, 2]);

    options.night = {
      id: 7,
      status: "planned",
      items: [story(1), story(2)],
    };
    window.dispatchEvent(new Event("visibilitychange"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Annuler la nuit" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "☾ Lancer la nuit · 0 user story" }),
      ).toBeDefined(),
    );
    const after = await section("Au programme");
    expect(has(after, 1)).toBe(false);
    expect(has(after, 2)).toBe(false);
    expect(after.textContent).toContain("Aucune user story au programme.");
  });

  it("given a planned night, when /nuit opens, then its items are shown and « Pourrait s'ajouter » is hidden", async () => {
    stub({
      night: { id: 1, status: "planned", items: [story(1)] },
      ready: [story(2)],
    });
    renderAt("/nuit");
    const programme = await section("Au programme");

    await waitFor(() => expect(has(programme, 1)).toBe(true));
    expect(
      screen.queryByRole("heading", { level: 2, name: "Pourrait s'ajouter" }),
    ).toBeNull();
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
    await addAll([1]);

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
    expect(
      screen.queryByRole("heading", { level: 2, name: "Pourrait s'ajouter" }),
    ).toBeNull();
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

describe("criterion 10: the morning at the top of /nuit (J, decision 084 E1)", () => {
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

  it("given a finished night, when /nuit is shown, then it tells the PR count and the question waiting, and « Masquer » hides it", async () => {
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
    renderAt("/nuit");

    await waitFor(() =>
      expect(main()).toContain("Cette nuit, Claude a livré 1 PR sur 2"),
    );
    expect(main()).toContain("1 question t'attend");
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
