// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redClasses } from "./test-journal.tsx";
import { renderAt, story } from "./test-tickets.tsx";
import { rich, stubTab } from "./test-tickets-full.tsx";

// Slice 11.2, decision 054 G (S14): the panel of a ticket on the Tickets tab.
//
// Pinned choices (the decision leaves them open):
// - A click on the <button> of a row opens `Panel` (Shell.tsx): an <aside> named « Ticket » (role complementary) with the badge « Ticket », an <h2> with the title,
//   the description as sanitised markdown, an <h3> « Les user stories de ce ticket » followed by one item per story reading « US <id> · <i_want> » and its status word (any case).
//   Absent until a row is clicked.
// - The counter is the one of `Panel`: « i sur n » (n = the tickets listed, in the order of the list, i the open one) with the buttons Précédent (↑) and Suivant (↓).
// - Footer: the link « Ouvrir le ticket » to /tickets/:id, the link « Modifier » to /tickets/:id?modifier=1 (the ticket page opens with its edit form), the button « Supprimer ».
// - « Supprimer » shows « Confirmer la suppression » and « Annuler » in the panel, sends nothing yet; the confirmation sends DELETE /api/tickets/:id, closes the panel and the row is gone.
//   A ticket that has stories has no « Supprimer » (017): the button is not offered at all.
// - Colour (J): no destructive, red, rose or `you` class in the panel (before the confirmation, which keeps the danger button of the ticket page).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const T1 = rich(11, "Exporter en CSV", { tags: ["export"] });
const T2 = rich(12, "Connexion sans mot de passe", {
  step: "in_progress",
  descriptionMd: "Les clients **oublient** leur mot de passe.",
});
const T3 = rich(13, "Thème sombre", { priority: "high" });
const STORIES = [
  story(42, 12, "Lien par e-mail", { status: "to_validate" }),
  story(43, 12, "Lien expiré", { status: "ready", position: 2 }),
  story(45, 12, "Renvoyer un lien", { status: "in_progress", position: 3 }),
];

const click = async (title: string) =>
  fireEvent.click(await screen.findByRole("button", { name: title }));
const panel = () => screen.findByRole("complementary", { name: "Ticket" });

describe("054 G: the panel of a ticket", () => {
  it("given the tab, when it loads, then no panel is open", async () => {
    stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");

    await screen.findByRole("button", { name: "Exporter en CSV" });

    expect(screen.queryByRole("complementary", { name: "Ticket" })).toBeNull();
    expect(window.location.pathname).toBe("/projets/5/tickets");
  });

  it("given a ticket with a markdown description and stories, when its row is clicked, then the panel shows Ticket, the title, the rendered description and its stories with their statuses", async () => {
    stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");

    await click("Connexion sans mot de passe");

    const aside = within(await panel());
    expect(
      aside.getByText("Ticket", { selector: "span, p, div" }),
    ).toBeDefined();
    expect(
      aside.getByRole("heading", {
        level: 2,
        name: "Connexion sans mot de passe",
      }),
    ).toBeDefined();
    expect(aside.getByText("oublient").tagName).toBe("STRONG");
    expect(
      aside.getByRole("heading", { name: "Les user stories de ce ticket" }),
    ).toBeDefined();
    const first = (await aside.findByText(/US 42 · Lien par e-mail/)).closest(
      "li",
    );
    expect(first?.textContent).toMatch(/à valider/i);
    expect(
      aside.getByText(/US 43 · Lien expiré/).closest("li")?.textContent,
    ).toMatch(/prête/i);
    expect(
      aside.getByText(/US 45 · Renvoyer un lien/).closest("li")?.textContent,
    ).toMatch(/en cours/i);
    expect(window.location.pathname).toBe("/projets/5/tickets");
  });

  it("given the second of three tickets open, when the counter is read and the arrows used, then it says 2 sur 3 and Précédent and Suivant move through the list", async () => {
    stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");
    await click("Connexion sans mot de passe");
    const aside = within(await panel());
    expect(aside.getByText("2 sur 3")).toBeDefined();

    fireEvent.click(aside.getByRole("button", { name: "Suivant" }));
    expect((await panel()).querySelector("h2")?.textContent).toBe(
      "Thème sombre",
    );
    expect(within(await panel()).getByText("3 sur 3")).toBeDefined();
    expect(
      within(await panel())
        .getByRole("button", { name: "Suivant" })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(
      within(await panel()).getByRole("button", { name: "Précédent" }),
    );
    fireEvent.click(
      within(await panel()).getByRole("button", { name: "Précédent" }),
    );
    expect((await panel()).querySelector("h2")?.textContent).toBe(
      "Exporter en CSV",
    );
    expect(within(await panel()).getByText("1 sur 3")).toBeDefined();
  });

  it("given a ticket open, when the footer is read, then Ouvrir le ticket leads to /tickets/:id and Modifier to the same page in edit mode", async () => {
    stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");
    await click("Exporter en CSV");

    const aside = within(await panel());

    expect(
      aside
        .getByRole("link", { name: "Ouvrir le ticket" })
        .getAttribute("href"),
    ).toBe("/tickets/11");
    expect(
      aside.getByRole("link", { name: "Modifier" }).getAttribute("href"),
    ).toBe("/tickets/11?modifier=1");
  });

  it("given a ticket without story, when Supprimer is clicked, then the panel asks for a confirmation without sending anything, and Annuler brings the button back", async () => {
    const api = stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");
    await click("Exporter en CSV");

    fireEvent.click(
      within(await panel()).getByRole("button", { name: "Supprimer" }),
    );

    const aside = within(await panel());
    expect(
      aside.getByRole("button", { name: "Confirmer la suppression" }),
    ).toBeDefined();
    expect(api.writes()).toEqual([]);
    fireEvent.click(aside.getByRole("button", { name: "Annuler" }));
    expect(
      within(await panel()).getByRole("button", { name: "Supprimer" }),
    ).toBeDefined();
    expect(api.writes()).toEqual([]);
  });

  it("given the confirmation, when it is confirmed, then DELETE /api/tickets/:id is sent, the panel closes and the row is gone", async () => {
    const api = stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");
    await click("Exporter en CSV");
    fireEvent.click(
      within(await panel()).getByRole("button", { name: "Supprimer" }),
    );

    fireEvent.click(
      within(await panel()).getByRole("button", {
        name: "Confirmer la suppression",
      }),
    );

    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: "DELETE", path: "/api/tickets/11", body: undefined },
      ]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Ticket" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Exporter en CSV" }),
      ).toBeNull(),
    );
  });

  it("given a ticket that has stories, when its panel is open, then Supprimer is not offered", async () => {
    stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");
    await click("Connexion sans mot de passe");

    const aside = within(await panel());
    await aside.findByText(/US 42 · Lien par e-mail/);

    expect(aside.queryByRole("button", { name: "Supprimer" })).toBeNull();
    expect(aside.getByRole("link", { name: "Ouvrir le ticket" })).toBeDefined();
  });
});

describe("054 J: the colour of the panel", () => {
  it("given a high ticket with tags, when its panel is open, then nothing in it is red or destructive", async () => {
    stubTab([T1, T2, T3], STORIES);
    renderAt("/projets/5/tickets");
    await click("Exporter en CSV");

    const aside = await panel();

    expect(within(aside).getByRole("heading", { level: 2 }).textContent).toBe(
      "Exporter en CSV",
    );
    expect(redClasses(aside)).toEqual([]);
  });
});
