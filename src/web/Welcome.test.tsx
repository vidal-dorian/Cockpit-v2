// @vitest-environment jsdom
import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 1.6, decision 012 H: welcome page and "App not installed" banner.

const INSTALL_URL = "https://github.com/apps/cockpit-test/installations/new";

type Installation = Response | Error;

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
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

/** A small fake server behind fetch; `installation` is what GET /api/installation answers. */
function stubApi(installation: Installation) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      calls.push(`${method} ${path}`);
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "alice",
          name: "Alice",
          avatarUrl: null,
          isAdmin: false,
        });
      if (path === "/api/installation") {
        if (installation instanceof Error) throw installation;
        return installation.clone();
      }
      if (path === "/api/projects") return Response.json({ projects: [] });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: INSTALL_URL,
          installed: false,
          repositories: [],
        });
      if (path === "/api/history") return Response.json({ entries: [] });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

const notInstalled = () =>
  Response.json({ installed: false, installUrl: INSTALL_URL });
const installed = () =>
  Response.json({ installed: true, installUrl: INSTALL_URL });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("page /bienvenue", () => {
  it("given a user who has not installed the App, when /bienvenue loads, then it welcomes them and explains what the installation does and what will not work without it", async () => {
    stubApi(notInstalled());

    renderAt("/bienvenue");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /^Bienvenue dans Cockpit/,
      }),
    ).toBeDefined();
    const page = screen.getByRole("main").textContent ?? "";
    for (const lost of [
      /import/i,
      /bilan de santé/i,
      /issues/i,
      /suivi des PR et de la CI/i,
      /préparation des repos/i,
    ])
      expect(page, String(lost)).toMatch(lost);
    // What stays available without the App.
    expect(page).toContain("Journal");
    expect(page).toContain("Réglages");
  });

  it("given the installation URL from /api/installation, when /bienvenue loads, then Installer Cockpit sur mon compte GitHub links to it", async () => {
    stubApi(notInstalled());

    renderAt("/bienvenue");

    const link = await screen.findByRole("link", {
      name: "Installer Cockpit sur mon compte GitHub",
    });
    expect(link.getAttribute("href")).toBe(INSTALL_URL);
  });

  it("given /bienvenue, when Plus tard is chosen, then it goes to /", async () => {
    stubApi(notInstalled());
    renderAt("/bienvenue");
    const later = (await screen.findByText("Plus tard")).closest("a, button");
    assert(later, "Plus tard must be a link or a button");

    if (later.tagName === "A") {
      expect(later.getAttribute("href")).toBe("/");
    } else {
      fireEvent.click(later);
      await waitFor(() => expect(window.location.pathname).toBe("/"));
    }
  });

  it("given /bienvenue, when it loads, then the banner is not shown (the page says it already)", async () => {
    const calls = stubApi(notInstalled());

    renderAt("/bienvenue");

    await screen.findByRole("heading", { name: /^Bienvenue dans Cockpit/ });
    await waitFor(() => expect(calls).toContain("GET /api/installation"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link", { name: "Installer" })).toBeNull();
  });
});

describe("banner: the App is not installed", () => {
  it.each([
    ["/", "Cockpit v0.1.0"],
    ["/projets", "Mes projets"],
    ["/journal", "Journal"],
  ])(
    "given the App is not installed, when %s loads, then a status banner says so and offers Installer, linking to the install URL",
    async (path, pageMarker) => {
      stubApi(notInstalled());

      renderAt(path);

      const banner = await screen.findByRole("status");
      expect(banner.textContent).toMatch(/install/i);
      const install = within(banner).getByRole("link", { name: "Installer" });
      expect(install.getAttribute("href")).toBe(INSTALL_URL);
      expect(await screen.findAllByText(pageMarker)).not.toHaveLength(0);
    },
  );

  it("given the App is installed, when the home page loads, then there is no banner", async () => {
    const calls = stubApi(installed());

    renderAt("/");

    await screen.findByText("Cockpit v0.1.0");
    await waitFor(() => expect(calls).toContain("GET /api/installation"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link", { name: "Installer" })).toBeNull();
  });

  it.each([
    [
      "answers 502",
      () => Response.json({ error: "github_unavailable" }, { status: 502 }),
    ],
    ["cannot be reached", () => new TypeError("Failed to fetch")],
  ])(
    "given the installation check %s, when the home page loads, then there is no banner",
    async (_name, failure) => {
      const calls = stubApi(failure());

      renderAt("/");

      await screen.findByText("Cockpit v0.1.0");
      await waitFor(() => expect(calls).toContain("GET /api/installation"));
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("link", { name: "Installer" })).toBeNull();
    },
  );
});
