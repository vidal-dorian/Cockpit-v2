// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeEventSource, type HomeData, PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const review = (prNumber: number) => ({
  kind: "review",
  storyId: 20 + prNumber,
  iWant: `exporter la vue ${prNumber}`,
  prNumber,
  prCiState: "success",
  project: PROJECT,
});
const url = (n: number) => `https://github.com/octocat/hello/pull/${n}`;

describe("slice 14.7: review fixes", () => {
  it("given a night where nothing ran, when the page shows, then it says 0 min de travail", async () => {
    const night = {
      id: 1,
      startsAt: new Date(2026, 10, 8, 22).toISOString(),
      endsAt: new Date(2026, 10, 9, 7).toISOString(),
      delivered: 0,
      total: 0,
      workSeconds: 0,
      criteriaProven: 0,
      failures: 0,
      items: [],
    };
    stubShell({ night } as unknown as Partial<HomeData>);
    renderAt("/");

    expect(await screen.findByText(/0 min de travail/)).toBeTruthy();
  });

  it("given an unfinished series whose last PR leaves the list, when the series restarts, then it does not open the same PR twice in a row", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const project = { id: 5, name: PROJECT.name, state: "idle" };
    const api = stubShell({
      forYou: [52, 53, 54].map(review),
      projects: [project],
    });
    renderAt("/");
    fireEvent.click(
      await screen.findByRole("button", { name: /Relire en série/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /PR suivante · #53/ }),
    );
    // #54 is merged: the series has nothing left to open but #52 and #53, both seen.
    api.state.home = { ...api.state.home, forYou: [52, 53].map(review) };
    FakeEventSource.all
      .find((s) => s.url === "/api/events")
      ?.emit("change", "story:74");
    await waitFor(() =>
      expect(screen.queryByText(/exporter la vue 54/)).toBeNull(),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Relire en série/ }),
    );

    expect(open).toHaveBeenLastCalledWith(url(52), "_blank", "noopener");
    fireEvent.click(
      await screen.findByRole("button", { name: /PR suivante · #53/ }),
    );
    expect(open).toHaveBeenLastCalledWith(url(53), "_blank", "noopener");
  });
});
