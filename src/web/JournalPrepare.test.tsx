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

// Slice 6.2 (decisions 010, 027 E): the entry prepare_repo is named « Préparer pour Claude » in the Journal,
// whatever its result, and no internal code is shown.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const entry = (id: number, result: string) => ({
  id,
  at: `2026-10-31T12:0${id}:00.000Z`,
  actor: "human",
  origin: "ui",
  action: "prepare_repo",
  result,
});

describe("decision 027 E: the Journal and the preparation of a repo", () => {
  it("given entries of prepare_repo that succeeded and that were refused, when /journal loads, then each row reads « Préparer pour Claude » with its result, and the code of the action is not shown", async () => {
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
            entries: [entry(2, "refused"), entry(1, "ok")],
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
    const [refused, done] = items() as [HTMLElement, HTMLElement];
    expect(within(refused).getByText("Préparer pour Claude")).toBeDefined();
    expect(within(refused).getByText("Refusée")).toBeDefined();
    expect(within(done).getByText("Préparer pour Claude")).toBeDefined();
    expect(within(done).getByText("Réussie")).toBeDefined();
    expect(screen.queryByText("Outil inconnu")).toBeNull();
    expect(screen.queryByText(/prepare_repo/)).toBeNull();
  });
});
