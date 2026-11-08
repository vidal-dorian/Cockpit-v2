// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story } from "./test-tickets.tsx";
import { ago, rich, stubTab } from "./test-tickets-full.tsx";

// Slice 11.2, decision 055 E and F (S14): the Tickets tab.
//
// Pinned choices (the decision leaves them open):
// - No form to create a ticket (no « Nouveau ticket », no « Titre » field, no « Créer »). The link « Importer les issues » arrived with slice 11.3 (IssueImport.test.tsx).
// - The state sentence is the <h1> « N tickets, M attendent leurs user stories. » (M = tickets at step new). The routine sentence under it,
//   « Claude les écrira à 7 h, ou maintenant si tu veux. », only when the project's routine is scheduled daily at 7; with the schedule off there is no second sentence at all.
// - A row of the list is an <li> with one <button> named exactly the title (it opens the panel, see TicketsPanel.test.tsx); next to it, outside the button:
//   the step label then its detail, the tags as words (no « # »), « priorité haute » for a high ticket and nothing for a normal one, and the age (« 10 min », « 2 j », « 2 sem. ») of createdAt.
//   The detail of a ticket with stories reads « <N> US · <n> à valider, <n> prêtes, <n> en cours » (the stories of GET /api/projects/:id/stories, in the order to_validate, ready, in_progress).
// - Clicking the pressed « Ouverts » chip again releases it: every ticket is listed, done and abandoned ones too (the only way to reach them).
// - The chips are two <button aria-pressed>: « Ouverts · N » (step neither done nor abandoned; pressed by default) and « Nouveaux · N » (step new); the counts ignore the tag filter and the search.
// - « Étiquette » is a <select>: a first option « Étiquette » (value "", all), then the distinct tags of the project sorted alphabetically (done tickets included). It narrows the list together with the chip (AND).
// - The search is a textbox « Chercher dans les tickets et les US », always visible. A non-blank value is sent to GET /api/projects/:id/search?q= (not trimmed away, no request for a blank one);
//   while it is non-blank the list is replaced by the results: the tickets (buttons named by their title), then the US as links « US <id> · <title> » to /us/:id. Emptying it brings the list back.
// - « Écrire les US maintenant » is a button, present only when GET /api/me/routine says connected; it POSTs /api/projects/:id/routine/run (022).
// - Colour (J): no destructive, red, rose or `you` class on the page.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const T1 = rich(11, "Exporter en CSV", {
  tags: ["export"],
  createdAt: ago.minutes(10),
});
const T2 = rich(12, "Connexion sans mot de passe", {
  step: "in_progress",
  tags: ["auth"],
  createdAt: ago.days(2),
});
const T3 = rich(13, "Tableau de bord des retards", {
  priority: "high",
  createdAt: ago.days(4),
});
const T4 = rich(14, "Thème sombre", {
  step: "done",
  tags: ["ui", "export"],
  createdAt: ago.days(14),
});
const TICKETS = [T1, T2, T3, T4];
const STORIES = [
  story(42, 12, "Lien par e-mail", { status: "to_validate" }),
  story(43, 12, "Lien expiré", { status: "ready", position: 2 }),
  story(44, 12, "Se souvenir", { status: "ready", position: 3 }),
  story(45, 12, "Renvoyer un lien", { status: "in_progress", position: 4 }),
];

const tab = () => screen.findByRole("heading", { level: 1 });
const rowButton = (title: string) =>
  screen.findByRole("button", { name: title });
const rowOf = async (title: string) =>
  (await rowButton(title)).closest("li") as HTMLElement;
const titles = () =>
  [...screen.getByRole("main").querySelectorAll("li")]
    .map((li) => li.querySelector("button")?.textContent)
    .filter(Boolean);
/** The title is on the page, whatever the markup around it (a link before 055, a button after). */
const listed = (title: string) => screen.findByText(title);
const chip = (name: string) => screen.findByRole("button", { name });

describe("055 E: no creation form on the tab", () => {
  it("given the Tickets tab, when it loads, then it has no Nouveau ticket form and no Créer button", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    await listed("Exporter en CSV");

    expect(screen.queryByText("Nouveau ticket")).toBeNull();
    expect(screen.queryByLabelText("Titre")).toBeNull();
    expect(screen.queryByRole("button", { name: "Créer" })).toBeNull();
  });
});

describe("055 F: the sentences", () => {
  it("given 4 tickets of which 2 are new, when the tab loads, then the sentence reads « 4 tickets, 2 attendent leurs user stories. »", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    await listed("Exporter en CSV");

    expect((await tab()).textContent).toContain(
      "4 tickets, 2 attendent leurs user stories.",
    );
  });

  it("given the routine is scheduled every day at 7, when the tab loads, then the second sentence says Claude les écrira à 7 h", async () => {
    stubTab(TICKETS, STORIES, { schedule: { frequency: "daily", hour: 7 } });
    renderAt("/projets/5/tickets");

    await listed("Exporter en CSV");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "Claude les écrira à 7 h, ou maintenant si tu veux.",
      ),
    );
  });

  it("given the routine is not scheduled, when the tab loads, then there is no second sentence", async () => {
    stubTab(TICKETS, STORIES, { schedule: { frequency: "off", hour: null } });
    renderAt("/projets/5/tickets");

    await listed("Exporter en CSV");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "4 tickets",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const heading = (await tab()).textContent ?? "";
    expect(heading).toContain("4 tickets, 2 attendent leurs user stories.");
    expect(heading).not.toContain("Claude les écrira");
    expect(heading).not.toContain("Claude écrit les user stories");
  });
});

describe("055 F: the row of a ticket", () => {
  it("given a ticket with tags, when the tab loads, then its row shows the title, the step, the tag as a word and the age 10 min", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    const row = within(await rowOf("Exporter en CSV"));

    expect(row.getByText("Nouveau")).toBeDefined();
    expect(row.getByText("export")).toBeDefined();
    expect(row.getByText("10 min")).toBeDefined();
    expect(row.queryByText(/priorité/)).toBeNull();
  });

  it("given a high ticket, when the tab loads, then its row says « priorité haute »", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    const row = within(await rowOf("Tableau de bord des retards"));

    expect(row.getByText("priorité haute")).toBeDefined();
    expect(row.getByText("4 j")).toBeDefined();
  });

  it("given the pressed Ouverts chip, when it is clicked again, then it is released and every ticket is listed, a done one with its step Terminé and its age 2 sem.", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    await listed("Exporter en CSV");

    fireEvent.click(await chip("Ouverts · 3"));

    const row = within(await rowOf("Thème sombre"));
    expect((await chip("Ouverts · 3")).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(row.getByText("Terminé")).toBeDefined();
    expect(row.getByText("2 sem.")).toBeDefined();
    expect(titles()).toHaveLength(4);
  });

  it("given a ticket with 4 stories, when the tab loads, then its detail reads « 4 US · 1 à valider, 2 prêtes, 1 en cours »", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    const row = await rowOf("Connexion sans mot de passe");

    expect(within(row).getByText("En cours")).toBeDefined();
    expect(row.textContent).toContain(
      "4 US · 1 à valider, 2 prêtes, 1 en cours",
    );
  });
});

describe("055 F: the chips and the tag menu", () => {
  it("given 4 tickets, when the tab loads, then Ouverts · 3 is pressed and lists the three that are not done, and Nouveaux · 2 is not pressed", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    const open = await chip("Ouverts · 3");
    const fresh = await chip("Nouveaux · 2");

    expect(open.getAttribute("aria-pressed")).toBe("true");
    expect(fresh.getAttribute("aria-pressed")).toBe("false");
    expect(titles()).toEqual([
      "Exporter en CSV",
      "Connexion sans mot de passe",
      "Tableau de bord des retards",
    ]);
  });

  it("given the tab, when Nouveaux · 2 is clicked, then only the tickets at step Nouveau stay and the chip is pressed", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    await rowButton("Exporter en CSV");

    fireEvent.click(await chip("Nouveaux · 2"));

    expect(titles()).toEqual([
      "Exporter en CSV",
      "Tableau de bord des retards",
    ]);
    expect((await chip("Nouveaux · 2")).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect((await chip("Ouverts · 3")).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("given the tags of the project, when the Étiquette menu is read, then it offers Étiquette (all) and each tag once, sorted", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");

    const menu = (await screen.findByRole("combobox", {
      name: "Étiquette",
    })) as HTMLSelectElement;

    expect([...menu.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "Étiquette"],
      ["auth", "auth"],
      ["export", "export"],
      ["ui", "ui"],
    ]);
  });

  it("given the Étiquette menu, when auth is chosen, then only the tickets with that tag stay, and choosing Étiquette brings them all back", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    const menu = await screen.findByRole("combobox", { name: "Étiquette" });

    fireEvent.change(menu, { target: { value: "auth" } });
    expect(titles()).toEqual(["Connexion sans mot de passe"]);

    fireEvent.change(menu, { target: { value: "" } });
    expect(titles()).toHaveLength(3);
  });

  it("given a tag and a chip, when both are set, then the list holds what satisfies both", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    const menu = await screen.findByRole("combobox", { name: "Étiquette" });

    fireEvent.change(menu, { target: { value: "export" } });
    fireEvent.click(await chip("Nouveaux · 2"));

    expect(titles()).toEqual(["Exporter en CSV"]);
  });
});

describe("055 F: the search", () => {
  const SEARCH = {
    tickets: [{ id: 11, title: "Exporter en CSV", step: "new" }],
    stories: [
      { id: 42, ticketId: 12, title: "Lien par e-mail", status: "to_validate" },
    ],
  };

  it("given a word typed in the search field, when the results come, then the list is replaced by the tickets then the US, and a US links to /us/:id", async () => {
    const api = stubTab(TICKETS, STORIES, { search: () => SEARCH });
    renderAt("/projets/5/tickets");
    await rowButton("Connexion sans mot de passe");

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Chercher dans les tickets et les US",
      }),
      { target: { value: "lien" } },
    );

    const us = await screen.findByRole("link", { name: /Lien par e-mail/ });
    expect(us.getAttribute("href")).toBe("/us/42");
    const ticketResult = await rowButton("Exporter en CSV");
    expect(
      ticketResult.compareDocumentPosition(us) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Connexion sans mot de passe" }),
    ).toBeNull();
    expect(api.searches).toContain("lien");
  });

  it("given results shown, when the field is emptied, then the list is back", async () => {
    stubTab(TICKETS, STORIES, { search: () => SEARCH });
    renderAt("/projets/5/tickets");
    await rowButton("Connexion sans mot de passe");
    const field = screen.getByRole("textbox", {
      name: "Chercher dans les tickets et les US",
    });
    fireEvent.change(field, { target: { value: "lien" } });
    await screen.findByRole("link", { name: /Lien par e-mail/ });

    fireEvent.change(field, { target: { value: "" } });

    await rowButton("Connexion sans mot de passe");
    expect(screen.queryByRole("link", { name: /Lien par e-mail/ })).toBeNull();
  });

  it("given a blank value, when it is typed in the search field, then no search is sent", async () => {
    const api = stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    await rowButton("Exporter en CSV");

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Chercher dans les tickets et les US",
      }),
      { target: { value: "   " } },
    );
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(api.searches).toEqual([]);
    expect(titles()).toHaveLength(3);
  });

  it("given a search with no result, when it answers, then the page says so and shows no ticket row", async () => {
    stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    await rowButton("Exporter en CSV");

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Chercher dans les tickets et les US",
      }),
      { target: { value: "introuvable" } },
    );

    await screen.findByText(/Aucun résultat/);
    expect(titles()).toEqual([]);
  });
});

describe("055 F: Écrire les US maintenant", () => {
  it("given a routine exists, when the tab loads, then the button is there and a click fires the run of this project", async () => {
    const api = stubTab(TICKETS, STORIES, { routineConnected: true });
    renderAt("/projets/5/tickets");

    fireEvent.click(
      await screen.findByRole("button", { name: "Écrire les US maintenant" }),
    );

    await waitFor(() => expect(api.runs).toEqual(["5"]));
  });

  it("given no routine, when the tab loads, then there is no such button", async () => {
    stubTab(TICKETS, STORIES, { routineConnected: false });
    renderAt("/projets/5/tickets");

    // The row of S14 is there (it has the menu), the button is the only thing missing.
    await screen.findByRole("combobox", { name: "Étiquette" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(
      screen.queryByRole("button", { name: "Écrire les US maintenant" }),
    ).toBeNull();
  });
});

describe("055 J: the colour of the tab", () => {
  it("given a high ticket with tags, when the tab loads, then nothing on the page is red or destructive", async () => {
    stubTab(TICKETS, STORIES, { routineConnected: true });
    renderAt("/projets/5/tickets");
    const row = await rowOf("Tableau de bord des retards");
    await rowOf("Exporter en CSV");

    const { redClasses } = await import("./test-journal.tsx");
    expect(within(row).getByText("priorité haute")).toBeDefined();
    expect(redClasses(screen.getByRole("main"))).toEqual([]);
  });
});

// Review of slice 11.2. Pinned:
// - The search request waits 300 ms after the last keystroke (real timers: nothing 100 ms after typing, one request a little after), and `q` is the trimmed text (« lien » for « lien␠ »).
// - While the new results load, the previous results stay and « Chargement… » is not shown in their place.
// - The detail counts stories in review: « 3 US · 3 en revue ».
// - After « Écrire les US maintenant » succeeds, the tab shows the link « Voir la session » to the session URL the run route answers (the wording of ProjectRoutine).

const searchBox = () =>
  screen.getByRole("textbox", { name: "Chercher dans les tickets et les US" });

describe("review 1: the search is calm", () => {
  it("given three characters typed quickly, when 100 ms pass then the pause ends, then nothing was sent at first and exactly one request is sent", async () => {
    const api = stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    await rowButton("Exporter en CSV");

    for (const value of ["l", "li", "lie"])
      fireEvent.change(searchBox(), { target: { value } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.searches).toEqual([]);

    await waitFor(() => expect(api.searches).toEqual(["lie"]));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.searches).toEqual(["lie"]);
  });

  it("given a text with a trailing space, when the search is sent, then q is trimmed", async () => {
    const api = stubTab(TICKETS, STORIES);
    renderAt("/projets/5/tickets");
    await rowButton("Exporter en CSV");

    fireEvent.change(searchBox(), { target: { value: " lien " } });

    await waitFor(() => expect(api.searches).toEqual(["lien"]));
  });

  it("given results shown, when a new search is still loading, then the previous results stay and Chargement… is not shown", async () => {
    let release: (a: { tickets: never[]; stories: never[] }) => void = () => {};
    const slow = new Promise<{ tickets: never[]; stories: never[] }>(
      (resolve) => {
        release = resolve;
      },
    );
    const api = stubTab(TICKETS, STORIES, {
      search: (q) =>
        q === "lien"
          ? {
              tickets: [],
              stories: [
                {
                  id: 42,
                  ticketId: 12,
                  title: "Lien par e-mail",
                  status: "to_validate",
                },
              ],
            }
          : slow,
    });
    renderAt("/projets/5/tickets");
    await rowButton("Exporter en CSV");
    fireEvent.change(searchBox(), { target: { value: "lien" } });
    await screen.findByRole("link", { name: /Lien par e-mail/ });

    fireEvent.change(searchBox(), { target: { value: "lien exp" } });
    await waitFor(() => expect(api.searches).toEqual(["lien", "lien exp"]));

    expect(screen.getByRole("link", { name: /Lien par e-mail/ })).toBeDefined();
    expect(screen.queryByText(/Chargement/)).toBeNull();
    release({ tickets: [], stories: [] });
  });
});

describe("review 7: details of the tab", () => {
  it("given a ticket whose three stories are in review, when the tab loads, then its detail reads « 3 US · 3 en revue »", async () => {
    stubTab(
      [rich(12, "En revue")],
      [1, 2, 3].map((n) =>
        story(60 + n, 12, `US ${n}`, { status: "in_review", position: n }),
      ),
    );
    renderAt("/projets/5/tickets");

    const row = await rowOf("En revue");

    expect(row.textContent).toContain("3 US · 3 en revue");
  });

  it("given a routine, when Écrire les US maintenant succeeds, then the tab links to the session", async () => {
    stubTab(TICKETS, STORIES, { routineConnected: true });
    renderAt("/projets/5/tickets");

    fireEvent.click(
      await screen.findByRole("button", { name: "Écrire les US maintenant" }),
    );

    const link = await screen.findByRole("link", { name: "Voir la session" });
    expect(link.getAttribute("href")).toBe(
      "https://claude.ai/code/session_NEW",
    );
  });
});
