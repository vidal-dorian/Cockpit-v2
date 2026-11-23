// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";
import { stubBar } from "./test-tickets-full.tsx";

// Decision 084 B (amendment): while a text field has focus the phone bar is not rendered. On iOS a fixed bottom bar stays offset by the keyboard height once the keyboard is dismissed; putting the bar back when focus leaves lays it out again at the real bottom. jsdom has no keyboard: these tests prove the bar hides while a text field has focus and comes back after, the real behaviour is checked on the phone.

afterEach(() => {
  cleanup();
  document.body.querySelectorAll("[data-test-field]").forEach((n) => {
    n.remove();
  });
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const projects = [{ id: 5, name: "octocat/hello", state: "idle" }];
const NAV = { name: "Navigation du téléphone" };

async function shellReady() {
  stubShell({ projects });
  renderAt("/nuit");
  await screen.findByRole("navigation", NAV);
}

function field<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  set?: (el: HTMLElementTagNameMap[K]) => void,
) {
  const el = document.createElement(tag);
  el.setAttribute("data-test-field", "");
  set?.(el);
  document.body.appendChild(el);
  return el;
}
const focus = (el: HTMLElement) => act(() => el.focus());
const blur = (el: HTMLElement) => act(() => el.blur());
const barShown = () => screen.queryByRole("navigation", NAV) !== null;

describe("decision 084 B: the phone bar while the keyboard is up", () => {
  it("given the phone bar shown, when a textarea gets focus, then the bar is hidden", async () => {
    await shellReady();
    focus(field("textarea"));
    expect(barShown()).toBe(false);
  });

  it("given the phone bar shown, when a text input gets focus, then the bar is hidden", async () => {
    await shellReady();
    focus(field("input", (i) => (i.type = "text")));
    expect(barShown()).toBe(false);
  });

  it("given the phone bar shown, when a contenteditable element gets focus, then the bar is hidden", async () => {
    await shellReady();
    focus(
      field("div", (d) => {
        d.setAttribute("contenteditable", "true");
        d.tabIndex = 0;
      }),
    );
    expect(barShown()).toBe(false);
  });

  it("given the phone bar shown, when a checkbox gets focus, then the bar stays", async () => {
    await shellReady();
    focus(field("input", (i) => (i.type = "checkbox")));
    expect(barShown()).toBe(true);
  });

  it("given the phone bar shown, when a select gets focus, then the bar stays", async () => {
    await shellReady();
    focus(field("select"));
    expect(barShown()).toBe(true);
  });

  it("given a text field with focus and the bar hidden, when focus leaves the field, then the bar is back", async () => {
    await shellReady();
    const area = field("textarea");
    focus(area);
    expect(barShown()).toBe(false);
    blur(area);
    expect(barShown()).toBe(true);
  });

  it("given a text field with focus and the bar hidden, when focus moves to another text field, then the bar stays hidden", async () => {
    await shellReady();
    const first = field("textarea");
    const second = field("input", (i) => (i.type = "text"));
    focus(first);
    focus(second);
    expect(barShown()).toBe(false);
    blur(second);
    expect(barShown()).toBe(true);
  });
});

// Decision 084 B4 (amendment of 2026-11-19): no exception for the idea panel. While its title (autofocused) or any field has focus the bar is hidden, under the keyboard anyway; it returns when focus leaves, and closing the panel opened from the phone Idée tab puts focus back on that tab.
describe("decision 084 B4: the phone bar around the idea panel", () => {
  const tabIdee = () =>
    within(screen.getByRole("navigation", NAV)).getByRole("button", {
      name: /Idée/,
    });
  const panel = async () =>
    within(await screen.findByRole("dialog", { name: "Noter une idée" }));

  async function openFromTab() {
    stubBar();
    renderAt("/");
    await screen.findByRole("navigation", NAV);
    const opener = tabIdee();
    opener.focus();
    fireEvent.click(opener);
    return { opener, p: await panel() };
  }

  it("given the panel opened from the Idée tab, when its title has focus, then the bar is hidden", async () => {
    const { p } = await openFromTab();
    act(() => p.getByRole("textbox", { name: "Titre" }).focus());
    expect(barShown()).toBe(false);
  });

  it("given a field of the panel with focus, when focus leaves it for a button of the panel, then the bar is back", async () => {
    const { p } = await openFromTab();
    act(() => p.getByRole("textbox", { name: "Titre" }).focus());
    expect(barShown()).toBe(false);
    act(() => p.getByRole("button", { name: "Annuler" }).focus());
    expect(barShown()).toBe(true);
  });

  it("given the panel opened from the Idée tab and its title typed in, when Annuler is pressed, then the bar is back and its Idée tab has the focus", async () => {
    const { p } = await openFromTab();
    act(() => p.getByRole("textbox", { name: "Titre" }).focus());
    expect(barShown()).toBe(false);
    fireEvent.click(p.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tabIdee()));
  });

  it("given the panel opened from the Idée tab and its title typed in, when Noter succeeds, then the bar is back and its Idée tab has the focus", async () => {
    const { p } = await openFromTab();
    const title = p.getByRole("textbox", { name: "Titre" });
    act(() => title.focus());
    expect(barShown()).toBe(false);
    fireEvent.change(title, { target: { value: "ranger" } });
    fireEvent.click(p.getByRole("button", { name: /^Noter/ }));
    await screen.findByText(/Idée notée dans hello/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(barShown()).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(tabIdee()));
  });
});
