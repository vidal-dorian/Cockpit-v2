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

// Slice E2 (decision 030 F): the entries save_agent and delete_agent are named « Agent enregistré » and « Agent supprimé » in the Journal, and no internal code is shown.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const entry = (id: number, action: string) => ({
  id,
  at: `2026-10-31T12:0${id}:00.000Z`,
  actor: "human",
  origin: "ui",
  action,
  result: "ok",
});

describe("decision 030 F: the Journal and the agent editor", () => {
  it("given entries of save_agent and delete_agent, when /journal loads, then each row reads its French label and never the code", async () => {
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
            entries: [entry(2, "delete_agent"), entry(1, "save_agent")],
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
    const items = () =>
      within(screen.getByRole("main")).getAllByRole("listitem");
    await waitFor(() => expect(items()).toHaveLength(2));
    const [deleted, saved] = items() as [HTMLElement, HTMLElement];
    expect(within(deleted).getByText("Agent supprimé")).toBeDefined();
    expect(within(saved).getByText("Agent enregistré")).toBeDefined();
    expect(screen.queryByText("Outil inconnu")).toBeNull();
    expect(screen.queryByText(/save_agent|delete_agent/)).toBeNull();
  });
});
