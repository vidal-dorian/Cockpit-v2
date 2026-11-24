// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Decision 094: a run `pr_to_open` can be closed by hand, and its title keeps « PR » capitalised.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function stubApi() {
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
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/runs/12")
        return Response.json({
          run: {
            id: 12,
            status: "pr_to_open",
            branch: "us/42-login",
            model: "claude-x",
            comment: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt: "2026-11-05T11:00:00.000Z",
            stopRequestedAt: null,
          },
          steps: [],
          story: { id: 21, iWant: "relire les exports", status: "in_progress" },
          project: { id: 5, name: "octocat/hello" },
          criteria: [],
          questions: [],
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("Run 12"));
const button = (name: string) => within(main()).queryByRole("button", { name });

describe("decision 094: the page of a pr_to_open run", () => {
  it("given a pr_to_open run on an in_progress story, when the page loads, then « Fermer le run » is shown and « Demander l'arrêt » is not", async () => {
    stubApi();
    renderAt("/runs/12");
    await loaded();

    await waitFor(() => expect(button("Fermer le run")).not.toBeNull());
    expect(button("Demander l'arrêt")).toBeNull();
  });

  it("given a pr_to_open run, when the page loads, then its title reads « Run 12 · PR à ouvrir. » with PR capitalised", async () => {
    stubApi();
    renderAt("/runs/12");
    await loaded();

    expect(main().textContent).toContain("Run 12 · PR à ouvrir.");
  });
});
