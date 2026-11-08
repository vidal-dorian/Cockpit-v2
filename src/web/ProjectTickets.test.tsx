// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

/** The list item that holds a ticket title. */
const rowOf = (title: string) => {
  const row = screen.getByText(title).closest("li");
  expect(row, `${title} must be inside a list item`).not.toBeNull();
  return row as HTMLElement;
};

describe("Project page, the tickets", () => {
  // Decision 055 F, G: a row is a button that opens the panel (the ticket page is reached by « Ouvrir le ticket »), no longer a link.
  it("given two tickets, when /projets/:id loads, then a Tickets section lists them in the API order, each a button with its step Nouveau", async () => {
    stubTicketApi([ticket(8, "Plus récent"), ticket(7, "Plus ancien")]);

    renderAt("/projets/5/tickets");

    await screen.findByRole("heading", { name: "Tickets" });
    const newer = await screen.findByRole("button", { name: "Plus récent" });
    const older = screen.getByRole("button", { name: "Plus ancien" });
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(rowOf("Plus récent")).getByText("Nouveau")).toBeDefined();
    expect(within(rowOf("Plus ancien")).getByText("Nouveau")).toBeDefined();
  });

  // Decision 055 E (changes 014 I): the « Nouveau ticket » form left the tab; a ticket is created by the idea bar only.
  // The tests of that form (title and description fields, Créer, the refusals of the server, the archived project) are gone with it;
  // the idea bar's own tests (IdeaPanel.test.tsx) cover what they covered.
  it("given a project without ticket, when the page loads, then it says there is none yet and offers no creation form", async () => {
    stubTicketApi([]);

    renderAt("/projets/5/tickets");

    await screen.findByText(/Aucun ticket/);
    expect(screen.queryByText("Nouveau ticket")).toBeNull();
    expect(screen.queryByLabelText("Titre")).toBeNull();
    expect(screen.queryByRole("button", { name: "Créer" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("given a ticket in the list, when its row is clicked and Ouvrir le ticket after it, then the ticket page opens on /tickets/:id", async () => {
    stubTicketApi([ticket(7, "Ouvre-moi", "du texte")]);
    renderAt("/projets/5/tickets");

    fireEvent.click(await screen.findByRole("button", { name: "Ouvre-moi" }));
    fireEvent.click(
      await screen.findByRole("link", { name: "Ouvrir le ticket" }),
    );

    await waitFor(() => expect(window.location.pathname).toBe("/tickets/7"));
    await screen.findByRole("heading", { level: 1, name: /^Ouvre-moi/ });
  });
});
