// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 7.1 (decision 033 I): the story page lists its runs (story.runs of GET /api/stories/:id), each linking to
// /runs/:id, and reloads on a `change` of `story:<id>`.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");

describe("criterion 9: the runs on the story page", () => {
  it("given a story with two runs, when /us/21 loads, then each run links to /runs/:id with its French status", async () => {
    const withRuns = {
      ...story(21, 7, "relire les exports", { status: "in_progress" }),
      runs: [
        {
          id: 31,
          status: "running",
          startedAt: "2026-11-05T11:00:00.000Z",
          finishedAt: null,
        },
        {
          id: 30,
          status: "failed",
          startedAt: "2026-11-05T10:00:00.000Z",
          finishedAt: "2026-11-05T10:30:00.000Z",
        },
      ],
    };
    stubTicketApi([ticket(7, "Idée")], [withRuns]);

    renderAt("/us/21");

    await waitFor(() =>
      expect(main().textContent).toContain("relire les exports"),
    );
    const links = within(main())
      .getAllByRole("link")
      .filter(
        (a) =>
          /^\/runs\//.test(a.getAttribute("href") ?? "") &&
          !/Voir le run/.test(a.textContent ?? ""),
      );
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/runs/31",
      "/runs/30",
    ]);
    expect(links[0]?.textContent).toContain("en cours");
    expect(links[1]?.textContent).toContain("échoué");
  });
});
