// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 15.1 (decision 071 B): the bottom bar of the phone. jsdom has no layout, so the visibility is read on the responsive classes.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const projects = [{ id: 5, name: "octocat/hello", state: "idle" }];
const phoneNav = async () =>
  within(
    await screen.findByRole("navigation", { name: "Navigation du téléphone" }),
  );

describe("slice 15.1: the phone navigation", () => {
  it("given a logged-in user on /nuit, when the shell renders, then the phone nav holds Accueil, Idée, Nuit, Projets and Menu with the current page marked, the sidebar hidden below md and the nav hidden from md", async () => {
    stubShell({ projects });
    renderAt("/nuit");

    const nav = await phoneNav();
    expect(
      nav.getByRole("link", { name: /Accueil/ }).getAttribute("href"),
    ).toBe("/");
    expect(nav.getByRole("button", { name: /Idée/ })).toBeDefined();
    const night = nav.getByRole("link", { name: /Nuit/ });
    expect(night.getAttribute("href")).toBe("/nuit");
    expect(night.getAttribute("aria-current")).toBe("page");
    expect(
      nav.getByRole("link", { name: /Projets/ }).getAttribute("href"),
    ).toBe("/projets");
    expect(
      nav.getByRole("link", { name: /Accueil/ }).getAttribute("aria-current"),
    ).toBeNull();
    // Decision 083 B2: the fifth tab, a button, opens the full-screen menu.
    expect(nav.getByRole("button", { name: /Menu/ })).toBeDefined();
    expect(
      nav.getAllByRole("link").length + nav.getAllByRole("button").length,
    ).toBe(5);

    const side = screen.getByRole("complementary", { name: "Barre latérale" });
    expect(side.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(side.className).toContain("md:flex");
    expect(
      screen.getByRole("navigation", { name: "Navigation du téléphone" })
        .className,
    ).toContain("md:hidden");
  });
});
