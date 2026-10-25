// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 4.2 (decisions 004, 010): what Claude does through the MCP server shows in the Journal, in French,
// and the row says it was Claude (origin "mcp") rather than the raw code "mcp".

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const claude = (id: number, action: string, result = "ok") => ({
  id,
  at: `2026-10-22T12:0${id}:00.000Z`,
  actor: "claude",
  origin: "mcp",
  action,
  result,
});

describe("Journal page, the MCP actions", () => {
  it("given entries made by Claude through the MCP server, when /journal loads, then each row names its action in French, says Claude, and shows no internal code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(raw, "http://localhost").pathname;
        if (path === "/api/setup/status")
          return Response.json({
            configured: true,
            detectedUrl: "http://localhost",
          });
        if (path === "/api/me")
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
        if (path === "/api/history")
          return Response.json({
            entries: [
              claude(7, "mcp_auth", "refused"),
              claude(6, "create_ticket"),
              claude(5, "get_ticket"),
              claude(4, "search"),
              claude(3, "get_project"),
              claude(2, "list_projects"),
              {
                id: 1,
                at: "2026-10-21T12:00:00.000Z",
                actor: "human",
                origin: "ui",
                action: "login",
                result: "ok",
              },
            ],
          });
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );
    window.history.replaceState({}, "", "/journal");

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Journal" });
    const rowOf = async (label: string) => {
      const row = (await screen.findByText(label)).closest("li");
      expect(row, `a row for ${label}`).not.toBeNull();
      return row as HTMLElement;
    };
    const auth = await rowOf("Connexion MCP refusée");
    await rowOf("Projets listés");
    await rowOf("Projet consulté");
    await rowOf("Recherche");
    await rowOf("Ticket consulté");
    await rowOf("Ticket créé");

    // The refusal is a refusal, whoever made it.
    expect(within(auth).getByText("Refusée")).toBeDefined();
    // Claude's six rows say so; the human row keeps its origin.
    expect(screen.getAllByText("Claude")).toHaveLength(6);
    expect(screen.getAllByText("Interface")).toHaveLength(1);
    const login = (await rowOf("Connexion")).textContent;
    expect(login).not.toMatch(/Claude/);
    expect(screen.queryByText("mcp")).toBeNull();
    expect(
      screen.queryByText(
        /mcp_auth|list_projects|get_project|get_ticket|create_ticket/,
      ),
    ).toBeNull();
  });

  it("given MCP entries whose action is not a known tool, when /journal loads, then each row reads Outil inconnu and never the raw name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(raw, "http://localhost").pathname;
        if (path === "/api/setup/status")
          return Response.json({
            configured: true,
            detectedUrl: "http://localhost",
          });
        if (path === "/api/me")
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
        if (path === "/api/history")
          return Response.json({
            entries: [
              claude(2, "unknown_tool", "refused"),
              claude(1, "delete_project", "refused"),
            ],
          });
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );
    window.history.replaceState({}, "", "/journal");

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Journal" });
    expect(await screen.findAllByText("Outil inconnu")).toHaveLength(2);
    expect(screen.queryByText(/delete_project|unknown_tool/)).toBeNull();
  });
});
