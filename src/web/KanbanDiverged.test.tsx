// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Decision 025 J (slice 5.2): the card of a story whose issue was edited on GitHub says so in the Kanban.
// Pinned: every card of GET /api/projects/:id/stories has `issueDiverged: boolean`; the card of a diverged story holds the text
// « Issue modifiée sur GitHub » (inside its link, like the « à réécrire » mark), the others do not.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const MARK = "Issue modifiée sur GitHub";
const cardOf = (iWant: string) => {
  const card = screen
    .getByRole("link", { name: new RegExp(iWant) })
    .closest("li");
  expect(card, `${iWant} must be a list item`).not.toBeNull();
  return card as HTMLElement;
};

/** The ticket fake, whose board route also says which stories diverge. */
function stubBoard(divergedIds: number[]) {
  stubTicketApi(
    [ticket(7, "Idée A")],
    [
      story(21, 7, "vouloir-alpha", { status: "ready" }),
      story(22, 7, "vouloir-bravo", { status: "in_progress", position: 2 }),
      story(23, 7, "vouloir-charlie", { status: "done", position: 3 }),
    ],
  );
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const res = await inner(input, init);
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (
        new URL(raw, "http://localhost").pathname !== "/api/projects/5/stories"
      )
        return res;
      const { stories } = (await res.json()) as {
        stories: { id: number }[];
      };
      return Response.json({
        stories: stories.map((s) => ({
          ...s,
          issueDiverged: divergedIds.includes(s.id),
        })),
      });
    }),
  );
}

describe("criterion J: the Kanban card of a diverged story", () => {
  it("given one diverged story among three, when the project page loads, then only its card says « Issue modifiée sur GitHub », inside its link", async () => {
    stubBoard([22]);

    renderAt("/projets/5");

    await screen.findByRole("link", { name: /vouloir-bravo/ });
    expect(cardOf("vouloir-bravo").textContent).toContain(MARK);
    expect(
      screen.getByRole("link", { name: /vouloir-bravo/ }).textContent,
    ).toContain(MARK);
    expect(cardOf("vouloir-alpha").textContent).not.toContain(MARK);
    expect(cardOf("vouloir-charlie").textContent).not.toContain(MARK);
  });

  it("given no diverged story, when the project page loads, then the mark is nowhere on the board", async () => {
    stubBoard([]);

    renderAt("/projets/5");

    await screen.findByRole("link", { name: /vouloir-alpha/ });
    expect(screen.getByRole("main").textContent).not.toContain(MARK);
  });
});
