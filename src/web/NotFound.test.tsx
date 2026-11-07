// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("slice 9.3: the unknown path (S56)", () => {
  it("given a logged-in user, when the path is unknown, then the page says it does not exist and links back to the home", async () => {
    stubShell();
    renderAt("/nimporte-quoi");

    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("Cette page n'existe pas.");
    expect(h1.textContent).toContain("Elle a peut-être été déplacée.");
    const link = screen.getByRole("link", { name: "Retour à l'accueil" });
    expect(link.getAttribute("href")).toBe("/");
  });
});
