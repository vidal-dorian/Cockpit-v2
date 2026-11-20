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

// Story 50 (ticket 45, WCAG 2.1.4): Préférences can turn the single-key shortcuts off, and the help lists them all.
//
// Pinned choices:
// - Préférences has a checkbox named « Désactiver les raccourcis d'une touche » (role checkbox or switch); checking it applies at once, on the page, without a reload;
// - the window of `?` (dialog « Raccourcis clavier ») lists « Reprise » M, B, P and « Accueil » R next to the others.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const projects = [{ id: 5, name: "octocat/hello", state: "idle" }];
const toggleName = "Désactiver les raccourcis d'une touche";

const preferences = () => {
  stubShell({ projects });
  addErgonomics();
  renderAt("/reglages/preferences");
};
const turnOff = async () => {
  const box = (await screen.findByRole("checkbox", {
    name: toggleName,
  })) as HTMLInputElement;
  fireEvent.click(box);
  await waitFor(() => expect(box.checked).toBe(true));
};
const ideaField = () =>
  screen.findByRole("textbox", { name: "Idée" }) as Promise<HTMLInputElement>;

describe("story 50: single-key shortcuts", () => {
  it("given Préférences, when I check « Désactiver les raccourcis d'une touche », then single-key shortcuts (N) do nothing", async () => {
    preferences();
    const input = await ideaField();

    await turnOff();
    fireEvent.keyDown(document.body, { key: "n" });

    expect(document.activeElement).not.toBe(input);
  });

  it("given the single-key shortcuts off, when I press Ctrl K, then the search still opens", async () => {
    preferences();
    await turnOff();

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });

    expect(
      await screen.findByRole("dialog", { name: "Chercher" }),
    ).toBeDefined();
  });

  it("given the help of the shortcuts, when I open it with ?, then it lists M, B, P (Reprise) and R (Accueil)", async () => {
    preferences();
    await ideaField();

    fireEvent.keyDown(document.body, { key: "?" });
    const help = within(
      await screen.findByRole("dialog", { name: "Raccourcis clavier" }),
    );

    for (const key of ["M", "B", "P", "R"])
      expect(help.getByText(key, { selector: "kbd" }), key).toBeDefined();
  });
});
