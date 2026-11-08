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

// Slice 4.4 (decisions 010, 018 H): the five new actions of the humans and Claude's update_user_story are named in
// French in the Journal, each with a label of its own.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const entry = (id: number, action: string, actor: string, origin: string) => ({
  id,
  at: `2026-10-28T12:0${id}:00.000Z`,
  actor,
  origin,
  action,
  result: "ok",
});

const ACTIONS: [string, string, string, RegExp][] = [
  ["validate_story", "human", "ui", /valid/i],
  ["send_back_story", "human", "ui", /renvo/i],
  ["abandon_story", "human", "ui", /abandon/i],
  ["abandon_ticket", "human", "ui", /abandon/i],
  ["update_story", "human", "ui", /modifi/i],
  ["update_user_story", "claude", "mcp", /\S/],
  ["set_auto_relaunch", "human", "ui", /relance/i],
];

describe("criterion 13: the Journal and the decisions", () => {
  it("given one entry per new action, when /journal loads, then each row has a French label of its own (not Outil inconnu, no code) and the labels of the decisions say what they are", async () => {
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
            entries: ACTIONS.map(([action, actor, origin], i) =>
              entry(ACTIONS.length - i, action, actor, origin),
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
    const entries = () =>
      within(screen.getByRole("main")).getAllByRole("listitem");
    await waitFor(() => expect(entries()).toHaveLength(ACTIONS.length));
    const labels = entries().map(
      (row) => row.querySelector("span")?.textContent ?? "",
    );
    expect(labels.every((label) => label.trim() !== "")).toBe(true);
    expect(new Set(labels).size).toBe(ACTIONS.length);
    for (const [i, [action, , , word]] of ACTIONS.entries())
      expect(labels[i], action).toMatch(word);
    expect(screen.queryByText("Outil inconnu")).toBeNull();
    expect(
      screen.queryByText(
        /validate_story|send_back_story|abandon_story|abandon_ticket|update_story|update_user_story/,
      ),
    ).toBeNull();
  });
});
