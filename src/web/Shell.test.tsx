// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 9.3 (decision 045 F): the sidebar replaces the top bar. Pinned: the nav « Navigation principale » sits in an <aside>
// (the sidebar) that also holds the projects section, Réglages, the account and the version.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const validate = (storyId: number, project = PROJECT) => ({
  kind: "validate",
  storyId,
  iWant: `vouloir ${storyId}`,
  project,
});
const projects = [
  { id: 5, name: "octocat/hello", state: "for_you" },
  { id: 8, name: "octocat/world", state: "claude" },
  { id: 9, name: "octocat/sleepy", state: "idle" },
];

async function sidebar() {
  const nav = await screen.findByRole("navigation", {
    name: "Navigation principale",
  });
  const aside = nav.closest("aside");
  if (!aside) throw new Error("the navigation must sit in an <aside>");
  return { nav, aside };
}

describe("slice 9.3: the shell of a logged-in user", () => {
  it("given a logged-in user with 2 items for them and 3 projects, when a page loads, then the navigation has Accueil with 2, Tous les projets with 3, Importer un repo, Journal and Réglages", async () => {
    stubShell({ forYou: [validate(1), validate(2)], projects });
    renderAt("/");

    const { aside } = await sidebar();
    await waitFor(() =>
      expect(
        within(aside).getByRole("link", { name: /^Accueil/ }).textContent,
      ).toContain("2"),
    );
    const href = (name: RegExp) =>
      within(aside).getByRole("link", { name }).getAttribute("href");
    expect(href(/^Accueil/)).toBe("/");
    expect(href(/^Tous les projets/)).toBe("/projets");
    expect(
      within(aside).getByRole("link", { name: /^Tous les projets/ })
        .textContent,
    ).toContain("3");
    expect(href(/Importer un repo/)).toBe("/projets");
    expect(href(/^Journal/)).toBe("/journal");
    expect(href(/^Réglages/)).toBe("/reglages");
  });

  it("given nothing for the user, when a page loads, then Accueil shows no counter", async () => {
    stubShell({ projects });
    renderAt("/");

    const { aside } = await sidebar();
    await screen.findByText("Cockpit v0.1.0");
    expect(
      within(aside)
        .getByRole("link", { name: /^Accueil/ })
        .textContent?.trim(),
    ).toBe("Accueil");
  });

  it("given projects of every state, when a page loads, then the sidebar lists the non-idle ones as links with their count of items for the user, and hides the idle one", async () => {
    stubShell({ forYou: [validate(1), validate(2)], projects });
    renderAt("/");

    const { aside } = await sidebar();
    const hello = await within(aside).findByRole("link", {
      name: /octocat\/hello/,
    });
    expect(hello.getAttribute("href")).toBe("/projets/5");
    expect(hello.textContent).toContain("2");
    const world = within(aside).getByRole("link", { name: /octocat\/world/ });
    expect(world.getAttribute("href")).toBe("/projets/8");
    expect(world.textContent).not.toMatch(/\d/);
    expect(within(aside).queryByText(/octocat\/sleepy/)).toBeNull();
  });

  it("given only idle projects, when a page loads, then the Projets section of the sidebar is hidden", async () => {
    stubShell({ projects: [projects[2] as (typeof projects)[number]] });
    renderAt("/");

    const { aside } = await sidebar();
    await screen.findByText("Cockpit v0.1.0");
    expect(within(aside).queryByText(/^Projets$/i)).toBeNull();
    expect(within(aside).queryByText(/octocat\/sleepy/)).toBeNull();
  });

  it("given a logged-in user, when a page loads, then the sidebar shows the account name, the version of the server and no old top bar", async () => {
    stubShell({ projects });
    renderAt("/");

    const { aside } = await sidebar();
    expect(await screen.findByText("Cockpit v0.1.0")).toBeDefined();
    expect(within(aside).getByText(/octocat/)).toBeDefined();
    expect(screen.queryByRole("banner")).toBeNull();
    const phone = screen.getByRole("navigation", {
      name: "Navigation du téléphone",
    });
    for (const link of screen.getAllByRole("link", { name: "Projets" }))
      expect(phone.contains(link)).toBe(true);
  });

  it("given a logged-in user, when I click Se déconnecter, then it POSTs /api/auth/logout", async () => {
    const api = stubShell({ projects });
    renderAt("/");

    const { aside } = await sidebar();
    fireEvent.click(
      await within(aside).findByRole("button", { name: "Se déconnecter" }),
    );

    await waitFor(() =>
      expect(api.sent).toContainEqual({
        method: "POST",
        path: "/api/auth/logout",
        body: undefined,
      }),
    );
  });
});

describe("slice 9.3: the shell of a logged-out visitor", () => {
  it("given a logged-out visitor, when the page loads, then there is no main navigation and the login link is shown", async () => {
    stubShell({}, { loggedIn: false });
    renderAt("/");

    expect(
      await screen.findByRole("link", { name: "Se connecter avec GitHub" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("navigation", { name: "Navigation principale" }),
    ).toBeNull();
  });

  it("given the phone Idée tab opened the panel, when Annuler is pressed, then the tab has the focus back", async () => {
    stubShell({ projects });
    renderAt("/");

    const tab = within(
      await screen.findByRole("navigation", {
        name: "Navigation du téléphone",
      }),
    ).getByRole("button", { name: /Idée/ });
    tab.focus();
    fireEvent.click(tab);
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Annuler",
      }),
    );

    await waitFor(() => expect(document.activeElement).toBe(tab));
  });

  it("given the panel open on a phone, when Nuit is tapped, then the nav is not inert and the panel closes on /nuit", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    stubShell({ projects });
    renderAt("/");

    const nav = await screen.findByRole("navigation", {
      name: "Navigation du téléphone",
    });
    fireEvent.click(within(nav).getByRole("button", { name: /Idée/ }));
    await screen.findByRole("dialog");
    expect(nav.closest("[inert]")).toBeNull();
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();

    fireEvent.click(within(nav).getByRole("link", { name: /Nuit/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.pathname).toBe("/nuit");
  });
});
