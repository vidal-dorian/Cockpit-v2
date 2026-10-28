// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { fail, renderAt, story, ticket } from "./test-tickets.tsx";

// Slice 4.4 (decision 018 D, J): « Abandonner le ticket » on /tickets/:id. Pinned labels: « Confirmer l'abandon » and
// « Annuler » replace the button on the spot; the page then shows the step « Abandonné ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const button = (name: string) => screen.getByRole("button", { name });
const click = (name: string) => fireEvent.click(button(name));
const loaded = () =>
  screen.findByRole("heading", { level: 1, name: "Idée découpée" });

function seed(step = "in_progress") {
  return stubDecisionApi({
    tickets: [{ ...ticket(7, "Idée découpée"), step }],
    stories: [
      decisionStory(story(20, 7, "la première", { status: "ready" })),
      decisionStory(story(21, 7, "la seconde", { position: 2 })),
    ],
  });
}

describe("criterion 12: abandon a ticket", () => {
  it("given a ticket that is not abandoned, when the page loads, then « Abandonner le ticket » is offered", async () => {
    seed();

    renderAt("/tickets/7");

    await loaded();
    expect(button("Abandonner le ticket")).toBeDefined();
  });

  it("given a ticket without stories, when the page loads, then « Abandonner le ticket » is offered too", async () => {
    stubDecisionApi({ tickets: [ticket(7, "Idée découpée")], stories: [] });

    renderAt("/tickets/7");

    await loaded();
    expect(button("Abandonner le ticket")).toBeDefined();
  });

  it("given the button, when it is clicked, then « Confirmer l'abandon » and Annuler appear on the spot and nothing is sent", async () => {
    const api = seed();
    renderAt("/tickets/7");
    await loaded();

    click("Abandonner le ticket");

    expect(button("Confirmer l'abandon")).toBeDefined();
    expect(button("Annuler")).toBeDefined();
    expect(api.writes()).toEqual([]);
  });

  it("given the confirmation, when Annuler is clicked, then it goes away, nothing is sent and the step does not change", async () => {
    const api = seed();
    renderAt("/tickets/7");
    await loaded();
    click("Abandonner le ticket");

    click("Annuler");

    expect(
      screen.queryByRole("button", { name: "Confirmer l'abandon" }),
    ).toBeNull();
    expect(button("Abandonner le ticket")).toBeDefined();
    expect(main().textContent).not.toContain("Abandonné");
    expect(api.writes()).toEqual([]);
  });

  it("given the confirmation, when « Confirmer l'abandon » is clicked, then the page posts to /api/tickets/7/abandon, shows Abandonné, and the button is gone", async () => {
    const api = seed();
    renderAt("/tickets/7");
    await loaded();
    click("Abandonner le ticket");

    click("Confirmer l'abandon");

    await waitFor(() => expect(main().textContent).toContain("Abandonné"));
    expect(api.writes().map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/tickets/7/abandon"],
    ]);
    expect(
      screen.queryByRole("button", { name: "Abandonner le ticket" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Confirmer l'abandon" }),
    ).toBeNull();
    expect(main().textContent).not.toContain("abandoned");
  });

  it("given an abandoned ticket, when the page loads, then it reads Abandonné and offers no « Abandonner le ticket »", async () => {
    seed("abandoned");

    renderAt("/tickets/7");

    await loaded();
    expect(main().textContent).toContain("Abandonné");
    expect(
      screen.queryByRole("button", { name: "Abandonner le ticket" }),
    ).toBeNull();
  });

  it("given the confirmation, when the server answers 409 ticket_abandoned or project_archived, then a French alert is shown, never the code", async () => {
    const api = seed();
    renderAt("/tickets/7");
    await loaded();
    click("Abandonner le ticket");
    api.failNext.abandonTicket = fail(409, "project_archived");

    click("Confirmer l'abandon");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/archiv/i);
    expect(alert.textContent).not.toContain("project_archived");
    expect(main().textContent).not.toContain("Abandonné");
  });
});
