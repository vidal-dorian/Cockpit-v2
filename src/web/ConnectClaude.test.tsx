// @vitest-environment jsdom
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

// Decision 021 G: the « Connecter Claude » section at the top of Réglages, three steps.
//
// Pinned choice: the page reads the address and the connection from GET /api/me/connect, answering
// { mcpUrl, connected, connectedAt } (connectedAt: ISO date of the connection, null when none). The address is
// the public URL of the instance + /mcp: the tests make it differ from the address the visitor typed
// (detectedUrl), so a page that builds it from window.location fails.

type Connect = {
  mcpUrl: string;
  connected: boolean;
  connectedAt: string | null;
  client: "claude.ai" | "Claude Code" | null;
};

const MCP_URL = "https://cockpit.example.com/mcp";
const COMMAND = `claude mcp add --transport http cockpit ${MCP_URL}`;
const NOT_CONNECTED: Connect = {
  mcpUrl: MCP_URL,
  connected: false,
  connectedAt: null,
  client: null,
};
const CONNECTED_AT = "2026-10-28T10:00:00.000Z";

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

/** A small fake server behind fetch; `isAdmin` shows the Utilisateurs section too. */
function stubApi(connect: Connect | "fails", isAdmin = false) {
  const paths: string[] = [];
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
      paths.push(`${method} ${path}`);

      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
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
      if (path === "/api/settings/users")
        return isAdmin
          ? Response.json({ users: [] })
          : Response.json({ error: "Forbidden" }, { status: 403 });
      if (path === "/api/me/tokens" && method === "GET")
        return Response.json({ tokens: [] });
      if (path === "/api/me/connect" && method === "GET")
        return connect === "fails"
          ? Response.json({ error: "boom" }, { status: 500 })
          : Response.json(connect);
      // Decision 022: the section « Écrire les US automatiquement » has its own tests (RoutineSettings.test.tsx): nothing connected here.
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return paths;
}

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** The section, found by its heading. */
async function connectSection() {
  const heading = await screen.findByRole("heading", {
    name: "Connecter Claude",
  });
  const section = heading.closest("section");
  expect(section, "the heading must be inside a section").not.toBeNull();
  return { heading, section: section as HTMLElement };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState({}, "", "/");
});

describe("Réglages page, the section Connecter Claude", () => {
  it("given a user, when /reglages loads, then the section Connecter Claude comes first, before Jetons MCP", async () => {
    stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { heading } = await connectSection();
    const tokens = await screen.findByRole("heading", { name: "Jetons MCP" });
    expect(
      heading.compareDocumentPosition(tokens) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given an administrator, when /reglages loads, then the section Connecter Claude also comes before Utilisateurs", async () => {
    stubApi(NOT_CONNECTED, true);

    renderAt("/reglages");

    const { heading } = await connectSection();
    const users = await screen.findByRole("heading", { name: "Utilisateurs" });
    expect(
      heading.compareDocumentPosition(users) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given the public URL, when the section loads, then step 1 shows <publicUrl>/mcp as the API gives it, not the address of the page", async () => {
    const paths = stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { section } = await connectSection();
    const shown =
      within(section).queryByDisplayValue(MCP_URL) ??
      within(section).queryByText(MCP_URL);
    expect(shown, "the address must be shown on its own").not.toBeNull();
    expect(paths).toContain("GET /api/me/connect");
  });

  it("given step 1, when Copier l'adresse is clicked, then the address is written to the clipboard", async () => {
    const writeText = stubClipboard();
    stubApi(NOT_CONNECTED);
    renderAt("/reglages");
    const { section } = await connectSection();

    fireEvent.click(
      await within(section).findByRole("button", { name: "Copier l'adresse" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MCP_URL));
  });

  it("given step 2, when the section loads, then Ouvrir claude.ai is a link to the connectors page of claude.ai that opens in a new tab with rel noreferrer", async () => {
    stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { section } = await connectSection();
    const link = await within(section).findByRole("link", {
      name: "Ouvrir claude.ai",
    });
    expect(link.getAttribute("href")).toBe(
      "https://claude.ai/customize/connectors",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/\bnoreferrer\b/);
  });

  it("given step 3, when the section loads, then it tells the user to sign in and click Autoriser", async () => {
    stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { section } = await connectSection();
    await within(section).findByRole("button", { name: "Copier l'adresse" });
    expect(section.textContent).toContain("Autoriser");
    expect(section.textContent).toMatch(/Se connecter/);
  });

  it("given no connection yet, when the section loads, then it does not claim that Claude is connected", async () => {
    stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { section } = await connectSection();
    await within(section).findByRole("button", { name: "Copier l'adresse" });
    expect(section.textContent).not.toContain("Connecté depuis claude.ai");
  });

  it("given a connection, when the section loads, then it says « Connecté depuis claude.ai » with the date", async () => {
    stubApi({
      mcpUrl: MCP_URL,
      connected: true,
      connectedAt: CONNECTED_AT,
      client: "claude.ai",
    });

    renderAt("/reglages");

    const { section } = await connectSection();
    await waitFor(() =>
      expect(section.textContent).toContain("Connecté depuis claude.ai"),
    );
    expect(section.textContent).toContain(
      new Date(CONNECTED_AT).toLocaleDateString("fr-FR"),
    );
  });

  it("given the section, when it loads, then a collapsed <details> gives the Claude Code command and reminds that manual tokens remain possible", async () => {
    stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { section } = await connectSection();
    await within(section).findByRole("button", { name: "Copier l'adresse" });
    const details = section.querySelector("details");
    expect(details, "a <details> element in the section").not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(details?.textContent).toContain(COMMAND);
    expect(details?.textContent).toMatch(/jetons? manuels?/i);
  });

  it("given the section, when it loads, then the title of the collapsed part is exactly « Connecter Claude depuis le CLI Claude Code » (decision 023 F)", async () => {
    stubApi(NOT_CONNECTED);

    renderAt("/reglages");

    const { section } = await connectSection();
    await within(section).findByRole("button", { name: "Copier l'adresse" });
    const summary = section.querySelector("details > summary");
    expect(summary, "a <summary> in the <details>").not.toBeNull();
    expect(summary?.textContent?.trim()).toBe(
      "Connecter Claude depuis le CLI Claude Code",
    );
  });

  it("given a Claude Code connection, when the section loads, then it says « Connecté depuis Claude Code » and not claude.ai", async () => {
    stubApi({
      mcpUrl: MCP_URL,
      connected: true,
      connectedAt: CONNECTED_AT,
      client: "Claude Code",
    });

    renderAt("/reglages");

    const { section } = await connectSection();
    await waitFor(() =>
      expect(section.textContent).toContain("Connecté depuis Claude Code"),
    );
    expect(section.textContent).not.toContain("Connecté depuis claude.ai");
  });

  it("given the connection cannot be read (server error), when the section loads, then the alert is in French and shows neither HTTP nor the status", async () => {
    stubApi("fails");

    renderAt("/reglages");

    const { section } = await connectSection();
    const alert = await within(section).findByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(alert.textContent).not.toMatch(/HTTP|500/);
  });
});
