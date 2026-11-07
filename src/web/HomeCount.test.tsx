// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, FakeEventSource, PROJECT, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 8.1 (decision 040 E): the « Accueil » link of the « Navigation principale » carries the number of items of
// « À toi de jouer », read in the same GET /api/home; its text is then « Accueil 3 »; nothing is added at 0.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const item = (n: number) => ({
  kind: "validate",
  storyId: n,
  iWant: `us ${n}`,
  project: PROJECT,
});
const nav = () =>
  screen.getByRole("navigation", { name: "Navigation principale" });
const accueil = () => within(nav()).getByRole("link", { name: /^Accueil/ });

describe("criterion 7: the counter of the Accueil link", () => {
  it.each(["/", "/journal"])(
    "given 3 items in forYou, when %s is shown, then the link reads « Accueil 3 »",
    async (path) => {
      stubHome({ ...empty(), forYou: [item(1), item(2), item(3)] });
      renderAt(path);

      await waitFor(() =>
        expect(accueil().textContent?.replace(/\s+/g, " ").trim()).toBe(
          "Accueil 3",
        ),
      );
    },
  );

  it("given no item, when the home is shown, then the link reads « Accueil » alone", async () => {
    const api = stubHome(empty());
    renderAt("/journal");
    await screen.findByRole("navigation", { name: "Navigation principale" });
    await waitFor(() => expect(api.homeReads()).toBeGreaterThan(0));

    expect(accueil().textContent?.trim()).toBe("Accueil");
  });

  it("given a logged-out visitor, when a page is shown, then /api/home is not read and there is no navigation (the login screen has no shell)", async () => {
    const api = stubHome(empty(), false);
    renderAt("/journal");
    await screen.findByRole("link", { name: "Se connecter avec GitHub" });
    await new Promise((r) => setTimeout(r, 50));

    expect(api.homeReads()).toBe(0);
    expect(
      screen.queryByRole("navigation", { name: "Navigation principale" }),
    ).toBeNull();
  });

  it("given the counter shows 1, when a change event arrives and the item is gone, then the counter disappears", async () => {
    const api = stubHome({ ...empty(), forYou: [item(1)] });
    renderAt("/journal");
    await waitFor(() =>
      expect(accueil().textContent?.replace(/\s+/g, " ").trim()).toBe(
        "Accueil 1",
      ),
    );
    await waitFor(() => expect(FakeEventSource.all.length).toBeGreaterThan(0));

    api.state.home = empty();
    for (const s of FakeEventSource.all) s.emit("change", "story:1");

    await waitFor(() => expect(accueil().textContent?.trim()).toBe("Accueil"));
  });
});
