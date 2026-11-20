// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addErgonomics, NO_RESULTS } from "./test-ergonomics.tsx";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Ticket #47 (US 52): Coût and Tâches programmées are reached from the navigation, not only from the Claude page.

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

const start = () => {
  stubShell({ projects: [{ ...PROJECT, state: "idle" }] });
  addErgonomics({ search: NO_RESULTS });
  renderAt("/");
};

describe("US 52 criterion 1: the sidebar", () => {
  it("given the sidebar, when I look at the Claude section, then Coût and Tâches programmées are there", async () => {
    start();

    const side = within(
      await screen.findByRole("complementary", { name: "Barre latérale" }),
    );
    expect(side.getByRole("link", { name: /^Coût/ }).getAttribute("href")).toBe(
      "/claude/cout",
    );
    expect(
      side
        .getByRole("link", { name: /^Tâches programmées/ })
        .getAttribute("href"),
    ).toBe("/claude/taches");
  });
});

describe("US 52 criterion 2: the phone menu", () => {
  it("given the phone menu, when I open it, then Coût and Tâches programmées are there", async () => {
    start();

    const nav = within(
      await screen.findByRole("navigation", {
        name: "Navigation du téléphone",
      }),
    );
    fireEvent.click(nav.getByRole("button", { name: /Menu/ }));
    const menu = within(await screen.findByRole("dialog", { name: "Menu" }));

    expect(menu.getByRole("link", { name: /^Coût/ }).getAttribute("href")).toBe(
      "/claude/cout",
    );
    expect(
      menu
        .getByRole("link", { name: /^Tâches programmées/ })
        .getAttribute("href"),
    ).toBe("/claude/taches");
  });
});

describe("US 52 criterion 3: the Ctrl K search", () => {
  it.each([
    ["coût", /Coût/, "/claude/cout"],
    ["tâches", /Tâches programmées/, "/claude/taches"],
  ])(
    "given the search, when I type « %s », then the action that opens the page appears",
    async (text, name, path) => {
      start();
      await screen.findByRole("complementary", { name: "Barre latérale" });

      fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
      const d = await screen.findByRole("dialog", { name: "Chercher" });
      fireEvent.change(within(d).getByRole("combobox"), {
        target: { value: text },
      });
      fireEvent.click(await within(d).findByRole("option", { name }));

      await waitFor(() => expect(window.location.pathname).toBe(path));
    },
  );
});
