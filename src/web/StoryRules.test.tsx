// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Slice R2 (decision 047 K): the page of a takeover story shows the state of each rule, a link to judge it, and says which rules stop the validation.
//
// Pinned where the decision leaves it open (the developer follows these):
// - GET /api/stories/:id gives story.kind ("feature" | "takeover") and, on each criterion of a takeover story, `summary` and `takeoverState` ("pending" | "kept"), null on others.
// - A criterion of a takeover story shows its summary, « à relire » (pending) or « validée » (kept), and a link « Juger dans l'écran de reprise » to
//   /projets/5/conception/regles?regle=<criterion id>. An ordinary story shows none of that.
// - While a rule is pending, « Valider » is disabled and the page says « 2 règles à trancher : <summaries> » (« 1 règle à trancher » for one), right rule 5 of decision 003.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const k = (
  id: number,
  state: "pending" | "kept" | null,
  over: Record<string, unknown> = {},
) => ({
  id,
  position: id,
  given: `donné ${id}`,
  when: `quand ${id}`,
  then: `alors ${id}`,
  result: null,
  evidence: null,
  resultRunId: null,
  summary: state ? `règle ${id}` : null,
  takeoverState: state,
  ...over,
});
const load = async (kind: "feature" | "takeover", criteria: unknown[]) => {
  const base = story(21, 7, "reprendre la facturation", {
    status: "to_validate",
  });
  stubDecisionApi({
    tickets: [ticket(7, "Reprise : Facturation")],
    stories: [
      decisionStory({ ...base, kind, criteria } as unknown as typeof base),
    ],
  });
  renderAt("/us/21");
  await waitFor(() =>
    expect(main().textContent).toContain("reprendre la facturation"),
  );
};
const validate = () =>
  screen.getByRole("button", { name: /^Valider/ }) as HTMLButtonElement;

describe("decision 047 K: the rules on the page of the story", () => {
  it("given a takeover story with a pending and a kept rule, when /us/21 loads, then each shows its state and a link to the takeover screen on its rule", async () => {
    await load("takeover", [k(210, "pending"), k(211, "kept")]);

    const item = (id: number) =>
      screen.getByText(`donné ${id}`).closest("li") as HTMLElement;
    expect(item(210).textContent).toContain("à relire");
    expect(item(211).textContent).toContain("validée");
    expect(
      within(item(210))
        .getByRole("link", { name: "Juger dans l'écran de reprise" })
        .getAttribute("href"),
    ).toBe("/projets/5/conception/regles?regle=210");
    expect(
      within(item(211))
        .getByRole("link", { name: "Juger dans l'écran de reprise" })
        .getAttribute("href"),
    ).toBe("/projets/5/conception/regles?regle=211");
  });

  it("given an ordinary story, when /us/21 loads, then no rule state and no link", async () => {
    await load("feature", [k(210, null)]);

    expect(
      within(main()).queryByRole("link", {
        name: "Juger dans l'écran de reprise",
      }),
    ).toBeNull();
    expect(main().textContent).not.toContain("à relire");
    expect(main().textContent).not.toContain("à trancher");
    expect(validate().disabled).toBe(false);
  });

  it("given two pending rules, when /us/21 loads, then « Valider » is disabled and the page says « 2 règles à trancher » with both rules", async () => {
    await load("takeover", [k(210, "pending"), k(211, "pending")]);

    expect(validate().disabled).toBe(true);
    expect(main().textContent).toMatch(
      /2 règles à trancher : .*règle 210.*règle 211/s,
    );
  });

  it("given one pending rule among kept ones, when /us/21 loads, then the page says « 1 règle à trancher » with that rule only", async () => {
    await load("takeover", [k(210, "kept"), k(211, "pending")]);

    expect(validate().disabled).toBe(true);
    expect(main().textContent).toMatch(/1 règle à trancher : .*règle 211/s);
    expect(main().textContent).not.toMatch(/à trancher : .*règle 210/s);
  });

  it("given every rule kept, when /us/21 loads, then « Valider » is usable and nothing is to be decided", async () => {
    await load("takeover", [k(210, "kept"), k(211, "kept")]);

    expect(validate().disabled).toBe(false);
    expect(main().textContent).not.toContain("à trancher");
  });
});
