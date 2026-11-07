// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { panel, withHome } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("slice 9.3: the decisions of a story in the right panel (S22)", () => {
  it("given a story to validate, when /us/21 loads, then Valider and Renvoyer are inside a complementary landmark", async () => {
    stubDecisionApi({
      tickets: [ticket(7, "Idée découpée")],
      stories: [
        decisionStory(
          story(21, 7, "relire les exports", { status: "to_validate" }),
        ),
      ],
    });
    withHome({});
    renderAt("/us/21");

    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain(
        "relire les exports",
      ),
    );
    const side = within(panel());
    expect(side.getByRole("button", { name: "Valider" })).toBeDefined();
    expect(side.getByRole("button", { name: /^Renvoyer/ })).toBeDefined();
    expect(
      screen
        .getAllByRole("complementary")
        .some((a) => a.hasAttribute("data-panel")),
    ).toBe(true);
  });
});
