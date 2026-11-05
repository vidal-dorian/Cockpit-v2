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

// Slice 7.4, criterion 8 (decision 036 H): the three actions are named in French in the Journal.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const entry = (id: number, actor: string, origin: string, action: string) => ({
  id,
  at: `2026-11-05T12:0${id}:00.000Z`,
  actor,
  origin,
  action,
  result: "ok",
});

describe("criterion 8: the Journal and the questions", () => {
  it("given entries of ask_user, get_answer and answer_question, when /journal loads, then they read Question posée, Réponse consultée and Question répondue", async () => {
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
              entry(3, "human", "ui", "answer_question"),
              entry(2, "claude", "mcp", "get_answer"),
              entry(1, "claude", "mcp", "ask_user"),
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
    const labels = entries().map(
      (row) => row.querySelector("span")?.textContent ?? "",
    );
    expect(labels).toEqual([
      "Question répondue",
      "Réponse consultée",
      "Question posée",
    ]);
    expect(screen.queryByText("Outil inconnu")).toBeNull();
  });
});
