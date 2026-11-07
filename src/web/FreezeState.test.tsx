// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stateWord } from "./features.ts";
import { featuresMarkdown } from "./features-markdown.ts";
import { API_MODULE, WEB_MODULE } from "./test-conception.tsx";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import {
  FACTURER,
  type FakeFeature,
  featureRule,
  stubFeatures,
} from "./test-features.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Slice R4 (decision 050 F): the state « figée » of a rule, where the state of a rule is shown.
// Pinned: in GET /api/projects/:id/features a rule's `state` is "frozen" (src/server/freeze-features.test.ts), the word is « figée » (stateWord of src/web/features.ts feeds the graph,
// the list and the Markdown). On the page of a story (GET /api/stories/:id, unchanged), the web computes it: story.kind "takeover", story.status "done", criterion.takeoverState "kept"
// and criterion.result "passed" show « figée » instead of « validée ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const frozen = (id: number, summary: string) =>
  featureRule(id, { summary, state: "frozen" as unknown as "kept" });
const FROZEN: FakeFeature = {
  ...FACTURER,
  rules: [
    frozen(201, "Une facture payée ne change plus."),
    featureRule(202, { summary: "Une facture a un numéro.", state: "kept" }),
    featureRule(203, { summary: "Une remise est plafonnée." }),
  ],
};

describe("decision 050 F: the word", () => {
  it("given a frozen rule, when its word is asked, then it is « figée », and « voulue » and « à trancher » are unchanged", () => {
    const word = (state: string) =>
      stateWord(featureRule(1, { state: state as "kept" }));
    expect(word("frozen")).toBe("figée");
    expect(word("kept")).toBe("voulue");
    expect(word("pending")).toBe("à trancher");
  });
});

describe("decision 050 F: the features list", () => {
  it("given a frozen, a kept and a pending rule, when the list is open, then the Règles section says figée, voulue and à trancher, one each", async () => {
    stubFeatures([FROZEN], [], { modules: [API_MODULE, WEB_MODULE] });
    renderAt("/projets/5/conception/fonctionnalites");
    const main = await screen.findByRole("main");
    await waitFor(() =>
      expect(
        within(main).getByRole("heading", { level: 1 }).textContent,
      ).toContain("acteur"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Liste" }));

    const text = within(
      within(main).getByRole("region", { name: "Règles" }),
    ).getAllByRole("listitem");
    const words = text.map((li) => li.textContent ?? "");
    expect(words[0]).toContain("figée");
    expect(words[1]).toContain("voulue");
    expect(words[2]).toContain("à trancher");
  });
});

describe("decision 050 F: the Markdown export", () => {
  it("given a frozen, a kept and a pending rule, when the Markdown is built, then figée appears once beside voulue once and à trancher once", () => {
    const text = featuresMarkdown(
      [FROZEN],
      [API_MODULE, WEB_MODULE],
      "octocat/hello",
    );

    expect(text.match(/figée/g)).toHaveLength(1);
    expect(text.match(/voulue/g)).toHaveLength(1);
    expect(text.match(/à trancher/g)).toHaveLength(1);
  });
});

const k = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  position: id,
  given: `donné ${id}`,
  when: `quand ${id}`,
  then: `alors ${id}`,
  result: null,
  evidence: null,
  resultRunId: null,
  summary: `règle ${id}`,
  takeoverState: "kept",
  ...over,
});
const load = async (status: string, criteria: unknown[]) => {
  const base = story(21, 7, "reprendre la facturation", { status });
  stubDecisionApi({
    tickets: [ticket(7, "Reprise : Facturation")],
    stories: [
      decisionStory({
        ...base,
        kind: "takeover",
        criteria,
      } as unknown as typeof base),
    ],
  });
  renderAt("/us/21");
  await waitFor(() =>
    expect(screen.getByRole("main").textContent).toContain(
      "reprendre la facturation",
    ),
  );
};
const item = (id: number) =>
  screen.getByText(`donné ${id}`).closest("li") as HTMLElement;

describe("decision 050 F: the page of the story", () => {
  it("given a done takeover story with a passed and a failed rule, when /us/21 loads, then the passed one says figée and the failed one does not", async () => {
    await load("done", [
      k(210, { result: "passed", evidence: "preuve" }),
      k(211, { result: "failed", evidence: "preuve" }),
    ]);

    expect(item(210).textContent).toContain("figée");
    expect(item(210).textContent).not.toContain("validée");
    expect(item(211).textContent).not.toContain("figée");
  });

  it("given a takeover story in review whose rule passed, when /us/21 loads, then it still says validée, not figée", async () => {
    await load("in_review", [k(210, { result: "passed", evidence: "preuve" })]);

    expect(item(210).textContent).toContain("validée");
    expect(item(210).textContent).not.toContain("figée");
  });
});
