// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

// The ticket page is loaded on demand: a factory that throws makes that import reject, like a chunk the network could not fetch.
vi.mock("./TicketPage.tsx", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Ticket page, loading", () => {
  it("given the ticket page chunk fails to load, when /tickets/:id opens, then a French error with a Recharger button is shown instead of a blank screen", async () => {
    // React logs the error it catches; the test is about what the user sees.
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTicketApi([ticket(7, "Titre")]);

    renderAt("/tickets/7");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Impossible de charger la page/);
    expect(alert.textContent).not.toMatch(/dynamically imported/);
    expect(screen.getByRole("button", { name: "Recharger" })).toBeDefined();
    // The navigation stays usable.
    expect(screen.getByRole("link", { name: "Projets" })).toBeDefined();
  });
});
