// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addErgonomics } from "./test-ergonomics.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 15.3 (decision 073 F, I): the cards « Thème » and « Raccourcis clavier » of Préférences.
//
// Pinned choices (the decision leaves them open):
// - The card « Thème » has the buttons Sombre, Clair and Comme le système (aria-pressed); clicking one sends PUT /api/me/theme { theme: "dark" | "light" | "system" },
//   sets data-theme on <html> ("dark", "light"; "system" sets "system") and writes the same value in localStorage under the key « cockpit-theme ».
// - The theme of GET /api/me is applied on load (the same on every device).
// - The card « Raccourcis clavier » is a section named by that text and lists « Chercher », « Noter une idée », « Élément suivant, précédent » and « Valider ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const preferences = (theme = "dark") => {
  stubShell({});
  const api = addErgonomics({ theme });
  renderAt("/reglages/preferences");
  return api;
};
const choice = (name: string) =>
  screen.findByRole("button", { name }) as Promise<HTMLButtonElement>;

describe("slice 15.3 F, I: Thème", () => {
  it("given a dark user, when Préférences loads, then the card Thème shows Sombre pressed, Clair and Comme le système not", async () => {
    preferences();

    expect(await screen.findByText(/Thème/)).toBeDefined();
    expect((await choice("Sombre")).getAttribute("aria-pressed")).toBe("true");
    expect((await choice("Clair")).getAttribute("aria-pressed")).toBe("false");
    expect(
      (await choice("Comme le système")).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("given the card, when Clair is clicked, then PUT /api/me/theme sends light, <html> gets data-theme light, localStorage keeps it and Clair is pressed", async () => {
    const api = preferences();

    fireEvent.click(await choice("Clair"));

    await waitFor(() =>
      expect(
        api.calls.filter(
          (c) => c.method === "PUT" && c.path === "/api/me/theme",
        ),
      ).toHaveLength(1),
    );
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
      theme: "light",
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("cockpit-theme")).toBe("light");
    await waitFor(async () =>
      expect((await choice("Clair")).getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("given a user whose theme is light on the server, when any page loads, then <html> gets data-theme light", async () => {
    stubShell({});
    addErgonomics({ theme: "light" });

    renderAt("/");

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light"),
    );
  });
});

describe("slice 15.3 I: Raccourcis clavier", () => {
  it("given Préférences, when it loads, then the card Raccourcis clavier lists the shortcuts", async () => {
    preferences();

    const card = (await screen.findByText(/Raccourcis clavier/)).closest(
      "section",
    ) as HTMLElement;

    expect(card).not.toBeNull();
    for (const name of [
      "Chercher",
      "Noter une idée",
      "Élément suivant, précédent",
      "Valider",
    ])
      expect(within(card).getByText(name), name).toBeDefined();
  });
});
