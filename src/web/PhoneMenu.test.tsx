// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeData } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 084 B (B1 to B6): the bottom bar of the phone gets 64 px tabs with 24 px icons, a fifth tab « Menu » that opens the content of the sidebar full screen,
// the iPhone safe area, and a green dot on « Nuit » while the morning block waits. jsdom has no layout: sizes and visibility are read on the classes.
// Pinned where the decision leaves room:
// - the tab is the button named « Menu »; the window is a role="dialog" named « Menu » with a button « Fermer »;
// - the night of GET /api/home is { id, startsAt, endsAt, delivered, total, workSeconds, criteriaProven, failures, items: [{ storyId, iWant, outcome, startedAt, finishedAt }] };
// - a row of the menu is at least 44 px tall: its class has h-11 / min-h-11 or more.

// jsdom has no showModal/close on <dialog>: stub them and restore the originals.
const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  if (realShowModal) HTMLDialogElement.prototype.showModal = realShowModal;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (realClose) HTMLDialogElement.prototype.close = realClose;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const projects = [
  { id: 5, name: "octocat/hello", state: "claude", favorite: true },
  { id: 8, name: "octocat/world", state: "idle" },
];
const night = {
  id: 1,
  startsAt: new Date(2026, 10, 8, 22).toISOString(),
  endsAt: new Date(2026, 10, 9, 7).toISOString(),
  delivered: 1,
  total: 1,
  workSeconds: 0,
  criteriaProven: 0,
  failures: 0,
  items: [
    {
      storyId: 45,
      iWant: "faire la chose",
      outcome: "pr",
      startedAt: null,
      finishedAt: null,
    },
  ],
};
const show = (path = "/", home: Record<string, unknown> = {}) => {
  const api = stubShell({ projects, ...home } as unknown as Partial<HomeData>);
  renderAt(path);
  return api;
};
const phoneNav = async () =>
  within(
    await screen.findByRole("navigation", { name: "Navigation du téléphone" }),
  );
const menuTab = async () =>
  (await phoneNav()).getByRole("button", { name: /Menu/ });
const openMenu = async () => {
  fireEvent.click(await menuTab());
  return within(await screen.findByRole("dialog", { name: "Menu" }));
};
const tall = /(^|\s)(min-h|h)-(11|12|14|16)(\s|$)/;

describe("decision 084 B1: the size of the bar", () => {
  it("given the phone nav, when it renders, then every tab is at least 64 px tall and carries a 24 px SVG icon above its 12 px word", async () => {
    show();

    const nav = await phoneNav();
    const tabs = [
      nav.getByRole("link", { name: /Accueil/ }),
      nav.getByRole("button", { name: /Idée/ }),
      nav.getByRole("link", { name: /Nuit/ }),
      nav.getByRole("link", { name: /Projets/ }),
      nav.getByRole("button", { name: /Menu/ }),
    ];
    for (const el of tabs) {
      expect(el.className).toMatch(/(^|\s)min-h-16(\s|$)/);
      expect(el.className).toContain("text-xs");
      const icon = el.querySelector("svg");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(
        icon?.getAttribute("width") === "24" ||
          /(^|\s)size-6(\s|$)/.test(icon?.getAttribute("class") ?? ""),
      ).toBe(true);
    }
  });

  it("given the phone nav, when it renders, then it adds the iPhone safe area below, and the page declares viewport-fit=cover", async () => {
    show();

    const nav = (await screen.findByRole("navigation", {
      name: "Navigation du téléphone",
    })) as HTMLElement;
    expect(nav.className).toContain("safe-area-inset-bottom");
    expect(readFileSync("src/web/index.html", "utf8")).toMatch(
      /<meta[^>]*name="viewport"[^>]*viewport-fit=cover/,
    );
  });

  it("given a project, when the shell renders, then the bottom margin of the content and the idea bar rise by the safe area too", async () => {
    show();

    const form = await screen.findByRole("form", { name: "Noter une idée" });
    expect(form.parentElement?.className).toContain("safe-area-inset-bottom");
    const content = (await screen.findByRole("main")).closest(
      "div.min-h-screen",
    );
    expect(content?.className).toContain("safe-area-inset-bottom");
  });

  it("given the idea panel full screen, when it opens, then it keeps the safe area clear below its content", async () => {
    show();

    fireEvent.click((await phoneNav()).getByRole("button", { name: /Idée/ }));
    const panel = await screen.findByRole("dialog", { name: "Noter une idée" });
    expect(panel.className).toContain("safe-area-inset-bottom");
  });
});

describe("decision 084 B2: the Menu tab and its window", () => {
  it("given the phone nav, when it renders, then Menu is the fifth tab, after Projets, a closed button with aria-haspopup dialog", async () => {
    show();

    const nav = await phoneNav();
    const tabs = nav.getAllByRole("link").concat(nav.getAllByRole("button"));
    expect(tabs).toHaveLength(5);
    const menu = nav.getByRole("button", { name: /Menu/ });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(menu.getAttribute("aria-haspopup")).toBe("dialog");
    const projectsTab = nav.getByRole("link", { name: /Projets/ });
    expect(
      projectsTab.compareDocumentPosition(menu) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given the Menu tab, when I press it, then a dialog named Menu opens, the tab is expanded and the dialog has a Fermer button", async () => {
    show();

    const menu = await openMenu();

    expect(menu.getByRole("button", { name: "Fermer" })).toBeDefined();
    expect((await menuTab()).getAttribute("aria-expanded")).toBe("true");
  });

  it("given the open menu, when I read it, then it holds what the sidebar holds, Chercher to Se déconnecter and the version", async () => {
    show("/", { forYou: [] });

    const menu = await openMenu();
    const href = (name: RegExp) =>
      menu.getByRole("link", { name }).getAttribute("href");
    expect(menu.getByRole("button", { name: /^Chercher/ })).toBeDefined();
    expect(href(/^Accueil/)).toBe("/");
    expect(href(/^Claude/)).toBe("/claude");
    expect(href(/Cette nuit/)).toBe("/nuit");
    expect(href(/hello/)).toBe("/projets/5");
    expect(href(/^Tous les projets/)).toBe("/projets");
    expect(href(/Importer un repo/)).toBe("/projets");
    expect(href(/^Équipes d'agents/)).toBe("/equipes");
    expect(href(/^Journal/)).toBe("/journal");
    expect(href(/^Réglages/)).toBe("/reglages");
    expect(await menu.findByText(/octocat/)).toBeDefined();
    expect(menu.getByRole("button", { name: "Se déconnecter" })).toBeDefined();
    expect(await menu.findByText("Cockpit v0.1.0")).toBeDefined();
  });

  it("given the open menu, when I read its rows, then each link and button is at least 44 px tall", async () => {
    show();

    const menu = await openMenu();
    await menu.findByText("Cockpit v0.1.0");
    const rows = [
      ...menu.getAllByRole("link"),
      menu.getByRole("button", { name: /^Chercher/ }),
      menu.getByRole("button", { name: "Se déconnecter" }),
      menu.getByRole("button", { name: "Fermer" }),
    ];
    for (const row of rows) expect(row.className).toMatch(tall);
  });

  it("given the open menu, when I press Fermer, Escape or the back gesture, then the window closes", async () => {
    show();

    let menu = await openMenu();
    fireEvent.click(menu.getByRole("button", { name: "Fermer" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull(),
    );

    menu = await openMenu();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Menu" }), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull(),
    );

    await openMenu();
    fireEvent(screen.getByRole("dialog", { name: "Menu" }), new Event("close"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull(),
    );
  });
});

describe("decision 084 B3: touching a row of the menu", () => {
  it("given the open menu, when I touch Réglages, then the menu closes and the page of Réglages opens", async () => {
    show();

    const menu = await openMenu();
    fireEvent.click(menu.getByRole("link", { name: /^Réglages/ }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull(),
    );
    expect(window.location.pathname).toBe("/reglages");
  });

  it("given the open menu, when I touch Journal, then the menu closes and the Journal opens", async () => {
    show();

    const menu = await openMenu();
    fireEvent.click(menu.getByRole("link", { name: /^Journal/ }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull(),
    );
    expect(window.location.pathname).toBe("/journal");
  });

  it("given the open menu, when I touch Chercher, then the menu closes and the search window opens", async () => {
    show();

    const menu = await openMenu();
    fireEvent.click(menu.getByRole("button", { name: /^Chercher/ }));

    expect(
      await screen.findByRole("dialog", { name: "Chercher" }),
    ).toBeDefined();
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });
});

describe("decision 084 B4: the Menu tab in white", () => {
  it("given the open menu, when I look at the bar, then Menu is the white tab and the page's own tab is not", async () => {
    show();

    await openMenu();

    const nav = await phoneNav();
    expect((await menuTab()).className).toContain("text-foreground");
    expect(nav.getByRole("link", { name: /Accueil/ }).className).toContain(
      "text-muted-foreground",
    );
  });

  it.each(["/claude", "/equipes", "/journal", "/reglages"])(
    "given the page %s that only the menu reaches, when it renders, then Menu is white with aria-current page",
    async (path) => {
      show(path);

      const menu = await menuTab();
      expect(menu.getAttribute("aria-current")).toBe("page");
      expect(menu.className).toContain("text-foreground");
    },
  );

  it("given a menu-only page, when the idea panel opens, then Menu is no longer white", async () => {
    show("/reglages");

    fireEvent.click((await phoneNav()).getByRole("button", { name: /Idée/ }));
    await screen.findByRole("dialog", { name: "Noter une idée" });
    const menu = await menuTab();
    expect(menu.className).toContain("text-muted-foreground");
    expect(menu.className).not.toContain("text-foreground");
  });

  it.each(["/", "/nuit", "/projets"])(
    "given the page %s that has its own tab, when it renders, then Menu is not current",
    async (path) => {
      show(path);

      const menu = await menuTab();
      expect(menu.getAttribute("aria-current")).toBeNull();
      expect(menu.className).toContain("text-muted-foreground");
    },
  );

  it("given the idea panel open with a draft, when I open the menu, then the panel closes and the draft comes back with the next Idée", async () => {
    show();

    fireEvent.click((await phoneNav()).getByRole("button", { name: /Idée/ }));
    const panel = await screen.findByRole("dialog", { name: "Noter une idée" });
    fireEvent.change(within(panel).getByRole("textbox", { name: "Titre" }), {
      target: { value: "mon brouillon" },
    });

    await openMenu();
    expect(screen.queryByRole("dialog", { name: "Noter une idée" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull(),
    );
    fireEvent.click((await phoneNav()).getByRole("button", { name: /Idée/ }));
    const again = await screen.findByRole("dialog", { name: "Noter une idée" });
    expect(
      (
        within(again).getByRole("textbox", {
          name: "Titre",
        }) as HTMLInputElement
      ).value,
    ).toBe("mon brouillon");
  });
});

describe("decision 084 B5: the morning to read", () => {
  it("given a night block waiting in GET /api/home, when the shell renders, then the Nuit tab has a green dot and is named « Nuit, bilan à lire »", async () => {
    show("/", { night });

    const tab = (await phoneNav()).getByRole("link", {
      name: "Nuit, bilan à lire",
    });
    expect(tab.getAttribute("href")).toBe("/nuit");
    expect(tab.querySelector(".bg-done")).not.toBeNull();
  });

  it("given no night block, when the shell renders, then the Nuit tab is named Nuit and has no dot", async () => {
    show();

    const tab = (await phoneNav()).getByRole("link", { name: "Nuit" });
    expect(tab.querySelector(".bg-done")).toBeNull();
  });
});

describe("decision 084 B6: above md nothing changes", () => {
  it("given the shell, when it renders, then the bar is hidden from md, the sidebar shows from md and the menu is closed", async () => {
    show();

    const nav = await screen.findByRole("navigation", {
      name: "Navigation du téléphone",
    });
    expect(nav.className).toContain("md:hidden");
    const side = screen.getByRole("complementary", { name: "Barre latérale" });
    expect(side.className).toContain("md:flex");
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });
});
