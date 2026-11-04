// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 028 D: the top bar. Pinned choices (the decision leaves them open):
// - The logo link is named « Cockpit » and goes to `/`; it is shown to everybody, logged in or not.
// - The main navigation is the <nav aria-label="Navigation principale"> with the links Accueil (/), Projets (/projets), Journal (/journal).
// - « Réglages » is a link (aria-label) to /reglages, shown only when /api/me knows the user; it is not inside the main navigation.

function renderAt(path: string, loggedIn: boolean) {
  window.history.replaceState({}, "", path);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const p = new URL(raw, "http://localhost").pathname;
      if (p === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (p === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (p === "/api/me")
        return loggedIn
          ? Response.json({
              login: "octocat",
              name: "The Octocat",
              avatarUrl: null,
            })
          : Response.json({ error: "Unauthorized" }, { status: 401 });
      if (p === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/x",
        });
      if (p === "/api/history")
        return Response.json({ entries: [], hasMore: false });
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("the top bar (decision 028 D)", () => {
  it.each(["/", "/journal"])(
    "given a logged-in user, when %s is displayed, then the bar has a Cockpit link to /, a Navigation principale with Accueil, Projets and Journal, and a Réglages link to /reglages",
    async (path) => {
      renderAt(path, true);

      const cockpit = await screen.findByRole("link", { name: "Cockpit" });
      expect(cockpit.getAttribute("href")).toBe("/");
      const nav = screen.getByRole("navigation", {
        name: "Navigation principale",
      });
      const links = within(nav).getAllByRole("link");
      expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual(
        [
          ["Accueil", "/"],
          ["Projets", "/projets"],
          ["Journal", "/journal"],
        ],
      );
      const settings = await screen.findByRole("link", { name: "Réglages" });
      expect(settings.getAttribute("href")).toBe("/reglages");
      expect(nav.contains(settings)).toBe(false);
    },
  );

  it("given a logged-out visitor, when the page is displayed, then the Cockpit link and the main navigation are there but no Réglages link", async () => {
    renderAt("/", false);

    const cockpit = await screen.findByRole("link", { name: "Cockpit" });
    expect(cockpit.getAttribute("href")).toBe("/");
    expect(
      screen.getByRole("navigation", { name: "Navigation principale" }),
    ).toBeDefined();
    await screen.findByRole("link", { name: "Se connecter avec GitHub" });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Réglages" })).toBeNull(),
    );
  });
});
