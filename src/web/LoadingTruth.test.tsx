// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Story #54: a screen that loads or fails says so, it never states something false.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const h1 = async () => await screen.findByRole("heading", { level: 1 });

/** Wraps the shell fetch fake: `override` answers first, a returned undefined falls through. */
function overrideFetch(
  override: (path: string, method: string) => Promise<Response> | undefined,
) {
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      return override(path, method) ?? inner(input, init);
    }),
  );
}

const never = () => new Promise<Response>(() => {});

describe("story 54: screens never say something false while loading or failing", () => {
  it("given the Claude page loading, when it displays, then it shows a loading text and not « Claude travaille sur 0 run »", async () => {
    stubShell();
    overrideFetch((path) => (path === "/api/claude" ? never() : undefined));
    renderAt("/claude");

    const heading = await h1();
    expect(heading.textContent).not.toContain("Claude travaille");
    expect(heading.querySelector(".loading")).not.toBeNull();
  });

  it("given the Claude page whose request fails, when it displays, then it shows the error with « Réessayer »", async () => {
    stubShell();
    overrideFetch((path) =>
      path === "/api/claude"
        ? Promise.resolve(Response.json({ error: "x" }, { status: 500 }))
        : undefined,
    );
    renderAt("/claude");

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("button", { name: "Réessayer" }),
    ).toBeTruthy();
    expect((await h1()).textContent).not.toContain("Claude travaille");
  });

  it("given the home with a failed run and a run in progress, when it displays, then it does not say tout va bien", async () => {
    stubShell({
      forYou: [
        {
          kind: "check",
          storyId: 22,
          iWant: "trier les exports",
          runId: 9,
          reasons: ["criteria_failed"],
          project: PROJECT,
        },
      ],
      claudeWorks: [
        { runId: 12, storyId: 30, iWant: "x", project: PROJECT, step: null },
      ],
    });
    renderAt("/");

    await waitFor(async () =>
      expect((await h1()).textContent).toContain("1 chose t'attend."),
    );
    expect((await h1()).textContent).not.toContain("tout va bien");
  });

  it("given the home with a PR whose relaunches are exhausted and a run in progress, when it displays, then it does not say tout va bien", async () => {
    stubShell({
      forYou: [
        {
          kind: "relaunch_exhausted",
          storyId: 22,
          iWant: "trier les exports",
          prNumber: 7,
          project: PROJECT,
        },
      ],
      claudeWorks: [
        { runId: 12, storyId: 30, iWant: "x", project: PROJECT, step: null },
      ],
    });
    renderAt("/");

    await waitFor(async () =>
      expect((await h1()).textContent).toContain("1 chose t'attend."),
    );
    expect((await h1()).textContent).not.toContain("tout va bien");
  });

  it("given a project page while the projects load, when it displays, then its header shows a loading text, not a void", async () => {
    stubShell();
    overrideFetch((path, method) => {
      if (path === "/api/projects" && method === "GET") return never();
      if (/^\/api\/projects\/[^/]+\/stories$/.test(path))
        return Promise.resolve(Response.json({ stories: [] }));
      if (/^\/api\/projects\/[^/]+\/tickets$/.test(path))
        return Promise.resolve(Response.json({ tickets: [] }));
      return undefined;
    });
    renderAt("/projets/5");

    // The header is what comes before the body: its own loading text, whichever the body shows.
    await screen.findByRole("heading", { level: 1 });
    const header = document.querySelector("main > :first-child");
    expect(header?.querySelector(".loading")).not.toBeNull();
  });
});
