// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addErgonomics, FOUND } from "./test-ergonomics.tsx";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 15.3 (decision 073 B, C, D): the search window of S08.
//
// Pinned choices (the decision leaves them open):
// - The sidebar (aside « Barre latérale») has a button whose name starts with « Chercher » (it shows <kbd>Ctrl K</kbd>); it and Ctrl+K / Cmd+K (keydown on the document) open
//   a role="dialog" named « Chercher», with a field (role combobox or textbox), filter buttons named Tout, User stories, Tickets, Runs, Projets, Actions (aria-pressed; Tout at first),
//   and the results as role="option" in order (stories, tickets, runs, projects, actions), the first selected (aria-selected="true"); each group has a role="heading" with its name.
// - The window searches 200 ms after the last keystroke: GET /api/search?q=<typed> once, never for an empty field. The filters narrow the list on the page (no request parameter).
// - Enter opens the selected option on the same tab (pages /us/:id, /tickets/:id, /runs/:id, /projets/:id); Ctrl+Enter calls window.open(<page>, "_blank", "noopener") and stays.
// - Escape closes the window and gives the focus back to what had it. With an empty field, the options are the actions: « Noter une idée »,
//   Accueil, Claude, Cette nuit, Tous les projets, Équipes d'agents, Journal, Réglages, Préférences; « Noter une idée » opens the idea panel (dialog « Noter une idée»), « Préférences » goes to /reglages/preferences.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const start = () => {
  stubShell({ projects: [{ ...PROJECT, state: "idle" }] });
  const api = addErgonomics({ search: FOUND });
  renderAt("/");
  return api;
};
const dialog = () => screen.findByRole("dialog", { name: "Chercher" });
const field = (d: HTMLElement) =>
  within(d).queryByRole("combobox") ?? within(d).getByRole("textbox");
const typed = async (text: string) => {
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  const d = await dialog();
  fireEvent.change(field(d), { target: { value: text } });
  await within(d).findAllByRole("option");
  return d;
};
const options = (d: HTMLElement) =>
  within(d)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
const sidebarButton = async () =>
  within(
    await screen.findByRole("complementary", { name: "Barre latérale" }),
  ).getByRole("button", { name: /^Chercher/ });

describe("slice 15.3 B: the search window", () => {
  it("given a page, when Ctrl+K is pressed and lien expir typed, then one search is sent after the debounce and the results are grouped under User stories, Tickets, Runs and Projets", async () => {
    const api = start();
    await sidebarButton();

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    const d = await dialog();
    fireEvent.change(field(d), { target: { value: "li" } });
    fireEvent.change(field(d), { target: { value: "lien expir" } });
    expect(api.calls.filter((c) => c.path === "/api/search")).toHaveLength(0);
    await within(d).findAllByRole("option");

    expect(
      api.calls.filter((c) => c.path === "/api/search").map((c) => c.q),
    ).toEqual(["lien expir"]);
    for (const name of ["User stories", "Tickets", "Runs", "Projets"])
      expect(within(d).getByRole("heading", { name })).toBeDefined();
    const shown = options(d);
    expect(shown[0]).toContain("Lien expiré ou déjà utilisé");
    expect(shown[1]).toContain("Renvoyer un lien expiré");
    expect(shown[2]).toContain("Connexion sans mot de passe");
    expect(shown[3]).toContain("17");
    expect(shown[4]).toContain("octocat/hello");
  });

  it("given the sidebar, when its Chercher button is clicked, then the dialog opens, and Escape closes it and gives the focus back to the button", async () => {
    start();
    const opener = await sidebarButton();
    opener.focus();

    fireEvent.click(opener);
    const d = await dialog();
    fireEvent.keyDown(field(d), { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Chercher" })).toBeNull(),
    );
    expect(document.activeElement).toBe(opener);
  });

  it("given results, when ArrowDown then Enter are pressed, then the second result's page opens (US 45)", async () => {
    start();
    const d = await typed("lien expir");
    expect(
      within(d).getAllByRole("option")[0]?.getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.keyDown(field(d), { key: "ArrowDown" });
    fireEvent.keyDown(field(d), { key: "Enter" });

    await waitFor(() => expect(window.location.pathname).toBe("/us/45"));
  });
});

describe("slice 15.3 B: the filters", () => {
  it("given results, when Tickets then Runs then Tout are clicked, then the list narrows to that group and comes back", async () => {
    start();
    const d = await typed("lien expir");

    fireEvent.click(within(d).getByRole("button", { name: "Tickets" }));
    expect(
      within(d)
        .getByRole("button", { name: "Tickets" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(options(d)).toHaveLength(1);
    expect(options(d)[0]).toContain("Connexion sans mot de passe");

    fireEvent.click(within(d).getByRole("button", { name: "Runs" }));
    expect(options(d)).toHaveLength(1);
    expect(options(d)[0]).toContain("17");

    fireEvent.click(within(d).getByRole("button", { name: "Tout" }));
    expect(options(d).length).toBeGreaterThanOrEqual(5);
  });
});

describe("slice 15.3 C: the actions", () => {
  it("given an empty field, when the window opens, then the actions are listed and nothing is searched", async () => {
    const api = start();
    await sidebarButton();

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    const d = await dialog();

    const shown = options(d).join("|");
    for (const name of [
      "Noter une idée",
      "Accueil",
      "Claude",
      "Cette nuit",
      "Tous les projets",
      "Équipes d'agents",
      "Journal",
      "Réglages",
      "Préférences",
    ])
      expect(shown, name).toContain(name);
    expect(api.calls.filter((c) => c.path === "/api/search")).toHaveLength(0);
  });

  it("given the actions, when « Noter une idée » is chosen, then the idea panel opens and the window closes", async () => {
    start();
    await sidebarButton();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    const d = await dialog();

    fireEvent.click(within(d).getByRole("option", { name: /Noter une idée/ }));

    expect(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    ).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "Chercher" })).toBeNull();
  });

  it("given the actions, when « Préférences » is chosen, then the page goes to /reglages/preferences", async () => {
    start();
    await sidebarButton();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    const d = await dialog();

    fireEvent.click(within(d).getByRole("option", { name: /Préférences/ }));

    await waitFor(() =>
      expect(window.location.pathname).toBe("/reglages/preferences"),
    );
  });
});

describe("slice 15.3 D: Ctrl+Enter", () => {
  it("given results, when Ctrl+Enter is pressed on the first, then it opens in a new tab and the page stays", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    start();
    const d = await typed("lien expir");

    fireEvent.keyDown(field(d), { key: "Enter", ctrlKey: true });

    expect(open).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/us\/43$/),
      "_blank",
      "noopener",
    );
    expect(window.location.pathname).toBe("/");
  });
});
