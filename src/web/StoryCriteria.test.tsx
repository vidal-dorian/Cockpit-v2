// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 7.3 (decision 035 F): the result and the evidence under each criterion of the story page, and the PR as a
// link. Pinned: GET /api/stories/:id gives story.prNumber and, on each criterion, result, evidence and resultRunId.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const k = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  position: id,
  given: `donné ${id}`,
  when: `quand ${id}`,
  then: `alors ${id}`,
  result: null,
  evidence: null,
  resultRunId: null,
  ...over,
});
const load = async (over: Record<string, unknown>) => {
  const base = story(21, 7, "relire les exports", { status: "in_review" });
  stubTicketApi(
    [ticket(7, "Idée")],
    [{ ...base, ...over } as unknown as typeof base],
  );
  renderAt("/us/21");
  await waitFor(() =>
    expect(main().textContent).toContain("relire les exports"),
  );
};

describe("criterion 9: the story page", () => {
  it("given criteria with results, when /us/21 loads, then each shows its result and its evidence, and one not reported shows neither", async () => {
    await load({
      criteria: [
        k(1, {
          result: "passed",
          evidence: "src/a.test.ts > logs in",
          resultRunId: 31,
        }),
        k(2, {
          result: "failed",
          evidence: "src/b.test.ts > logs out",
          resultRunId: 31,
        }),
        k(3),
      ],
    });

    const text = (id: number) =>
      (screen.getByText(`donné ${id}`).closest("li") as HTMLElement)
        .textContent ?? "";
    expect(text(1)).toContain("passe");
    expect(text(1)).toContain("src/a.test.ts > logs in");
    expect(text(2)).toContain("échoue");
    expect(text(2)).toContain("src/b.test.ts > logs out");
    expect(text(3)).not.toContain("passe");
    expect(text(3)).not.toContain("échoue");
  });

  it("given a prNumber of 12, when /us/21 loads, then a link « PR #12 » points at the pull request of the project", async () => {
    await load({ prNumber: 12 });

    const link = within(main()).getByRole("link", { name: /PR #12/ });

    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/12",
    );
  });

  it("given no prNumber, when /us/21 loads, then there is no PR link", async () => {
    await load({ prNumber: null });

    expect(within(main()).queryByRole("link", { name: /PR #/ })).toBeNull();
  });
});
