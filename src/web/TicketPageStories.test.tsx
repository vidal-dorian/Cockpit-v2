// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 4.3 (decision 017 L, J): the ticket page lists the stories of the ticket, each leading to /us/:id, and
// stops offering Supprimer once the ticket has stories.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const rowOf = (link: HTMLElement) => {
  const row = link.closest("li");
  expect(row, "a story must be inside a list item").not.toBeNull();
  return row as HTMLElement;
};

describe("criterion 14: Ticket page with stories", () => {
  const written = () => ({
    ...ticket(7, "Idée découpée"),
    step: "to_validate",
  });
  const stories = () => [
    story(21, 7, "exporter le journal", { position: 1, status: "to_validate" }),
    story(22, 7, "relire les exports", { position: 2, status: "ready" }),
  ];

  it("given a ticket with two stories, when /tickets/:id loads, then they are listed in order with their position, their « je veux » text and their French status, each a link to /us/:id", async () => {
    stubTicketApi([written()], stories());

    renderAt("/tickets/7");

    const first = await screen.findByRole("link", {
      name: /exporter le journal/,
    });
    const second = within(main()).getByRole("link", {
      name: /relire les exports/,
    });
    expect(first.getAttribute("href")).toBe("/us/21");
    expect(second.getAttribute("href")).toBe("/us/22");
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(rowOf(first).textContent).toMatch(/\b1\b/);
    expect(rowOf(first).textContent).toMatch(/à valider/i);
    expect(rowOf(second).textContent).toMatch(/\b2\b/);
    expect(rowOf(second).textContent).toMatch(/prête/i);
    // The codes of the server are never shown.
    expect(main().textContent).not.toMatch(/to_validate|ready/);
  });

  it("given a ticket whose step is to_validate, when the page loads, then the step reads À valider outside the list of stories", async () => {
    stubTicketApi([written()], stories());

    renderAt("/tickets/7");

    await screen.findByRole("link", { name: /exporter le journal/ });
    const badges = within(main()).getAllByText("À valider");
    expect(badges.some((el) => !el.closest("li"))).toBe(true);
    expect(within(main()).queryByText("Nouveau")).toBeNull();
  });

  it("given a ticket with stories, when the page loads, then there is no Supprimer button", async () => {
    stubTicketApi([written()], stories());

    renderAt("/tickets/7");

    await screen.findByRole("link", { name: /exporter le journal/ });
    expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeDefined();
  });

  it("given a ticket without stories, when the page loads, then Supprimer is offered and no story is listed", async () => {
    stubTicketApi([ticket(7, "Idée brute")], []);

    renderAt("/tickets/7");

    await screen.findByRole("heading", { level: 1, name: "Idée brute" });
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeDefined();
    expect(main().querySelector('a[href^="/us/"]')).toBeNull();
  });

  const unfinished =
    /Claude n'a pas fini d'écrire les user stories de ce ticket\./;

  it("given a ticket with stories whose writing is not closed (storiesWrittenAt null), when the page loads, then it says Claude n'a pas fini d'écrire les user stories de ce ticket.", async () => {
    stubTicketApi([{ ...written(), storiesWrittenAt: null }], stories());

    renderAt("/tickets/7");

    await screen.findByRole("link", { name: /exporter le journal/ });
    expect(main().textContent).toMatch(unfinished);
  });

  it("given a ticket with stories whose writing is closed, when the page loads, then the notice is not shown", async () => {
    stubTicketApi(
      [{ ...written(), storiesWrittenAt: "2026-10-26T10:00:00.000Z" }],
      stories(),
    );

    renderAt("/tickets/7");

    await screen.findByRole("link", { name: /exporter le journal/ });
    expect(main().textContent).not.toMatch(unfinished);
  });

  it("given a ticket without stories, when the page loads, then the notice is not shown", async () => {
    stubTicketApi([ticket(7, "Idée brute")], []);

    renderAt("/tickets/7");

    await screen.findByRole("heading", { level: 1, name: "Idée brute" });
    expect(main().textContent).not.toMatch(unfinished);
  });
});
