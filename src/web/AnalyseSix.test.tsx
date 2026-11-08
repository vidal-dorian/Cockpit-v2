// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { plan, SKILL, stubConception } from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R5 (decision 051 K): « Ajouter /analyser au repo » offers the six files of /analyser, the three agents of the analysis included.
// Changed by decision 052 K (slice R6): upgrade-advisor is the seventh file of /analyser (the file keeps its name, the list has seven entries now).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const SIX = [
  SKILL,
  ".claude/agents/upgrade-advisor.md",
  ".claude/agents/cartographer.md",
  ".claude/agents/rules-analyst.md",
  ".claude/agents/bug-hunter.md",
  ".claude/agents/security-reviewer.md",
  ".claude/agents/architect.md",
];

describe("decision 051 K and 052 K: the seven files of /analyser", () => {
  it("given a plan of the seven files, when the window opens, then the seven are listed and sent", async () => {
    const api = stubConception({
      prepare: {
        status: 200,
        body: {
          plan: plan(
            SIX.map((path) => ({ path, content: "x", status: "create" })),
          ),
        },
      },
      apply: { status: 200, body: { commitSha: "c".repeat(40), created: SIX } },
    });
    renderAt("/projets/5/conception");
    fireEvent.click(
      await screen.findByRole("button", { name: "Analyser avec Claude" }),
    );
    const panel = await screen.findByRole("complementary", {
      name: "Analyser avec Claude",
    });

    fireEvent.click(
      await within(panel).findByRole("button", {
        name: "Ajouter /analyser au repo",
      }),
    );

    await within(panel).findByText(/C'est fait/);
    const items = within(panel)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    for (const path of SIX)
      expect(
        items.some((t) => t.includes(path)),
        path,
      ).toBe(true);
    const [sent] = api.posts("/api/projects/5/prepare/apply");
    const body = sent?.body as { plan: { files: { path: string }[] } };
    expect(body.plan.files.map((f) => f.path).sort()).toEqual([...SIX].sort());
  });
});
