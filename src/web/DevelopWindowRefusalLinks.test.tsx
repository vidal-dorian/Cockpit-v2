// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Ticket #49 (decision 085 D): in the refusal of « Développer avec Claude », the words that name the page
// (« Réglages », « page Coût ») are themselves the link, not a separate « Ouvrir … » link next to the sentence.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

/** Lays the launcher answers over the ticket fake, the launch of the story 42 answering 409 `error`. */
function refuseLaunch(error: string) {
  stubTicketApi(
    [ticket(7, "Idée")],
    [story(42, 7, "Me connecter", { status: "ready" })],
  );
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/projects/5/branches")
        return Response.json({ branches: ["main"] });
      if (path === "/api/projects/5/agents")
        return Response.json({
          agents: [],
          catalog: [],
          team: null,
          teams: [],
        });
      if (path === "/api/me/launcher")
        return Response.json({
          prompt: "p",
          connected: true,
          needsReconnect: false,
          projectIds: [5],
        });
      if (path === "/api/me/budgets")
        return Response.json({ runUsd: null, nightUsd: null, monthUsd: null });
      if (path === "/api/stories/42/launch" && method === "POST")
        return Response.json({ error }, { status: 409 });
      return inner(input, init);
    }),
  );
}

async function launchAndGetAlert() {
  renderAt("/us/42");
  fireEvent.click(
    await screen.findByRole("button", { name: "Développer avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Développer avec Claude",
  });
  fireEvent.click(
    await within(panel).findByRole("radio", { name: /Dans le cloud/ }),
  );
  fireEvent.click(
    within(panel).getByRole("button", { name: /Lancer dans le cloud/ }),
  );
  return within(panel).findByRole("alert");
}

describe("ticket #49: the refusals of « Développer avec Claude » are links", () => {
  it("given a launch refused because the project is not ticked in the launcher, when the refusal shows, then « Réglages » is a link to that setting", async () => {
    refuseLaunch("project_not_in_launcher");

    const alert = await launchAndGetAlert();

    expect(
      within(alert)
        .getByRole("link", { name: "Réglages" })
        .getAttribute("href"),
    ).toBe("/reglages/taches-cloud");
  });

  it("given a launch refused for the monthly budget, when the refusal shows, then « page Coût » is a link to /claude/cout", async () => {
    refuseLaunch("monthly_budget_reached");

    const alert = await launchAndGetAlert();

    expect(
      within(alert)
        .getByRole("link", { name: "page Coût" })
        .getAttribute("href"),
    ).toBe("/claude/cout");
  });
});
