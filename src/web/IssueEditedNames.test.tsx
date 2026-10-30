// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import {
  decisionStory,
  type HistoryEntry,
  stubDecisionApi,
} from "./test-decisions.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

// Decision 025 I (slice 5.2): the Journal and the history of a story name the three new actions in French, never by their code.
// Pinned here (the decision leaves the words open):
// - issue_diverged: « Issue modifiée sur GitHub »; keep_cockpit_issue: « Version de Cockpit gardée »; take_github_issue: « Version de GitHub reprise ».
// - In the history of a story, the entries of the actor `github` say « GitHub » where the others say « Toi », « Claude » or « Cockpit »:
//   an edit made on GitHub is not the user's.

const NAMES = [
  ["issue_diverged", "Issue modifiée sur GitHub", "github", "webhook"],
  ["keep_cockpit_issue", "Version de Cockpit gardée", "human", "ui"],
  ["take_github_issue", "Version de GitHub reprise", "human", "ui"],
] as const;

describe("criterion I: the Journal", () => {
  it("given an entry of each new action, when /journal loads, then each row has its French name and never the code", async () => {
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
            entries: NAMES.map(([action, , actor, origin], i) => ({
              id: i + 1,
              at: "2026-10-30T12:00:00.000Z",
              actor,
              origin,
              action,
              result: "ok",
            })),
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

    await screen.findByText(/Issue modifiée sur GitHub/);
    const text = screen.getByRole("main").textContent ?? "";
    for (const [action, name] of NAMES) {
      expect(text, name).toContain(name);
      expect(text).not.toContain(action);
    }
  });
});

describe("criterion I: the history of a story", () => {
  const entries: HistoryEntry[] = NAMES.map(([action, , actor], i) => ({
    id: i + 1,
    at: `2026-10-30T12:0${i}:00.000Z`,
    action,
    result: "ok",
    actor,
  })).reverse();

  it("given an edit made on GitHub and the two choices of the user, when the history is opened, then each row has its French name, the edit is attributed to GitHub and the choices to Toi", async () => {
    stubDecisionApi({
      tickets: [ticket(7, "Idée découpée")],
      stories: [
        decisionStory(story(21, 7, "relire les exports", { status: "ready" })),
      ],
      history: entries,
    });
    renderAt("/us/21");
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain(
        "relire les exports",
      ),
    );
    const details = screen
      .getByRole("main")
      .querySelector("details") as HTMLDetailsElement;

    fireEvent.click(details.querySelector("summary") as HTMLElement);
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() =>
      expect(within(details).getAllByRole("listitem")).toHaveLength(3),
    );
    const rows = within(details)
      .getAllByRole("listitem")
      .map((r) => r.textContent ?? "");
    const row = (name: string) => rows.find((r) => r.includes(name)) ?? "";
    expect(row("Issue modifiée sur GitHub")).not.toContain("Toi");
    // The actor is said apart from the name of the action.
    expect(
      row("Issue modifiée sur GitHub").replace("Issue modifiée sur GitHub", ""),
    ).toContain("GitHub");
    expect(row("Version de Cockpit gardée")).toContain("Toi");
    expect(row("Version de GitHub reprise")).toContain("Toi");
    for (const [action] of NAMES) expect(rows.join(" ")).not.toContain(action);
  });
});
