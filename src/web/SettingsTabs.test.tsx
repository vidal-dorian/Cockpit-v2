// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 028 H, I: Réglages in four tabs, and no more « Adresse publique ».
//
// Pinned choices (the decision leaves them open):
// - The tabs are links inside a <nav aria-label="Réglages">: « Connecter Claude » (/reglages), « Jetons MCP »
//   (/reglages/jetons), « Utilisateurs » (/reglages/utilisateurs, administrator only) and
//   « Écriture automatique des US » (/reglages/ecriture-us). The open one has aria-current="page", the others have none.
// - A section is told by its heading: « Connecter Claude », « Jetons MCP », « Utilisateurs », « Écrire les US automatiquement ».
// - A non-administrator on /reglages/utilisateurs reads « Cette page est réservée à l'administrateur. » and /api/settings/users
//   is never requested. /api/settings/public-url is never requested by any tab.

const RESERVED = "Cette page est réservée à l'administrateur.";

type Call = { method: string; path: string };

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

/** A small fake server behind fetch; any route the page should not need fails the test loudly. */
function stubApi(isAdmin: boolean) {
  const calls: Call[] = [];
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
      calls.push({ method, path });

      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin,
        });
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/me/tokens" && method === "GET")
        return Response.json({ tokens: [] });
      if (path === "/api/me/connect" && method === "GET")
        return Response.json({
          mcpUrl: "https://cockpit.example.com/mcp",
          connected: false,
          connectedAt: null,
          client: null,
        });
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      if (path === "/api/settings/users" && method === "GET")
        return isAdmin
          ? Response.json({ users: [] })
          : Response.json({ error: "Forbidden" }, { status: 403 });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const heading = (name: string) =>
  screen.queryByRole("heading", { level: 2, name });

const TABS = {
  claude: "Connecter Claude",
  tokens: "Jetons MCP",
  users: "Utilisateurs",
  routine: "Écriture automatique des US",
};
const HREFS: Record<string, string> = {
  [TABS.claude]: "/reglages",
  [TABS.tokens]: "/reglages/jetons",
  [TABS.users]: "/reglages/utilisateurs",
  [TABS.routine]: "/reglages/ecriture-us",
};
const SECTIONS: Record<string, string> = {
  [TABS.claude]: "Connecter Claude",
  [TABS.tokens]: "Jetons MCP",
  [TABS.users]: "Utilisateurs",
  [TABS.routine]: "Écrire les US automatiquement",
};

/** The tabs: the links of the nav « Réglages ». */
async function tabNav() {
  const nav = await screen.findByRole("navigation", { name: "Réglages" });
  const link = (name: string) => {
    const found = [...nav.querySelectorAll("a")].find(
      (a) => a.textContent?.trim() === name,
    );
    return found ?? null;
  };
  return { nav, link };
}

describe("Réglages, the four tabs (decision 028 H)", () => {
  it("given an administrator, when /reglages loads, then the nav « Réglages » links Connecter Claude, Jetons MCP, Utilisateurs and Écriture automatique des US to their routes, Connecter Claude being the open one", async () => {
    stubApi(true);

    renderAt("/reglages");

    const { link } = await tabNav();
    for (const [name, href] of Object.entries(HREFS)) {
      const tab = link(name);
      expect(tab, `the tab ${name}`).not.toBeNull();
      expect(tab?.getAttribute("href")).toBe(href);
      expect(tab?.getAttribute("aria-current")).toBe(
        name === TABS.claude ? "page" : null,
      );
    }
  });

  it.each([
    [TABS.tokens, "/reglages/jetons"],
    [TABS.users, "/reglages/utilisateurs"],
    [TABS.routine, "/reglages/ecriture-us"],
  ])(
    "given an administrator, when %s is the route %s, then that tab alone is marked open",
    async (open, path) => {
      stubApi(true);

      renderAt(path);

      const { link } = await tabNav();
      for (const name of Object.values(TABS))
        expect(link(name)?.getAttribute("aria-current")).toBe(
          name === open ? "page" : null,
        );
    },
  );

  it("given an administrator, when /reglages loads, then only the section Connecter Claude is shown", async () => {
    const calls = stubApi(true);

    renderAt("/reglages");

    expect(
      await screen.findByRole("heading", { name: "Connecter Claude" }),
    ).toBeDefined();
    expect(heading("Jetons MCP")).toBeNull();
    expect(heading("Utilisateurs")).toBeNull();
    expect(heading("Écrire les US automatiquement")).toBeNull();
    expect(calls.some((c) => c.path === "/api/settings/users")).toBe(false);
    expect(calls.some((c) => c.path === "/api/me/routine")).toBe(false);
  });

  it.each([
    [TABS.tokens, "/reglages/jetons"],
    [TABS.users, "/reglages/utilisateurs"],
    [TABS.routine, "/reglages/ecriture-us"],
  ])(
    "given an administrator, when %s is open at %s, then only its own section is shown",
    async (tab, path) => {
      stubApi(true);

      renderAt(path);

      expect(
        await screen.findByRole("heading", { name: SECTIONS[tab] }),
      ).toBeDefined();
      for (const [other, name] of Object.entries(SECTIONS))
        if (other !== tab) expect(heading(name), `${name} hidden`).toBeNull();
    },
  );

  it("given an administrator on /reglages, when the tab Jetons MCP is clicked, then the route changes and the section replaces the previous one", async () => {
    stubApi(true);
    renderAt("/reglages");
    const { link } = await tabNav();
    await screen.findByRole("heading", { name: "Connecter Claude" });

    fireEvent.click(link(TABS.tokens) as HTMLElement);

    expect(
      await screen.findByRole("heading", { name: "Jetons MCP" }),
    ).toBeDefined();
    expect(window.location.pathname).toBe("/reglages/jetons");
    expect(heading("Connecter Claude")).toBeNull();
    expect(link(TABS.tokens)?.getAttribute("aria-current")).toBe("page");
  });

  it("given a user who is not an administrator, when /reglages loads, then the tab Utilisateurs is not shown but the three others are", async () => {
    stubApi(false);

    renderAt("/reglages");

    const { link } = await tabNav();
    await screen.findByRole("heading", { name: "Connecter Claude" });
    expect(link(TABS.users)).toBeNull();
    for (const name of [TABS.claude, TABS.tokens, TABS.routine])
      expect(link(name), name).not.toBeNull();
  });

  it("given a user who is not an administrator, when /reglages/utilisateurs is opened, then it reads that the page is reserved to the administrator and the list of the users is never requested", async () => {
    const calls = stubApi(false);

    renderAt("/reglages/utilisateurs");

    expect(await screen.findByText(RESERVED)).toBeDefined();
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/me")).toBe(true),
    );
    expect(heading("Utilisateurs")).toBeNull();
    expect(calls.some((c) => c.path === "/api/settings/users")).toBe(false);
  });
});

describe("Réglages, no more public address (decision 028 I)", () => {
  it.each([
    ["an administrator", true, "/reglages"],
    ["an administrator", true, "/reglages/jetons"],
    ["an administrator", true, "/reglages/utilisateurs"],
    ["an administrator", true, "/reglages/ecriture-us"],
    ["a user who is not an administrator", false, "/reglages"],
    ["a user who is not an administrator", false, "/reglages/jetons"],
    ["a user who is not an administrator", false, "/reglages/ecriture-us"],
  ])(
    "given %s (administrator: %s), when %s is opened, then there is no section Adresse publique and /api/settings/public-url is never requested",
    async (_who, isAdmin, path) => {
      const calls = stubApi(isAdmin);

      renderAt(path);

      await tabNav();
      await waitFor(() =>
        expect(calls.some((c) => c.path === "/api/me")).toBe(true),
      );
      // Let the sections of the tab settle before looking for what must not be there.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(heading("Adresse publique")).toBeNull();
      expect(screen.queryByText(/Adresse publique/)).toBeNull();
      expect(calls.some((c) => c.path === "/api/settings/public-url")).toBe(
        false,
      );
    },
  );
});
