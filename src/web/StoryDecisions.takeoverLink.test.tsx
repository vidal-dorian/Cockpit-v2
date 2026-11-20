// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Story #51 (one name per notion), criterion 3: the link to the rules of a takeover story carries the name of the tab, not « écran de reprise ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("story 51, criterion 3: the link to the business rules", () => {
  it("given a takeover story to validate, when I read the link to its rules, then it is named after the tab (Règles) and not « écran de reprise »", async () => {
    const shown = decisionStory(
      story(21, 7, "relire les exports", { status: "to_validate" }),
      null,
    );
    Object.assign(shown, { kind: "takeover" });
    stubDecisionApi({
      tickets: [ticket(7, "Idée découpée")],
      stories: [shown],
    });

    renderAt("/us/21");

    const link = await waitFor(() => {
      const a = document.querySelector(
        'a[href="/projets/5/conception/regles"]',
      );
      expect(a).not.toBeNull();
      return a as HTMLAnchorElement;
    });
    expect(link.textContent).toMatch(/Règles/);
    expect(link.textContent).not.toMatch(/écran de reprise/i);
    expect(screen.getByRole("main").textContent).not.toMatch(
      /écran de reprise/i,
    );
  });
});
