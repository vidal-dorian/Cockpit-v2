// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice S07 (decision 085 L, 058 F): « Finis aujourd'hui » on /claude. Pinned: each row of finishedToday also gives
//   verdict: { acceptable: boolean, reasons: string[] }, prNumber: number | null, storyStatus: string, summary: string | null.
// The row says « verdict : acceptable » or « verdict : à vérifier », « PR #n » when there is one, the link « Relire la PR #n »
// (GitHub) when the story is in_review, the first line of the summary of a failed run, and the section links to /journal.

const project = { id: 5, name: "octocat/hello" };
const row = (runId: number, over: Record<string, unknown> = {}) => ({
  runId,
  storyId: 40 + runId,
  iWant: `Faire ${runId}`,
  project,
  outcome: "succeeded",
  verdict: { acceptable: false, reasons: ["ci_pending"] },
  prNumber: 44,
  storyStatus: "in_review",
  summary: "Fini.\nDétail.",
  ...over,
});

function stub(finishedToday: object[]) {
  stubHome(empty());
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
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/claude")
        return Response.json({
          questions: [],
          running: [],
          finishedToday,
          readyStories: [],
        });
      if (path.startsWith("/api/queue"))
        return Response.json({ paused: false, pausedReason: null, items: [] });
      return inner(input, init);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const finished = async () =>
  (
    await screen.findByRole("heading", { level: 2, name: "Finis aujourd'hui" })
  ).closest("section") as HTMLElement;
const rowOf = (box: HTMLElement, title: string) =>
  within(box).getByText(title).closest("li") as HTMLElement;

describe("S07: Finis aujourd'hui shows what to do", () => {
  it("given a run to check with a PR in review, when the page loads, then its row says « verdict : à vérifier » and « PR #44 » and links « Relire la PR #44 » to GitHub", async () => {
    stub([row(20)]);
    renderAt("/claude");

    const li = rowOf(await finished(), "Faire 20");

    expect(li.textContent).toContain("verdict : à vérifier");
    expect(li.textContent).toContain("PR #44");
    expect(
      within(li)
        .getByRole("link", { name: "Relire la PR #44" })
        .getAttribute("href"),
    ).toBe("https://github.com/octocat/hello/pull/44");
  });

  it("given an acceptable run whose story is done, when the page loads, then its row says « verdict : acceptable » and has no Relire link", async () => {
    stub([
      row(21, {
        verdict: { acceptable: true, reasons: [] },
        storyStatus: "done",
      }),
    ]);
    renderAt("/claude");

    const li = rowOf(await finished(), "Faire 21");

    expect(li.textContent).toContain("verdict : acceptable");
    expect(within(li).queryByRole("link", { name: /Relire la PR/ })).toBeNull();
  });

  it("given a failed run, when the page loads, then its row shows the first line of the summary, not the second, and no PR link", async () => {
    stub([
      row(22, {
        outcome: "failed",
        verdict: { acceptable: false, reasons: ["run_not_succeeded"] },
        prNumber: null,
        storyStatus: "ready",
        summary: "Un test ne passe pas après 3 essais.\nDétail du journal.",
      }),
    ]);
    renderAt("/claude");

    const li = rowOf(await finished(), "Faire 22");

    expect(li.textContent).toContain("échoué");
    expect(li.textContent).toContain("Un test ne passe pas après 3 essais.");
    expect(li.textContent).not.toContain("Détail du journal.");
    expect(within(li).queryByRole("link", { name: /Relire la PR/ })).toBeNull();
  });

  it("given the section, when the page loads, then « Tout l'historique » leads to the journal", async () => {
    stub([row(20)]);
    renderAt("/claude");

    const box = await finished();

    expect(
      within(box)
        .getByRole("link", { name: /Tout l'historique/ })
        .getAttribute("href"),
    ).toMatch(/^\/journal/);
  });
});
