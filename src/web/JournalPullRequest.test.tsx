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

// Slice 7.6 (decision 038 H): the two new entries are named in French in the Journal.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const github = (id: number, action: string) => ({
  id,
  at: `2026-11-05T12:0${id}:00.000Z`,
  actor: "github",
  origin: "webhook",
  action,
  result: "ok",
});

describe("criterion 9: the Journal and the PR entries", () => {
  it("given entries pull_request_merged and pull_request_closed, when /journal loads, then they read PR mergée and PR fermée sans merge", async () => {
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
              github(2, "pull_request_closed"),
              github(1, "pull_request_merged"),
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
    await waitFor(() => expect(entries()).toHaveLength(2));
    const labels = entries().map(
      (row) => row.querySelector("span")?.textContent ?? "",
    );
    expect(labels).toEqual(["PR fermée sans merge", "PR mergée"]);
  });
});
