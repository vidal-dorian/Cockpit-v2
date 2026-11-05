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

// Slice 7.3, criterion 10 (decision 035 G): the two new tools are named in French in the Journal.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const claude = (id: number, action: string) => ({
  id,
  at: `2026-11-05T12:0${id}:00.000Z`,
  actor: "claude",
  origin: "mcp",
  action,
  result: "ok",
});

describe("criterion 10: the Journal and the criteria tools", () => {
  it("given entries of report_criterion and link_pull_request, when /journal loads, then they read Critère signalé and PR liée", async () => {
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
              claude(2, "link_pull_request"),
              claude(1, "report_criterion"),
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
    expect(labels).toEqual(["PR liée", "Critère signalé"]);
    expect(screen.queryByText("Outil inconnu")).toBeNull();
  });
});
