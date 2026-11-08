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
import { ACTIONS } from "./Journal.tsx";
import { entry, NOW, stubJournal } from "./test-journal.tsx";

// Decision 053 E and F (slice 11.1): the filters of the Journal page (S40).
//
// Pinned choices (the decision leaves them open):
// - The page keeps its state sentence « Tout ce qui s'est passé, par qui. » then « Rien ne s'efface ; chaque appel de Claude y est. » (h1), and has « Chercher… » (an <input>, placeholder « Chercher… »), then the chips:
//   buttons « Auteur », « Résultat », « Projet », « Outil », « Origine » and the period (« Tout » until another is chosen). A chip with a menu is a <button aria-haspopup="menu"> (a trailing ▾ is decoration);
//   its menu is role="menu" holding role="menuitem" items, and closes when one is chosen.
// - Menu items. Auteur: Toi, Claude, GitHub, Cockpit. Résultat: Réussi, Refusé, Erreur. Origine: Interface, MCP, Webhook, Cockpit. Projet: the repo name (without the owner) of each project of GET /api/projects.
//   Outil: the French label of every action of ACTIONS (Journal.tsx). Période: Aujourd'hui, Cette semaine, Ce mois-ci, Tout.
// - URL and request: choosing an item sets the URL parameter (`replace`, no extra history entry is required) and the request parameter:
//     Auteur   auteur=toi|claude|github|cockpit            -> actor=human|claude|github|system
//     Résultat resultat=reussi|refuse|erreur               -> result=ok|refused|error
//     Projet   projet=<project id>                         -> project=<id>
//     Outil    outil=<action name>                         -> action=<action name>
//     Origine  origine=interface|mcp|webhook|cockpit       -> origin=ui|mcp|webhook|system
//     Période  periode=aujourdhui|semaine|mois (absent = Tout) -> since=<ISO 8601 UTC of the start of the period in the browser's local time: today 00:00, Monday 00:00, the 1st 00:00>
//     Recherche q=<text as typed>                          -> q=<text as typed>
//   Nothing is sent for a filter that is not set (no `since` for Tout). The first request of the page already carries the filters of the URL.
// - A chosen Auteur, Résultat, Projet, Outil or Origine replaces its button by a chip: the label of the value and a button « Retirer le filtre <Auteur|Résultat|Projet|Outil|Origine> ».
//   The period chip stays a menu button named after the current period; it has no remove button.
// - « Effacer les filtres » is a <button>, present only while a filter, the search or a period is set; it removes them all (URL, requests, search box).
// - « Exporter » is a link (<a>) at the top of <main> to `/api/history/export` with the same parameters as the journal request (without `before`).

let nowIsPinned = false;
afterEach(() => {
  if (nowIsPinned) vi.useRealTimers();
  nowIsPinned = false;
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function pin(date: Date = NOW) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
  nowIsPinned = true;
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

const main = () => screen.getByRole("main");
const label = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*▾)?$`);
const chip = (name: string) =>
  within(main()).getByRole("button", { name: label(name) });
const urlParams = () => new URLSearchParams(window.location.search);
const last = (requests: URLSearchParams[]) => requests[requests.length - 1];
const loaded = () => screen.findByRole("heading", { level: 1 });

async function choose(chipName: string, item: string) {
  await loaded();
  fireEvent.click(chip(chipName));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

describe("Journal, the page (decision 053 F)", () => {
  it("given /journal, when it loads, then the state sentence, the search box, the five chips with the period Tout and Exporter are there, and no Effacer les filtres", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));

    renderAt("/journal");

    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("Tout ce qui s'est passé, par qui.");
    expect(h1.textContent).toContain(
      "Rien ne s'efface ; chaque appel de Claude y est.",
    );
    expect(within(main()).getByPlaceholderText("Chercher…")).toBeDefined();
    for (const name of [
      "Auteur",
      "Résultat",
      "Projet",
      "Outil",
      "Origine",
      "Tout",
    ])
      expect(chip(name), name).toBeDefined();
    expect(
      within(main()).getByRole("link", { name: "Exporter" }),
    ).toBeDefined();
    expect(
      within(main()).queryByRole("button", { name: "Effacer les filtres" }),
    ).toBeNull();
  });

  it.each([
    ["Auteur", ["Toi", "Claude", "GitHub", "Cockpit"]],
    ["Résultat", ["Réussi", "Refusé", "Erreur"]],
    ["Origine", ["Interface", "MCP", "Webhook", "Cockpit"]],
    ["Projet", ["hello", "api-facturation"]],
    ["Tout", ["Aujourd'hui", "Cette semaine", "Ce mois-ci", "Tout"]],
  ])(
    "given /journal, when the chip %s is opened, then its menu lists %j",
    async (name, items) => {
      stubJournal(() => ({ entries: [entry(1)] }));
      renderAt("/journal");
      await loaded();

      fireEvent.click(chip(name));

      const menu = await screen.findByRole("menu");
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.textContent?.trim()),
      ).toEqual(items);
    },
  );

  it("given /journal, when the chip Outil is opened, then its menu lists the French label of every action the journal can name", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await loaded();

    fireEvent.click(chip("Outil"));

    const menu = await screen.findByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent?.trim());
    expect([...names].sort()).toEqual(Object.values(ACTIONS).sort());
    expect(names).toContain("Ticket créé");
  });
});

describe("Journal, choosing a filter (decision 053 F)", () => {
  it.each([
    ["Auteur", "Toi", "auteur", "toi", "actor", "human"],
    ["Auteur", "Claude", "auteur", "claude", "actor", "claude"],
    ["Auteur", "GitHub", "auteur", "github", "actor", "github"],
    ["Auteur", "Cockpit", "auteur", "cockpit", "actor", "system"],
    ["Résultat", "Réussi", "resultat", "reussi", "result", "ok"],
    ["Résultat", "Refusé", "resultat", "refuse", "result", "refused"],
    ["Résultat", "Erreur", "resultat", "erreur", "result", "error"],
    ["Projet", "hello", "projet", "5", "project", "5"],
    ["Projet", "api-facturation", "projet", "6", "project", "6"],
    [
      "Outil",
      "Ticket créé",
      "outil",
      "create_ticket",
      "action",
      "create_ticket",
    ],
    ["Origine", "Interface", "origine", "interface", "origin", "ui"],
    ["Origine", "MCP", "origine", "mcp", "origin", "mcp"],
    ["Origine", "Webhook", "origine", "webhook", "origin", "webhook"],
    ["Origine", "Cockpit", "origine", "cockpit", "origin", "system"],
  ])(
    "given /journal, when %s then %s is chosen, then the URL has %s=%s, the request has %s=%s and the value is a chip with a remove button",
    async (chipName, item, urlKey, urlValue, queryKey, queryValue) => {
      const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
      renderAt("/journal");

      await choose(chipName, item);

      await waitFor(() =>
        expect(last(requests)?.get(queryKey)).toBe(queryValue),
      );
      expect(urlParams().get(urlKey)).toBe(urlValue);
      const remove = within(main()).getByRole("button", {
        name: `Retirer le filtre ${chipName}`,
      });
      expect(remove.parentElement?.textContent).toContain(item);
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );

  it("given the first request sent without filter, when Claude is chosen as Auteur, then no other parameter than actor is sent", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");

    await choose("Auteur", "Claude");

    await waitFor(() => expect(last(requests)?.get("actor")).toBe("claude"));
    expect([...(last(requests)?.keys() ?? [])]).toEqual(["actor"]);
    expect(requests[0] && [...requests[0].keys()]).toEqual([]);
  });

  it("given two filters chosen one after the other, when the request is read, then it carries both and the URL both", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await choose("Auteur", "Claude");
    await choose("Résultat", "Refusé");

    await waitFor(() => expect(last(requests)?.get("result")).toBe("refused"));
    expect(last(requests)?.get("actor")).toBe("claude");
    expect(urlParams().get("auteur")).toBe("claude");
    expect(urlParams().get("resultat")).toBe("refuse");
  });

  it("given a chosen filter, when its remove button is clicked, then the request and the URL lose it and the chip is a menu button again", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal?auteur=claude&origine=mcp");
    await loaded();

    fireEvent.click(
      within(main()).getByRole("button", { name: "Retirer le filtre Auteur" }),
    );

    await waitFor(() => expect(last(requests)?.has("actor")).toBe(false));
    expect(last(requests)?.get("origin")).toBe("mcp");
    expect(urlParams().has("auteur")).toBe(false);
    expect(urlParams().get("origine")).toBe("mcp");
    expect(chip("Auteur")).toBeDefined();
  });
});

describe("Journal, the search (decision 053 C, F)", () => {
  it("given the search box, when something is typed, then the request and the URL carry q as typed", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await loaded();

    fireEvent.change(within(main()).getByPlaceholderText("Chercher…"), {
      target: { value: "#42" },
    });

    await waitFor(() => expect(last(requests)?.get("q")).toBe("#42"));
    expect(urlParams().get("q")).toBe("#42");
  });

  it("given a search typed, when the box is emptied, then q leaves the request and the URL", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal?q=ticket");
    await loaded();

    fireEvent.change(within(main()).getByPlaceholderText("Chercher…"), {
      target: { value: "" },
    });

    await waitFor(() => expect(last(requests)?.has("q")).toBe(false));
    expect(urlParams().has("q")).toBe(false);
  });
});

describe("Journal, the period (decision 053 E)", () => {
  it.each([
    ["Aujourd'hui", "aujourdhui", new Date(2026, 10, 11)],
    ["Cette semaine", "semaine", new Date(2026, 10, 9)],
    ["Ce mois-ci", "mois", new Date(2026, 10, 1)],
  ])(
    "given Wednesday 11 November 15:30 local, when %s is chosen, then since is the local midnight %s of the period, in ISO, and the chip names the period",
    async (item, urlValue, start) => {
      pin();
      const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
      renderAt("/journal");

      await choose("Tout", item);

      await waitFor(() =>
        expect(last(requests)?.get("since")).toBe(start.toISOString()),
      );
      expect(urlParams().get("periode")).toBe(urlValue);
      expect(chip(item)).toBeDefined();
    },
  );

  it("given Sunday 8 November, when Cette semaine is chosen, then the week started on Monday 2 November (not on the Sunday)", async () => {
    pin(new Date(2026, 10, 8, 10, 0, 0));
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");

    await choose("Tout", "Cette semaine");

    await waitFor(() =>
      expect(last(requests)?.get("since")).toBe(
        new Date(2026, 10, 2).toISOString(),
      ),
    );
  });

  it("given a period chosen, when Tout is chosen, then since and periode leave the request and the URL", async () => {
    pin();
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal?periode=mois");
    await loaded();

    fireEvent.click(chip("Ce mois-ci"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Tout" }));

    await waitFor(() => expect(last(requests)?.has("since")).toBe(false));
    expect(urlParams().has("periode")).toBe(false);
  });
});

describe("Journal, the filters in the address (decision 053 F)", () => {
  it("given an address with every filter, when /journal loads, then the first request already carries them all and the chips, the box and the period show them", async () => {
    pin();
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));

    renderAt(
      "/journal?auteur=claude&resultat=refuse&projet=5&outil=ask_user&origine=mcp&periode=semaine&q=run",
    );

    await loaded();
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(Object.fromEntries(requests[0] ?? [])).toEqual({
      actor: "claude",
      result: "refused",
      project: "5",
      action: "ask_user",
      origin: "mcp",
      since: new Date(2026, 10, 9).toISOString(),
      q: "run",
    });
    const shown = (name: string) =>
      within(main()).getByRole("button", { name: `Retirer le filtre ${name}` })
        .parentElement?.textContent;
    expect(shown("Auteur")).toContain("Claude");
    expect(shown("Résultat")).toContain("Refusé");
    expect(shown("Projet")).toContain("hello");
    expect(shown("Outil")).toContain(ACTIONS.ask_user);
    expect(shown("Origine")).toContain("MCP");
    expect(chip("Cette semaine")).toBeDefined();
    expect(
      (within(main()).getByPlaceholderText("Chercher…") as HTMLInputElement)
        .value,
    ).toBe("run");
  });

  it("given filters in the address, when Effacer les filtres is clicked, then all of them leave the URL, the request and the search box, and the button goes away", async () => {
    pin();
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal?auteur=claude&resultat=refuse&periode=mois&q=run");
    await loaded();

    fireEvent.click(
      within(main()).getByRole("button", { name: "Effacer les filtres" }),
    );

    await waitFor(() =>
      expect([...(last(requests)?.keys() ?? [])]).toEqual([]),
    );
    expect(window.location.search).toBe("");
    expect(
      (within(main()).getByPlaceholderText("Chercher…") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(chip("Auteur")).toBeDefined();
    expect(chip("Tout")).toBeDefined();
    expect(
      within(main()).queryByRole("button", { name: "Effacer les filtres" }),
    ).toBeNull();
  });

  it("given only a period in the address, when /journal loads, then Effacer les filtres is offered", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));

    renderAt("/journal?periode=aujourdhui");

    await loaded();
    expect(
      within(main()).getByRole("button", { name: "Effacer les filtres" }),
    ).toBeDefined();
  });
});

describe("Journal, the days and the next page (decision 053 F)", () => {
  /** Entries of today (the pinned day), newest first, ids from `from` down. */
  const today = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      entry(from - i, {
        at: new Date(2026, 10, 11, 9, from - i).toISOString(),
        actor: "claude",
      }),
    );

  it("given 25 entries of today then 5 more, when Afficher plus is clicked with a filter, then the next request keeps the filters and adds before, and the day says 30 entrées", async () => {
    pin();
    const { requests } = stubJournal((params) =>
      params.has("before")
        ? { entries: today(5, 5), hasMore: false }
        : { entries: today(30, 25), hasMore: true },
    );
    renderAt("/journal?auteur=claude&resultat=reussi&periode=semaine");

    fireEvent.click(
      await screen.findByRole("button", { name: "Afficher plus" }),
    );

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(Object.fromEntries(requests[1] ?? [])).toEqual({
      actor: "claude",
      result: "ok",
      since: new Date(2026, 10, 9).toISOString(),
      before: "6",
    });
    const day = await screen.findByRole("region", { name: "Aujourd'hui" });
    await waitFor(() =>
      expect(day.textContent).toMatch(/Aujourd'hui\s*·\s*30 entrées/),
    );
  });

  it("given a filter, when the filter changes, then the pages already read are not kept (the request starts again without before)", async () => {
    pin();
    const { requests } = stubJournal((params) =>
      params.has("before")
        ? { entries: today(5, 5), hasMore: false }
        : { entries: today(30, 25), hasMore: true },
    );
    renderAt("/journal");
    fireEvent.click(
      await screen.findByRole("button", { name: "Afficher plus" }),
    );
    await waitFor(() => expect(requests).toHaveLength(2));

    await choose("Auteur", "Claude");

    await waitFor(() => expect(last(requests)?.get("actor")).toBe("claude"));
    expect(last(requests)?.has("before")).toBe(false);
  });

  it("given entries of today, when /journal loads, then the day reads Aujourd'hui · N entrées with N the entries shown", async () => {
    pin();
    stubJournal(() => ({ entries: today(7, 7) }));

    renderAt("/journal?auteur=claude");

    const day = await screen.findByRole("region", { name: "Aujourd'hui" });
    expect(day.textContent).toMatch(/Aujourd'hui\s*·\s*7 entrées/);
  });
});

describe("Journal, Exporter (decision 053 H)", () => {
  it("given no filter, when /journal loads, then Exporter links to /api/history/export without parameter", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));

    renderAt("/journal");

    const link = await within(await screen.findByRole("main")).findByRole(
      "link",
      { name: "Exporter" },
    );
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe("/api/history/export");
    expect([...url.searchParams.keys()]).toEqual([]);
  });

  it("given filters in the address, when /journal loads, then Exporter carries the same parameters as the journal request", async () => {
    pin();
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));

    renderAt("/journal?auteur=claude&resultat=refuse&periode=semaine&q=run");

    const link = await within(await screen.findByRole("main")).findByRole(
      "link",
      { name: "Exporter" },
    );
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe("/api/history/export");
    expect(Object.fromEntries(url.searchParams)).toEqual(
      Object.fromEntries(requests[0] ?? []),
    );
    expect(url.searchParams.get("result")).toBe("refused");
  });

  it("given a filter chosen after the load, when it is chosen, then Exporter follows it", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");

    await choose("Origine", "MCP");

    await waitFor(() => {
      const link = within(main()).getByRole("link", { name: "Exporter" });
      expect(
        new URL(
          link.getAttribute("href") ?? "",
          "http://localhost",
        ).searchParams.get("origin"),
      ).toBe("mcp");
    });
  });
});

describe("Journal, the search is calmer (decision 053 F, review)", () => {
  // Pinned: the request waits 300 ms after the last keystroke (real timers: nothing is sent 100 ms after typing, one request is sent a little after 300 ms);
  // while the new results load, the previous list and an open panel stay (no « Chargement… » in place of the list).
  it("given three characters typed quickly, when 100 ms pass then the pause ends, then no request was sent at first and exactly one is sent, with the whole text", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await loaded();
    await waitFor(() => expect(requests).toHaveLength(1));
    const box = within(main()).getByPlaceholderText("Chercher…");

    for (const value of ["t", "ti", "tic"])
      fireEvent.change(box, { target: { value } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toHaveLength(1);

    await waitFor(() => expect(last(requests)?.get("q")).toBe("tic"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requests.filter((r) => r.has("q"))).toHaveLength(1);
  });

  it("given a panel open and a search typed, when the new results are still loading, then the previous rows and the panel stay and Chargement… is not shown", async () => {
    let release: (answer: { entries: ReturnType<typeof entry>[] }) => void =
      () => {};
    const slow = new Promise<{ entries: ReturnType<typeof entry>[] }>(
      (resolve) => {
        release = resolve;
      },
    );
    const { requests } = stubJournal((params) =>
      params.has("q") ? slow : { entries: [entry(1, { action: "login" })] },
    );
    renderAt("/journal");
    fireEvent.click(
      within(
        (await screen.findByText("Connexion")).closest("li") as HTMLElement,
      ).getByRole("button"),
    );

    fireEvent.change(within(main()).getByPlaceholderText("Chercher…"), {
      target: { value: "ticket" },
    });
    await waitFor(() => expect(last(requests)?.get("q")).toBe("ticket"));

    expect(screen.getByText("Connexion")).toBeDefined();
    expect(screen.queryByText("Chargement…")).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Entrée du journal" }),
    ).toBeDefined();
    release({ entries: [entry(2, { action: "create_ticket" })] });
    expect(await screen.findByText("Ticket créé")).toBeDefined();
  });
});

describe("Journal, the chip menus with the keyboard (decision 053 F, review)", () => {
  // Pinned: opening a menu focuses its first item; ArrowDown / ArrowUp move the focus between items (no wrap needed);
  // Escape closes the menu and focuses its chip; choosing returns the focus to the chip (for a filter chip that is now its « Retirer le filtre <chip> » button);
  // the keys of an open menu never reach the panel's ArrowUp / ArrowDown.
  const items = () => screen.getAllByRole("menuitem");

  it("given a chip, when its menu opens, then the first item has the focus and ArrowDown then ArrowUp move between items", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await loaded();

    fireEvent.click(chip("Auteur"));

    await waitFor(() => expect(document.activeElement).toBe(items()[0]));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[0]);
  });

  it("given an open menu, when Escape is pressed, then it closes and the chip has the focus", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await loaded();
    fireEvent.click(chip("Auteur"));
    await waitFor(() => expect(document.activeElement).toBe(items()[0]));

    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chip("Auteur"));
  });

  it("given an open menu, when an item is chosen, then the focus goes back to the chip (the period chip stays, a filter chip gives its remove button)", async () => {
    stubJournal(() => ({ entries: [entry(1)] }));
    renderAt("/journal");
    await choose("Auteur", "Claude");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(main()).getByRole("button", {
          name: "Retirer le filtre Auteur",
        }),
      ),
    );

    fireEvent.click(chip("Tout"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Ce mois-ci" }),
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(chip("Ce mois-ci")),
    );
  });

  it("given an entry open in the panel and a menu open, when ArrowDown is pressed in the menu, then the focus moves in the menu and the panel stays on the same entry", async () => {
    stubJournal(() => ({
      entries: [entry(3), entry(2), entry(1)],
    }));
    renderAt("/journal");
    await loaded();
    fireEvent.click(
      within(
        (await screen.findAllByRole("listitem"))[0] as HTMLElement,
      ).getByRole("button", { name: /Connexion/ }),
    );
    const counter = () =>
      within(
        screen.getByRole("complementary", { name: "Entrée du journal" }),
      ).getByText(/^\d+ sur \d+$/).textContent;
    expect(counter()).toBe("1 sur 3");
    fireEvent.click(chip("Auteur"));
    await waitFor(() => expect(document.activeElement).toBe(items()[0]));

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });

    expect(document.activeElement).toBe(items()[1]);
    expect(counter()).toBe("1 sur 3");
  });
});

describe("Journal, two projects with the same repo name (decision 053 F, review)", () => {
  // Pinned: when two repo names collide the Projet menu (and the chosen chip) shows the full owner/name of both; otherwise the repo name alone.
  const twins = [
    { id: 7, fullName: "alice/app" },
    { id: 8, fullName: "bob/app" },
  ];

  it("given alice/app and bob/app, when the Projet menu opens, then both show their owner and neither is the bare « app »", async () => {
    stubJournal(() => ({ entries: [entry(1)] }), twins);
    renderAt("/journal");
    await loaded();

    fireEvent.click(chip("Projet"));

    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent?.trim()),
    ).toEqual(["alice/app", "bob/app"]);
  });

  it("given alice/app and bob/app, when bob/app is chosen, then project 8 is requested and the chip reads bob/app", async () => {
    const { requests } = stubJournal(() => ({ entries: [entry(1)] }), twins);
    renderAt("/journal");

    await choose("Projet", "bob/app");

    await waitFor(() => expect(last(requests)?.get("project")).toBe("8"));
    expect(
      within(main()).getByRole("button", { name: "Retirer le filtre Projet" })
        .parentElement?.textContent,
    ).toContain("bob/app");
  });
});
