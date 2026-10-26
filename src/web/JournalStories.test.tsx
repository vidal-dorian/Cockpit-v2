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

// Slice 4.3 (decisions 010, 017 K): the three new tools of Claude are named in French in the Journal.
// The Journal shows no refusal reason (only Réussie / Refusée / Erreur), so the codes ticket_has_stories and
// ticket_abandoned have nothing to be translated into.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const claude = (id: number, action: string, result = "ok") => ({
  id,
  at: `2026-10-26T12:0${id}:00.000Z`,
  actor: "claude",
  origin: "mcp",
  action,
  result,
});

describe("criterion 17: the Journal and the story tools", () => {
  it("given entries of create_user_stories, get_user_story and list_tickets_needing_us, when /journal loads, then each row has a French label of its own (not Outil inconnu) and no internal code is shown", async () => {
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
              claude(3, "create_user_stories", "refused"),
              claude(2, "get_user_story"),
              claude(1, "list_tickets_needing_us"),
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
    const entries = () =>
      within(screen.getByRole("main")).getAllByRole("listitem");
    await waitFor(() => expect(entries()).toHaveLength(3));
    const rows = entries();
    const labels = rows.map(
      (row) => row.querySelector("span")?.textContent ?? "",
    );
    expect(labels.every((label) => label.trim() !== "")).toBe(true);
    expect(new Set(labels).size).toBe(3);
    expect(screen.queryByText("Outil inconnu")).toBeNull();
    expect(
      screen.queryByText(
        /create_user_stories|get_user_story|list_tickets_needing_us/,
      ),
    ).toBeNull();
    expect(within(rows[0] as HTMLElement).getByText("Refusée")).toBeDefined();
  });
});
