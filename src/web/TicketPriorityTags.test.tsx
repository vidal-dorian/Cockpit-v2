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
import { renderAt, stubTicketApi } from "./test-tickets.tsx";
import { rich } from "./test-tickets-full.tsx";

// Slice 11.2, decision 054 H (and J): the priority and the tags on the ticket page.
//
// Pinned choices (the decision leaves them open):
// - Under the title (after the <h1>, inside <main>) the page writes the tags as words and, for a ticket that is not normal, « priorité haute » or « priorité basse »;
//   a normal ticket says nothing about its priority.
// - « Modifier » adds to the form of the title and the description: a select « Priorité » (options « Priorité : basse », « Priorité : normale », « Priorité : haute », values low, normal, high),
//   preset to the ticket's priority, and a textbox « Étiquette » (placeholder « + étiquette ») with the chips of the ticket, each with a button « Retirer l'étiquette <tag> ».
//   Enter in that field adds a chip (trim, inner spaces to one, lowercase, no duplicate, nothing for an empty one) and never submits the form.
// - « Enregistrer » PATCHes /api/tickets/:id with at least { priority, tags } (tags as shown by the chips); the page then shows the new ones.
// - The page opens straight in edit mode on /tickets/:id?modifier=1 (the link « Modifier » of the panel of the Tickets tab).
// - Colour (J): no destructive, red, rose or `you` class in the page.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const T = rich(7, "Ajouter la recherche", {
  priority: "high",
  tags: ["export", "compta"],
});
const main = () => screen.getByRole("main");
const waitForTitle = () =>
  screen.findByRole("heading", { level: 1, name: /^Ajouter la recherche/ });
const addTag = (text: string) => {
  const input = screen.getByRole("textbox", { name: "Étiquette" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};

describe("054 H: reading", () => {
  it("given a high ticket with tags, when /tickets/:id loads, then « priorité haute » and the tags are written under the title", async () => {
    stubTicketApi([T]);
    renderAt("/tickets/7");

    const heading = await waitForTitle();

    const high = within(main()).getByText("priorité haute");
    expect(within(main()).getByText("export")).toBeDefined();
    expect(within(main()).getByText("compta")).toBeDefined();
    expect(
      heading.compareDocumentPosition(high) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(redClasses(main())).toEqual([]);
  });

  it("given a normal ticket without tag, when the page loads, then it says nothing about the priority", async () => {
    stubTicketApi([rich(7, "Ajouter la recherche")]);
    renderAt("/tickets/7");

    await waitForTitle();

    expect(
      within(main()).queryByText(/priorité (haute|basse|normale)/),
    ).toBeNull();
    // The page has the new edit fields only once Modifier is clicked; it must at least know about tags to get here.
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByRole("combobox", { name: "Priorité" })).toBeDefined();
  });
});

describe("054 H: editing", () => {
  it("given a ticket, when Modifier is clicked, then the form offers Priorité preset to the ticket's and its tags as chips", async () => {
    stubTicketApi([T]);
    renderAt("/tickets/7");
    await waitForTitle();

    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));

    const priority = screen.getByRole("combobox", {
      name: "Priorité",
    }) as HTMLSelectElement;
    expect([...priority.options].map((o) => [o.value, o.textContent])).toEqual([
      ["low", "Priorité : basse"],
      ["normal", "Priorité : normale"],
      ["high", "Priorité : haute"],
    ]);
    expect(priority.value).toBe("high");
    expect(
      screen.getByRole("button", { name: "Retirer l'étiquette export" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Retirer l'étiquette compta" }),
    ).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "Étiquette" }) as HTMLInputElement)
        .placeholder,
    ).toBe("+ étiquette");
  });

  it("given the form, when the priority changes, a tag is removed and another added, and Enregistrer is clicked, then PATCH carries them and the page shows them", async () => {
    const api = stubTicketApi([T]);
    renderAt("/tickets/7");
    await waitForTitle();
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Priorité" }), {
      target: { value: "low" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Retirer l'étiquette compta" }),
    );
    addTag("  Back   Office ");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/tickets/7",
      body: { priority: "low", tags: ["export", "back office"] },
    });
    await within(main()).findByText("priorité basse");
    expect(within(main()).getByText("back office")).toBeDefined();
    expect(within(main()).queryByText("compta")).toBeNull();
  });

  it("given a tag already there and an empty one, when Enter is pressed in the field, then no chip is added and the form is not submitted", async () => {
    const api = stubTicketApi([T]);
    renderAt("/tickets/7");
    await waitForTitle();
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));

    addTag("EXPORT");
    addTag("   ");

    expect(
      screen.getAllByRole("button", { name: /^Retirer l'étiquette / }),
    ).toHaveLength(2);
    expect(api.writes()).toEqual([]);
  });

  it("given /tickets/7?modifier=1, when the page loads, then the edit form is already open", async () => {
    stubTicketApi([T]);
    renderAt("/tickets/7?modifier=1");

    expect(await screen.findByLabelText("Titre")).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Priorité" })).toBeDefined();
  });
});
