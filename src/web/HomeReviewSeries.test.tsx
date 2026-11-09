// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 14.7 (decision 070 H, I): « Relire en série » opens the PR to review one after the other; the R key does the same.
// Pinned: the button is found by its name (« Relire en série », then « PR suivante · #53 »; the <kbd>R</kbd> may follow in its name).

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
const opened = (prs: number[]) => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  // A project, so that the idea bar and its « Idée » field are rendered.
  stubShell({
    forYou: prs.map(review),
    projects: [{ ...PROJECT, state: "idle" }],
  });
  renderAt("/");
  return open;
};
const series = (name: RegExp) => screen.findByRole("button", { name });

describe("slice 14.7: Relire en série", () => {
  it("given three PR to review, when « Relire en série » is clicked three times, then #52, #53 and #54 open in a new tab, the button names the next PR and starts over", async () => {
    const open = opened([52, 53, 54]);

    fireEvent.click(await series(/Relire en série/));
    expect(open).toHaveBeenLastCalledWith(url(52), "_blank", "noopener");
    fireEvent.click(await series(/PR suivante · #53/));
    expect(open).toHaveBeenLastCalledWith(url(53), "_blank", "noopener");
    fireEvent.click(await series(/PR suivante · #54/));
    expect(open).toHaveBeenLastCalledWith(url(54), "_blank", "noopener");

    expect(open).toHaveBeenCalledTimes(3);
    expect(await series(/Relire en série/)).toBeTruthy();
  });

  it("given two PR to review, when the R key is pressed, then the first PR opens as with the click", async () => {
    const open = opened([52, 53]);
    await series(/Relire en série/);

    fireEvent.keyDown(document.body, { key: "r" });

    expect(open).toHaveBeenCalledExactlyOnceWith(url(52), "_blank", "noopener");
  });

  it("given two PR to review, when r is typed in « Noter une idée », then nothing opens", async () => {
    const open = opened([52, 53]);
    await series(/Relire en série/);

    fireEvent.keyDown(await screen.findByRole("textbox", { name: "Idée" }), {
      key: "r",
    });

    expect(open).not.toHaveBeenCalled();
  });

  it("given one PR to review, when the page shows, then there is no « Relire en série » button", async () => {
    opened([52]);

    await screen.findAllByText(/exporter la vue 52/);

    expect(
      screen.queryByRole("button", { name: /Relire en série/ }),
    ).toBeNull();
  });
});
