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
import {
  entry,
  type FakeEntry,
  NOW,
  redClasses,
  stubJournal,
} from "./test-journal.tsx";

// Decision 053 I and J (slice 11.1): the tab « Historique » of a project (S16).
//
// Pinned choices (the decision leaves them open):
// - The tab is a link « Historique » of <nav aria-label="Sections du projet">, between « Agents » and « Réglages », to /projets/:id/historique (aria-current="page" when open).
// - The state sentence (h1) is « Ce qui s'est passé sur <repo name without the owner>. », e.g. « Ce qui s'est passé sur hello. ».
// - The chips are buttons with aria-pressed, one at a time, « Tout » pressed at first: Toi (actor=human), Claude (actor=claude), GitHub (actor=github), Refus et erreurs (result=refused,error), none for Tout.
//   They replace each other (Claude then Refus et erreurs sends result=refused,error and no actor). The period is the one menu button of the tab (aria-haspopup="menu", named after the period, « Tout » at first)
//   with the items Aujourd'hui, Cette semaine, Ce mois-ci, Tout and the same `since` as the Journal page. These choices are not kept in the address.
// - Every GET /api/history of the tab carries project=<id of the project> and never q. There is no search box, no Auteur / Résultat / Projet / Outil / Origine chips.
// - A row is an <li> with one <button> (opens the panel of decision 053 G, see JournalPanel.test.tsx), a sentence in French and, as a separate element on the right, the author word:
//   toi (actor human), Claude, GitHub, Cockpit (system). The sentence of a run step (action report_step, args { agent, event: "finished" }) by Claude is « Claude a fini l'étape <agent> »;
//   the raw action name is not shown in the row. The other sentences are left to the developer. The time of the row is a <time>.
// - « Exporter » is a link to /api/history/export with the parameters of the tab's request (without before), so at least project=<id>.
// - « Afficher plus » (decision 028 F) continues with the same parameters and before (the decision says the tab is the journal filtered on the project).

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
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

const main = () => screen.getByRole("main");
const last = (requests: URLSearchParams[]) => requests[requests.length - 1];
const sentence = () => screen.findByRole("heading", { level: 1 });
const rows = () => [...main().querySelectorAll("li")] as HTMLElement[];
const author = (row: HTMLElement) =>
  [...row.querySelectorAll("*")].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() !== "",
  );
const pressed = (name: string) =>
  within(main()).getByRole("button", { name, pressed: true });
const chip = (name: string) =>
  within(main()).getByRole("button", { name, pressed: false });

const STEP = entry(4, {
  actor: "claude",
  origin: "mcp",
  action: "report_step",
  project: "octocat/hello",
  projectId: 5,
  runId: 17,
  args: { run_id: 17, agent: "reviewer", event: "finished" },
});

describe("Project history, the tab (decision 053 I)", () => {
  it("given a project, when /projets/5 opens, then Historique is the sixth link of the tabs, between Agents and Réglages, to /projets/5/historique", async () => {
    stubJournal();
    renderAt("/projets/5");

    const nav = await screen.findByRole("navigation", {
      name: "Sections du projet",
    });

    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      "Kanban",
      "Tickets",
      "Conception",
      "Santé",
      "Agents",
      "Historique",
      "Réglages",
    ]);
    expect(links[5]?.getAttribute("href")).toBe("/projets/5/historique");
  });

  it("given /projets/5/historique, when it loads, then the tab is open (aria-current) and the sentence reads « Ce qui s'est passé sur hello. »", async () => {
    stubJournal(() => ({ entries: [STEP] }));

    renderAt("/projets/5/historique");

    expect((await sentence()).textContent).toContain(
      "Ce qui s'est passé sur hello.",
    );
    const tab = within(
      await screen.findByRole("navigation", { name: "Sections du projet" }),
    ).getByRole("link", { name: "Historique" });
    expect(tab.getAttribute("aria-current")).toBe("page");
  });

  it("given another project, when /projets/6/historique loads, then the sentence names it and the request is for project 6", async () => {
    const { requests } = stubJournal(() => ({ entries: [] }));

    renderAt("/projets/6/historique");

    expect((await sentence()).textContent).toContain(
      "Ce qui s'est passé sur api-facturation.",
    );
    await waitFor(() => expect(requests[0]?.get("project")).toBe("6"));
  });

  it("given the tab, when it loads, then the chips Tout, Toi, Claude, GitHub and Refus et erreurs are there with Tout pressed, and no search box nor journal chip", async () => {
    stubJournal(() => ({ entries: [STEP] }));

    renderAt("/projets/5/historique");

    await sentence();
    await screen.findByRole("button", { name: "Refus et erreurs" });
    expect(pressed("Tout")).toBeDefined();
    for (const name of ["Toi", "Claude", "GitHub", "Refus et erreurs"])
      expect(chip(name), name).toBeDefined();
    expect(within(main()).queryByPlaceholderText("Chercher…")).toBeNull();
    for (const name of ["Auteur", "Résultat", "Projet", "Outil", "Origine"])
      expect(within(main()).queryByRole("button", { name })).toBeNull();
  });

  it("given the tab, when it loads, then the first request is for the project alone, without q or any other filter", async () => {
    const { requests } = stubJournal(() => ({ entries: [STEP] }));

    renderAt("/projets/5/historique");

    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(Object.fromEntries(requests[0] ?? [])).toEqual({ project: "5" });
  });
});

describe("Project history, the chips (decision 053 I)", () => {
  it.each([
    ["Toi", { actor: "human" }],
    ["Claude", { actor: "claude" }],
    ["GitHub", { actor: "github" }],
    ["Refus et erreurs", { result: "refused,error" }],
  ])(
    "given the tab, when %s is clicked, then it is pressed and the request is for the project with %j",
    async (name, expected) => {
      const { requests } = stubJournal(() => ({ entries: [STEP] }));
      renderAt("/projets/5/historique");
      await screen.findByRole("button", { name: "Refus et erreurs" });

      fireEvent.click(chip(name));

      await waitFor(() =>
        expect(Object.fromEntries(last(requests) ?? [])).toEqual({
          project: "5",
          ...expected,
        }),
      );
      expect(pressed(name)).toBeDefined();
    },
  );

  it("given Claude chosen, when Refus et erreurs is clicked, then it replaces Claude (result only), and Tout brings back the plain request", async () => {
    const { requests } = stubJournal(() => ({ entries: [STEP] }));
    renderAt("/projets/5/historique");
    await screen.findByRole("button", { name: "Refus et erreurs" });
    fireEvent.click(chip("Claude"));

    fireEvent.click(chip("Refus et erreurs"));
    await waitFor(() =>
      expect(Object.fromEntries(last(requests) ?? [])).toEqual({
        project: "5",
        result: "refused,error",
      }),
    );
    expect(chip("Claude")).toBeDefined();

    fireEvent.click(chip("Tout"));
    await waitFor(() =>
      expect(Object.fromEntries(last(requests) ?? [])).toEqual({
        project: "5",
      }),
    );
  });

  it.each([
    ["Aujourd'hui", new Date(2026, 10, 11)],
    ["Cette semaine", new Date(2026, 10, 9)],
    ["Ce mois-ci", new Date(2026, 10, 1)],
  ])(
    "given Wednesday 11 November 15:30 local, when the period %s is chosen, then since is the local start of it and the request keeps project 5 and the chip",
    async (item, start) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const { requests } = stubJournal(() => ({ entries: [STEP] }));
      renderAt("/projets/5/historique");
      await screen.findByRole("button", { name: "Refus et erreurs" });
      fireEvent.click(chip("Claude"));

      const period = main().querySelector('button[aria-haspopup="menu"]');
      expect(period?.textContent).toMatch(/^Tout/);
      fireEvent.click(period as Element);
      const menu = await screen.findByRole("menu");
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.textContent?.trim()),
      ).toEqual(["Aujourd'hui", "Cette semaine", "Ce mois-ci", "Tout"]);
      fireEvent.click(within(menu).getByRole("menuitem", { name: item }));

      await waitFor(() =>
        expect(Object.fromEntries(last(requests) ?? [])).toEqual({
          project: "5",
          actor: "claude",
          since: start.toISOString(),
        }),
      );
      expect(
        main().querySelector('button[aria-haspopup="menu"]')?.textContent,
      ).toContain(item);
    },
  );
});

describe("Project history, the rows (decision 053 I)", () => {
  it("given a step finished by Claude, when the tab loads, then the row is the sentence « Claude a fini l'étape reviewer » with the author word Claude apart, and no raw action name", async () => {
    stubJournal(() => ({ entries: [STEP] }));

    renderAt("/projets/5/historique");

    const sentenceEl = await screen.findByText(
      "Claude a fini l'étape reviewer",
    );
    const row = sentenceEl.closest("li") as HTMLElement;
    expect(row.textContent).not.toContain("report_step");
    const words = author(row).map((el) => el.textContent?.trim());
    expect(words).toContain("Claude");
    expect(sentenceEl.textContent).not.toBe("Claude");
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe(STEP.at);
  });

  it.each([
    ["human", "toi"],
    ["claude", "Claude"],
    ["github", "GitHub"],
    ["system", "Cockpit"],
  ])(
    "given an entry of the actor %s, when the tab loads, then its row ends with the author word %s",
    async (actor, word) => {
      stubJournal(() => ({
        entries: [
          entry(1, {
            actor,
            action: "login",
            project: "octocat/hello",
            projectId: 5,
          }),
        ],
      }));

      renderAt("/projets/5/historique");

      await sentence();
      await waitFor(() => expect(rows()).toHaveLength(1));
      const words = author(rows()[0] as HTMLElement).map((el) =>
        el.textContent?.trim(),
      );
      expect(words).toContain(word);
      expect(rows()[0]?.textContent).not.toContain("login");
    },
  );

  it("given 25 entries and more, when Afficher plus is clicked on a filtered tab, then the next request keeps project, filter and adds before", async () => {
    const page = (from: number, count: number): FakeEntry[] =>
      Array.from({ length: count }, (_, i) =>
        entry(from - i, { actor: "claude", projectId: 5 }),
      );
    const { requests } = stubJournal((params) =>
      params.has("before")
        ? { entries: page(5, 5), hasMore: false }
        : { entries: page(30, 25), hasMore: true },
    );
    renderAt("/projets/5/historique");
    await screen.findByRole("button", { name: "Refus et erreurs" });
    fireEvent.click(chip("Claude"));

    fireEvent.click(
      await screen.findByRole("button", { name: "Afficher plus" }),
    );

    await waitFor(() => expect(last(requests)?.get("before")).toBe("6"));
    expect(Object.fromEntries(last(requests) ?? [])).toEqual({
      project: "5",
      actor: "claude",
      before: "6",
    });
  });
});

describe("Project history, Exporter and the panel (decision 053 I, G)", () => {
  it("given the tab, when it loads, then Exporter links to the CSV of the project", async () => {
    stubJournal(() => ({ entries: [STEP] }));

    renderAt("/projets/5/historique");

    const link = await within(await screen.findByRole("main")).findByRole(
      "link",
      { name: "Exporter" },
    );
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe("/api/history/export");
    expect(Object.fromEntries(url.searchParams)).toEqual({ project: "5" });
  });

  it("given a chip chosen, when Exporter is read, then it carries the project and the chip's filter", async () => {
    stubJournal(() => ({ entries: [STEP] }));
    renderAt("/projets/5/historique");
    await screen.findByRole("button", { name: "Refus et erreurs" });

    fireEvent.click(chip("Refus et erreurs"));

    await waitFor(() => {
      const link = within(main()).getByRole("link", { name: "Exporter" });
      const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        project: "5",
        result: "refused,error",
      });
    });
  });

  it("given a row, when it is clicked, then the panel of the entry opens with its title and fields", async () => {
    stubJournal(() => ({ entries: [STEP] }));
    renderAt("/projets/5/historique");
    const row = (
      await screen.findByText("Claude a fini l'étape reviewer")
    ).closest("li") as HTMLElement;

    fireEvent.click(within(row).getByRole("button"));

    const panel = screen.getByRole("complementary", {
      name: "Entrée du journal",
    });
    expect(
      within(panel).getByRole("heading", { level: 2 }).textContent?.trim(),
    ).toBe("report_step réussi");
    expect(panel.textContent).toContain("octocat/hello");
    expect(within(panel).getByText(/^1 sur 1$/)).toBeDefined();
  });
});

describe("Project history, review findings (decision 053 I, G)", () => {
  it("given a step finished by the user, when the tab loads, then the row reads « Tu as fini l'étape reviewer » (not « Tu a »)", async () => {
    stubJournal(() => ({
      entries: [{ ...STEP, actor: "human", origin: "ui" }],
    }));

    renderAt("/projets/5/historique");

    expect(
      await screen.findByText("Tu as fini l'étape reviewer"),
    ).toBeDefined();
  });

  // Same pin as in JournalPanel.test.tsx: the retry is shown from `retry` even when the chip « Refus et erreurs » hides it.
  it("given Refus et erreurs chosen and a refusal whose retry is not listed, when its retry sentence is clicked, then the panel shows the retry (title create_user_stories réussi)", async () => {
    const refused = entry(3, {
      actor: "claude",
      origin: "mcp",
      action: "create_user_stories",
      result: "refused",
      project: "octocat/hello",
      projectId: 5,
      detail: { reason: "criterion_incomplete" },
      retry: { id: 4, at: STEP.at, result: "ok" },
    });
    stubJournal((params) => ({
      entries: params.get("result") ? [refused] : [],
    }));
    renderAt("/projets/5/historique");
    await screen.findByRole("button", { name: "Refus et erreurs" });
    fireEvent.click(chip("Refus et erreurs"));
    const row = await waitFor(() => {
      const li = rows()[0];
      expect(li).toBeDefined();
      return li as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button"));
    const panel = screen.getByRole("complementary", {
      name: "Entrée du journal",
    });
    const time = new Date(STEP.at).toLocaleTimeString("fr-FR", {
      hour: "numeric",
      minute: "2-digit",
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: `Claude a réessayé à ${time} : réussi.`,
      }),
    );

    expect(
      within(panel).getByRole("heading", { level: 2 }).textContent?.trim(),
    ).toBe("create_user_stories réussi");
  });
});

describe("Project history, the colour (decision 053 J)", () => {
  it("given refused entries, when the tab shows them on Refus et erreurs with the panel open, then nothing is red", async () => {
    stubJournal(() => ({
      entries: [
        entry(2, {
          actor: "claude",
          action: "create_user_stories",
          result: "refused",
          detail: { reason: "criterion_incomplete" },
          project: "octocat/hello",
          projectId: 5,
        }),
      ],
    }));
    renderAt("/projets/5/historique");
    await screen.findByRole("button", { name: "Refus et erreurs" });
    fireEvent.click(chip("Refus et erreurs"));

    const row = await waitFor(() => {
      const li = rows()[0];
      expect(li).toBeDefined();
      return li as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button"));

    expect(redClasses(main())).toEqual([]);
    expect(
      redClasses(
        screen.getByRole("complementary", { name: "Entrée du journal" }),
      ),
    ).toEqual([]);
  });
});
