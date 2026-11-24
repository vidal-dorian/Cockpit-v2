// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubNight } from "./test-night.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 094 F: a night story whose run ended pr_to_open shows as « PR à ouvrir », not as a failure.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("criterion F1: the morning page", () => {
  it("given a night item with the outcome pr_to_open, when the page shows, then its story sits under « PR à ouvrir » and not under « En échec »", async () => {
    stubNight({
      home: {
        night: {
          id: 1,
          startsAt: new Date(2026, 10, 8, 22).toISOString(),
          endsAt: new Date(2026, 10, 9, 7).toISOString(),
          delivered: 0,
          total: 1,
          workSeconds: 0,
          criteriaProven: 0,
          failures: 0,
          items: [
            {
              storyId: 45,
              iWant: "faire la chose 45",
              outcome: "pr_to_open",
              startedAt: null,
              finishedAt: null,
            },
          ],
        },
      },
    });
    renderAt("/nuit");

    const section = (
      await screen.findByRole("heading", { name: /Cette nuit, Claude/ })
    ).closest("section");
    if (!section) throw new Error("no <section> around « Cette nuit »");
    const morning = within(section);
    const link = morning.getByRole("link", { name: /^US 45 ·/ });
    expect(morning.getByText(/PR à ouvrir/)).toBeTruthy();
    expect(morning.queryByText(/en échec/i)).toBeNull();
    expect(link.closest("li")).not.toBeNull();
  });
});
