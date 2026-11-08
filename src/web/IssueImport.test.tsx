// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issue, stubImport } from "./test-issue-import.tsx";
import { renderAt } from "./test-tickets.tsx";
import { rich } from "./test-tickets-full.tsx";

// Slice 11.3, decision 056 F (S27): the import screen, at /projets/:id/tickets/importer.
//
// Pinned choices (the decision and the screen leave them open):
// - The link « Importer les issues » of the Tickets tab (a link, href /projets/5/tickets/importer) opens it; the breadcrumb is Projets (/projets) › the repo name without its owner (/projets/5) › Tickets (/projets/5/tickets).
// - The state sentence is the <h1>: « N issues ouvertes sur owner/repo. » (N = the issues of state open, those already in Cockpit included) then « Rien n'est écrit sur GitHub. Tu peux relancer l'import sans doublon. ».
// - The chips are three <button aria-pressed>: « À importer · N » (open, not in Cockpit; pressed by default), « Déjà dans Cockpit · N » (inCockpit not null, open or closed) and « Fermées » (closed, not in Cockpit; no count).
//   Each chip lists its issues only. « Tout cocher » and « Tout décocher » are two buttons, always there.
// - A row is an <li> holding the text « #58 · Exporter les tâches en PDF » in one element and, in another, its subtitle. Under « À importer » the row has an <input type="checkbox">, checked by default;
//   the other rows (« déjà dans Cockpit (US 43) », « déjà dans Cockpit (ticket 12) », « fermée ») have no checkbox.
// - The button is « Importer N issues » (N = the checked rows; disabled at 0) and next to it « X deviendront des US validées, Y des tickets que Claude transformera en US. » (X the checked rows of kind story).
// - The click POSTs /api/projects/5/issues/import with { numbers } (the checked numbers only); then « N issues importées. » (N = tickets of the answer), a link « Voir les tickets » to /projets/5/tickets, and the list is read again.
// - GitHub unreachable (a 502 on the list or on the import) shows « GitHub est injoignable, réessaie. ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const ISSUES = [
  issue(58, "Exporter les tâches en PDF", { kind: "story" }),
  issue(59, "Filtrer par étiquette", { kind: "story" }),
  issue(57, "Le bouton Enregistrer ne répond pas sur Safari"),
  issue(55, "Ajouter un mode sombre"),
  issue(61, "Lien expiré ou déjà utilisé", { inCockpit: { storyId: 43 } }),
  issue(62, "Un ticket déjà là", { inCockpit: { ticketId: 12 } }),
  issue(40, "Question sur la licence", { state: "closed" }),
];

const open = async (issues = ISSUES, options = {}) => {
  const api = stubImport(issues, options);
  renderAt("/projets/5/tickets/importer");
  return api;
};
const chip = (name: string) => screen.findByRole("button", { name });
const rowOf = async (text: string) =>
  (await screen.findByText(text)).closest("li") as HTMLElement;
const box = (li: HTMLElement) =>
  li.querySelector<HTMLInputElement>('input[type="checkbox"]');
const button = (name: string) => screen.findByRole("button", { name });

describe("056 F: how the screen is reached", () => {
  it("given the Tickets tab, when it loads, then a link Importer les issues leads to /projets/5/tickets/importer and opens the screen", async () => {
    stubImport(ISSUES, { tickets: [rich(11, "Exporter en CSV")] });
    renderAt("/projets/5/tickets");

    const link = await screen.findByRole("link", {
      name: "Importer les issues",
    });
    expect(link.getAttribute("href")).toBe("/projets/5/tickets/importer");
    fireEvent.click(link);

    await chip("À importer · 4");
    expect(window.location.pathname).toBe("/projets/5/tickets/importer");
  });

  it("given the screen, when it loads, then the breadcrumb is Projets, the project and Tickets, each a link", async () => {
    await open();
    await chip("À importer · 4");

    const nav = screen.getByRole("navigation", { name: "Fil d'Ariane" });
    expect(nav.textContent).toContain("Projets");
    expect(
      within(nav).getByRole("link", { name: "Projets" }).getAttribute("href"),
    ).toBe("/projets");
    expect(
      within(nav).getByRole("link", { name: "hello" }).getAttribute("href"),
    ).toBe("/projets/5");
    expect(
      within(nav).getByRole("link", { name: "Tickets" }).getAttribute("href"),
    ).toBe("/projets/5/tickets");
  });
});

describe("056 F: the sentences and the chips", () => {
  it("given 6 open issues, when the screen loads, then the h1 says how many are open and that nothing is written on GitHub", async () => {
    await open();

    await chip("À importer · 4");

    const h1 = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(h1).toContain("6 issues ouvertes sur octocat/hello.");
    expect(h1).toContain(
      "Rien n'est écrit sur GitHub. Tu peux relancer l'import sans doublon.",
    );
  });

  it("given the issues, when the screen loads, then the chips count 4 to import and 2 already in Cockpit, Fermées has no count, and À importer is pressed", async () => {
    await open();

    const toImport = await chip("À importer · 4");
    expect(toImport.getAttribute("aria-pressed")).toBe("true");
    expect(
      (await chip("Déjà dans Cockpit · 2")).getAttribute("aria-pressed"),
    ).toBe("false");
    expect((await chip("Fermées")).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Tout cocher" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tout décocher" })).toBeDefined();
  });
});

describe("056 F: the rows", () => {
  it("given the default chip, when the screen loads, then the four importable issues are rows with a checked box and their subtitle, and the others are not listed", async () => {
    await open();

    const story = await rowOf("#58 · Exporter les tâches en PDF");
    expect(box(story)?.checked).toBe(true);
    expect(
      within(story).getByText("écrite comme une US · deviendra une US validée"),
    ).toBeDefined();
    const bug = await rowOf(
      "#57 · Le bouton Enregistrer ne répond pas sur Safari",
    );
    expect(box(bug)?.checked).toBe(true);
    expect(
      within(bug).getByText("deviendra un ticket « Nouveau »"),
    ).toBeDefined();
    expect(box(await rowOf("#55 · Ajouter un mode sombre"))?.checked).toBe(
      true,
    );
    expect(box(await rowOf("#59 · Filtrer par étiquette"))?.checked).toBe(true);
    expect(screen.queryByText(/#61 ·/)).toBeNull();
    expect(screen.queryByText(/#62 ·/)).toBeNull();
    expect(screen.queryByText(/#40 ·/)).toBeNull();
  });

  it("given the chip Déjà dans Cockpit, when it is clicked, then the rows say déjà dans Cockpit (US 43) and (ticket 12) and have no checkbox", async () => {
    await open();
    fireEvent.click(await chip("Déjà dans Cockpit · 2"));

    const story = await rowOf("#61 · Lien expiré ou déjà utilisé");
    expect(within(story).getByText("déjà dans Cockpit (US 43)")).toBeDefined();
    expect(box(story)).toBeNull();
    const ticket = await rowOf("#62 · Un ticket déjà là");
    expect(
      within(ticket).getByText("déjà dans Cockpit (ticket 12)"),
    ).toBeDefined();
    expect(box(ticket)).toBeNull();
    expect(screen.queryByText(/#58 ·/)).toBeNull();
  });

  it("given the chip Fermées, when it is clicked, then the closed issue is a row that says fermée, without checkbox", async () => {
    await open();
    fireEvent.click(await chip("Fermées"));

    const closed = await rowOf("#40 · Question sur la licence");
    expect(within(closed).getByText("fermée")).toBeDefined();
    expect(box(closed)).toBeNull();
    expect(screen.queryByText(/#58 ·/)).toBeNull();
  });
});

describe("056 F: the checkboxes and the button", () => {
  it("given every row checked, when the screen loads, then the button reads Importer 4 issues with the sentence of the two kinds", async () => {
    await open();

    await button("Importer 4 issues");
    expect(
      screen.getByText(
        "2 deviendront des US validées, 2 des tickets que Claude transformera en US.",
      ),
    ).toBeDefined();
  });

  it("given a ticket row is unchecked, when the count is read, then the button says Importer 3 issues and the sentence has one ticket less", async () => {
    await open();
    const row = await rowOf("#55 · Ajouter un mode sombre");

    fireEvent.click(box(row) as HTMLInputElement);

    await button("Importer 3 issues");
    expect(
      screen.getByText(
        "2 deviendront des US validées, 1 des tickets que Claude transformera en US.",
      ),
    ).toBeDefined();
  });

  it("given Tout décocher then Tout cocher, when they are clicked, then no box is checked and the button is disabled at 0, then all four are checked again", async () => {
    await open();
    await chip("À importer · 4");

    fireEvent.click(screen.getByRole("button", { name: "Tout décocher" }));
    const none = await button("Importer 0 issues");
    expect((none as HTMLButtonElement).disabled).toBe(true);
    expect(
      (await rowOf("#58 · Exporter les tâches en PDF")).querySelector("input")
        ?.checked,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Tout cocher" }));
    await button("Importer 4 issues");
    expect(box(await rowOf("#58 · Exporter les tâches en PDF"))?.checked).toBe(
      true,
    );
  });
});

describe("056 F: the import", () => {
  it("given #55 is unchecked, when Importer 3 issues is clicked, then the POST sends the three checked numbers only", async () => {
    const api = await open();
    fireEvent.click(
      box(await rowOf("#55 · Ajouter un mode sombre")) as HTMLInputElement,
    );

    fireEvent.click(await button("Importer 3 issues"));

    await waitFor(() => expect(api.imports).toHaveLength(1));
    expect([...(api.imports[0]?.numbers ?? [])].sort()).toEqual([57, 58, 59]);
  });

  it("given the import succeeds, when the button is clicked, then 4 issues importées appears with a link to the Tickets tab, the list is read again and the four rows are now in Cockpit", async () => {
    const api = await open();

    fireEvent.click(await button("Importer 4 issues"));

    await screen.findByText("4 issues importées.");
    const link = screen.getByRole("link", { name: "Voir les tickets" });
    expect(link.getAttribute("href")).toBe("/projets/5/tickets");
    await waitFor(() => expect(api.state.lists).toBeGreaterThanOrEqual(2));
    await chip("À importer · 0");
    await chip("Déjà dans Cockpit · 6");
  });

  it("given GitHub is down on the import, when the button is clicked, then the screen says GitHub est injoignable, réessaie. and no issue is reported imported", async () => {
    await open(ISSUES, { importStatus: 502 });

    fireEvent.click(await button("Importer 4 issues"));

    await screen.findByText("GitHub est injoignable, réessaie.");
    expect(screen.queryByText(/issues importées/)).toBeNull();
  });
});

describe("056 F: GitHub is down on the list", () => {
  it("given the list answers 502, when the screen loads, then it says GitHub est injoignable, réessaie. and offers no import", async () => {
    await open(ISSUES, { listStatus: 502 });

    await screen.findByText("GitHub est injoignable, réessaie.");
    expect(
      screen.queryByRole("button", { name: /^Importer \d+ issues?$/ }),
    ).toBeNull();
  });
});
