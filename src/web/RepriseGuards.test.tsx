// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { rules, stubReprise } from "./test-reprise.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";
import { decisionError } from "./tickets.ts";

// Decision 047: what the takeover screen and the story page say about a rule that left, a shifted key and a takeover story.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("decision 047 I: the rule of the URL", () => {
  it("given ?regle=99 that is not on the screen, when it loads, then the screen says so and opens another rule", async () => {
    stubReprise(rules(3), {});
    renderAt("/projets/5/conception/regles?regle=99");

    expect(
      await screen.findByText("Cette règle n'est plus à trancher."),
    ).toBeDefined();
    await waitFor(() => expect(panel().textContent).toMatch(/Règle 1 sur 3/));
  });
});

describe("decision 047 E: the keys", () => {
  it("given Shift held, when B or V is pressed, then nothing is sent", async () => {
    const api = stubReprise(rules(3), {});
    renderAt("/projets/5/conception/regles");
    await waitFor(() => expect(panel().textContent).toMatch(/Règle 1 sur 3/));

    fireEvent.keyDown(document.body, { key: "B", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "V", shiftKey: true });

    expect(api.writes()).toEqual([]);
  });
});

describe("decision 047 K: a takeover story on its page", () => {
  const seed = () =>
    stubDecisionApi({
      tickets: [ticket(7, "Reprise")],
      stories: [
        Object.assign(
          decisionStory(story(21, 7, "règles", { status: "to_validate" })),
          {
            kind: "takeover",
          },
        ),
      ],
    });

  it("given a takeover story to validate, when its page loads, then Modifier and Renvoyer are gone and a line points to the takeover screen", async () => {
    seed();
    renderAt("/us/21");

    const link = await screen.findByRole("link", { name: "écran de reprise" });

    expect(link.getAttribute("href")).toBe("/projets/5/conception/regles");
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renvoyer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Valider" })).toBeDefined();
  });

  it.each([
    ["takeover_story", /ne se réécrit pas/],
    ["rules_pending", /encore à trancher/],
  ])(
    "given the refusal %s, when it is shown, then the sentence is French",
    async (error, text) => {
      const res = Response.json({ error }, { status: 409 });
      expect((await decisionError(res)).message).toMatch(text);
    },
  );
});
