// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 080 I reopened: on a phone the tab bar of a project hides its scrollbar, so a fade shows that tabs remain.
//
// Pinned choice: <nav aria-label="Sections du projet"> carries data-more-right="true" while tabs are hidden on its right
// (scrollLeft + clientWidth < scrollWidth), "false" otherwise. It is measured on mount and on every scroll event.
// jsdom has no layout: the tests give scrollWidth / clientWidth / scrollLeft through the element prototype.

const sizes = { scrollWidth: 600, clientWidth: 360, scrollLeft: 0 };

function fakeLayout() {
  for (const key of Object.keys(sizes) as (keyof typeof sizes)[])
    vi.spyOn(HTMLElement.prototype, key, "get").mockImplementation(
      () => sizes[key],
    );
}

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
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/projects")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
          ],
        });
      if (/^\/api\/projects\/5\/health$/.test(path))
        return Response.json({ lines: [] });
      if (/^\/api\/projects\/[^/]+\/stories$/.test(path))
        return Response.json({ stories: [] });
      if (/^\/api\/projects\/[^/]+\/tickets$/.test(path))
        return Response.json({ tickets: [] });
      if (/^\/api\/projects\/[^/]+\/routine$/.test(path))
        return Response.json({
          frequency: "off",
          hour: null,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
}

function open() {
  stubApi();
  window.history.replaceState({}, "", "/projets/5");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  return screen.findByRole("navigation", { name: "Sections du projet" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sizes.scrollLeft = 0;
  window.history.replaceState({}, "", "/");
});

describe("project tab bar on a phone", () => {
  it("given a 360 px screen, when I open a project, then the right edge of the tab bar shows a fade while tabs stay hidden there", async () => {
    fakeLayout();
    const nav = await open();
    await waitFor(() => expect(nav.dataset.moreRight).toBe("true"));
  });

  it("given I scrolled the bar to the end, when I look at its right edge, then the fade is gone", async () => {
    fakeLayout();
    const nav = await open();
    await waitFor(() => expect(nav.dataset.moreRight).toBe("true"));
    sizes.scrollLeft = 240;
    act(() => {
      fireEvent.scroll(nav);
    });
    await waitFor(() => expect(nav.dataset.moreRight).toBe("false"));
  });
});
