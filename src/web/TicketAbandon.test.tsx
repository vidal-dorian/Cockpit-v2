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
const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const maybeButton = (name: string) => screen.queryByRole("button", { name });
const click = (name: string) => fireEvent.click(button(name));
const loaded = () =>
  screen.findByRole("heading", { level: 1, name: "Idée découpée" });

function seed(step = "in_progress", abandonedAt: string | null = null) {
  return stubDecisionApi({
    tickets: [{ ...ticket(7, "Idée découpée"), step, abandonedAt }],
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
    seed("abandoned", "2026-10-28T12:00:00.000Z");

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

describe("criterion 12: the confirmation names what is lost (decision 003, rule 4)", () => {
  // Positions 1, 3 and 4 and no digit in the titles: a "2" can only come from the confirmation.
  const seedCounted = () =>
    stubDecisionApi({
      tickets: [{ ...ticket(7, "Idée découpée"), step: "in_progress" }],
      stories: [
        decisionStory(story(20, 7, "la première", { status: "ready" })),
        decisionStory(
          story(21, 7, "la seconde", { position: 3, status: "to_validate" }),
        ),
        decisionStory(
          story(22, 7, "la finie", { position: 4, status: "done" }),
        ),
      ],
    });
  const userStories = (text: string) =>
    (text.match(/user stor/gi) ?? []).length;

  it("given a ticket with 2 unfinished stories and 1 done story, when « Abandonner le ticket » is clicked, then the confirmation says 2 user stories are abandoned with it and that the ticket cannot be reopened", async () => {
    const api = seedCounted();
    renderAt("/tickets/7");
    await loaded();
    const before = main().textContent ?? "";
    expect(before).not.toMatch(/\b2\b/);
    expect(before).not.toMatch(/rouvre/i);

    click("Abandonner le ticket");

    const after = main().textContent ?? "";
    expect(after).toMatch(/\b2\b/);
    expect(userStories(after)).toBeGreaterThan(userStories(before));
    expect(after).toMatch(/rouvre/i);
    expect(api.writes()).toEqual([]);
  });
});

describe("criterion 12: the keyboard focus survives the abandon (decision 018 J)", () => {
  it("given the confirmation, when « Confirmer l'abandon » is clicked by a keyboard user, then the focus is on an element that still exists inside the page, not on the body", async () => {
    seed();
    renderAt("/tickets/7");
    await loaded();
    button("Abandonner le ticket").focus();
    click("Abandonner le ticket");
    button("Confirmer l'abandon").focus();

    click("Confirmer l'abandon");

    await waitFor(() => expect(main().textContent).toContain("Abandonné"));
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(main().contains(document.activeElement)).toBe(true);
    });
  });
});

describe("criterion 12: the buttons follow abandonedAt, not the step (decision 018 J)", () => {
  it("given a ticket whose stories are all abandoned (step abandoned, abandonedAt null), when the page loads, then it reads Abandonné and still offers « Modifier » and « Abandonner le ticket »", async () => {
    seed("abandoned", null);

    renderAt("/tickets/7");

    await loaded();
    expect(main().textContent).toContain("Abandonné");
    expect(maybeButton("Abandonner le ticket")).not.toBeNull();
    expect(maybeButton("Modifier")).not.toBeNull();
  });

  it("given that ticket, when « Abandonner le ticket » is confirmed, then the page posts to /abandon and both buttons go", async () => {
    const api = seed("abandoned", null);
    renderAt("/tickets/7");
    await loaded();
    click("Abandonner le ticket");

    click("Confirmer l'abandon");

    await waitFor(() => expect(maybeButton("Abandonner le ticket")).toBeNull());
    expect(api.writes().map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/tickets/7/abandon"],
    ]);
    expect(maybeButton("Modifier")).toBeNull();
  });

  it("given a ticket with abandonedAt set, when the page loads, then it reads Abandonné and offers neither « Modifier » nor « Abandonner le ticket »", async () => {
    seed("abandoned", "2026-10-28T12:00:00.000Z");

    renderAt("/tickets/7");

    await loaded();
    expect(main().textContent).toContain("Abandonné");
    expect(maybeButton("Abandonner le ticket")).toBeNull();
    expect(maybeButton("Modifier")).toBeNull();
  });
});
