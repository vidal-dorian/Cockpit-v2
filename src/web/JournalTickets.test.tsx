// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Journal page, the ticket actions", () => {
  it("given entries for a ticket created, edited and deleted, when /journal loads, then each row says its action in French and none shows the internal code", async () => {
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
            entries: ["delete_ticket", "update_ticket", "create_ticket"].map(
              (action, i) => ({
                id: 3 - i,
                at: `2026-10-22T12:0${3 - i}:00.000Z`,
                actor: "human",
                origin: "ui",
                action,
                result: "ok",
              }),
            ),
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
    await screen.findByText(/Ticket créé/);
    expect(screen.getByText(/Ticket modifié/)).toBeDefined();
    expect(screen.getByText(/Ticket supprimé/)).toBeDefined();
    expect(screen.queryByText(/_ticket/)).toBeNull();
  });
});
