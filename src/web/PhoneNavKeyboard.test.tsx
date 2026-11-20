// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

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

// Decision 084 B4 (amendment): the idea panel keeps the bar rendered while its fields have focus, but when focus leaves them the bar's <nav> is created again, so iOS lays it out at the real bottom.
describe("decision 084 B: the phone bar around the idea panel", () => {
  const getNav = () => screen.getByRole("navigation", NAV);

  function panel() {
    const box = document.createElement("div");
    box.setAttribute("data-test-field", "");
    box.setAttribute("data-keeps-phone-nav", "");
    document.body.appendChild(box);
    const add = <K extends "input" | "textarea">(tag: K) => {
      const el = document.createElement(tag);
      box.appendChild(el);
      return el;
    };
    return { box, add };
  }
  const leave = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });

  it("given the phone bar shown, when a field of the idea panel gets focus, then the bar stays with Idée, Nuit and Menu", async () => {
    await shellReady();
    focus(panel().add("input"));
    expect(barShown()).toBe(true);
    const nav = getNav();
    expect(nav.textContent).toContain("Nuit");
    expect(nav.textContent).toContain("Menu");
  });

  it("given a field of the idea panel with focus, when focus leaves it for the page, then the bar is a new element, still rendered", async () => {
    await shellReady();
    const input = panel().add("input");
    focus(input);
    const before = getNav();
    blur(input);
    expect(barShown()).toBe(true);
    expect(getNav()).not.toBe(before);
    expect(before.isConnected).toBe(false);
    expect(getNav().textContent).toContain("Nuit");
    expect(getNav().textContent).toContain("Menu");
  });

  it("given a field of the idea panel with focus, when the field is removed (panel closed), then the bar is a new element, still rendered", async () => {
    await shellReady();
    const { box, add } = panel();
    const input = add("input");
    focus(input);
    const before = getNav();
    leave(input);
    act(() => box.remove());
    expect(barShown()).toBe(true);
    expect(getNav()).not.toBe(before);
    expect(getNav().textContent).toContain("Menu");
  });

  it("given a field of the idea panel with focus, when focus moves to another field of the same panel, then the bar is the same element", async () => {
    await shellReady();
    const { add } = panel();
    const first = add("input");
    const second = add("textarea");
    focus(first);
    const before = getNav();
    focus(second);
    expect(getNav()).toBe(before);
    expect(before.isConnected).toBe(true);
  });

  it("given a field of the idea panel with focus, when focus moves to a field outside the panel, then the bar is hidden", async () => {
    await shellReady();
    const input = panel().add("input");
    focus(input);
    focus(field("textarea"));
    expect(barShown()).toBe(false);
  });

  it("given a field of the idea panel with focus, when the Nuit tab is tapped, then the tap navigates and the bar is re-created after it", async () => {
    await shellReady();
    window.history.replaceState({}, "", "/");
    const input = panel().add("input");
    focus(input);
    const before = getNav();
    const nuit = screen.getByRole("link", { name: /Nuit/ });
    const fire = (type: string) =>
      act(() => void nuit.dispatchEvent(new Event(type, { bubbles: true })));
    // Touch order: the compatibility mouse events come after pointerup and touchend.
    fire("pointerdown");
    fire("pointerup");
    fire("touchend");
    fire("mousedown");
    act(() => {
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(getNav()).toBe(before);
    act(() => nuit.click());
    fire("mouseup");
    await act(() => new Promise((r) => setTimeout(r)));
    expect(window.location.pathname).toBe("/nuit");
    expect(getNav()).not.toBe(before);
  });

  it("given the panel opened from the Idée tab, when Annuler is pressed (mousedown, focusout, click, mouseup elsewhere), then the new bar's Idée tab has focus", async () => {
    await shellReady();
    const input = panel().add("input");
    focus(input);
    const fire = (el: Element, type: string) =>
      act(() => void el.dispatchEvent(new Event(type, { bubbles: true })));
    const idee = () => screen.getByRole("button", { name: /Idée/ });
    const old = idee();
    fire(old, "mousedown");
    act(() => {
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: old }),
      );
    });
    // The panel closes and hands focus back to its opener.
    focus(old);
    fire(document.body, "mouseup");
    await act(() => new Promise((r) => setTimeout(r)));
    expect(old.isConnected).toBe(false);
    expect(document.activeElement).toBe(idee());
  });
});
