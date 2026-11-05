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

// Slice E4 (decision 032 G): the entry delete_team is named « Équipe supprimée » in the Journal, and no internal code is shown.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("decision 032 G: the Journal and the deleted teams", () => {
  it("given an entry of delete_team, when /journal loads, then the row reads « Équipe supprimée » and never the code", async () => {
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
              {
                id: 1,
                at: "2026-11-05T12:01:00.000Z",
                actor: "human",
                origin: "ui",
                action: "delete_team",
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
    await waitFor(() =>
      expect(
        within(screen.getByRole("main")).getAllByRole("listitem"),
      ).toHaveLength(1),
    );
    expect(screen.getByText("Équipe supprimée")).toBeDefined();
    expect(screen.queryByText("Outil inconnu")).toBeNull();
    expect(screen.queryByText(/delete_team/)).toBeNull();
  });
});
