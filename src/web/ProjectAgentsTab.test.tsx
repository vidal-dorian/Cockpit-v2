// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice E2 (decision 030 A): « Agents » is the fifth tab of the project page, a link to /projets/:id/agents inside <nav aria-label="Sections du projet">,
// before « Réglages » (slice 9.3); its section is told by an h2 « Agents ».

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
      if (path === "/api/projects/5/health")
        return Response.json({ lines: [] });
      if (path === "/api/projects/5/agents")
        return Response.json({ agents: [], catalog: [] });
      if (/^\/api\/projects\/5\/(stories|tickets)$/.test(path))
        return Response.json(
          path.endsWith("stories") ? { stories: [] } : { tickets: [] },
        );
      if (path === "/api/projects/5/routine")
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
          prompt: "x",
        });
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
}

describe("decision 030 A: the tab Agents", () => {
  it("given a project, when /projets/:id/agents opens, then « Agents » is the fourth tab, a link to that route marked open, and its section has the h2 « Agents »", async () => {
    stubApi();
    window.history.replaceState({}, "", "/projets/5/agents");

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    const nav = await screen.findByRole("navigation", {
      name: "Sections du projet",
    });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(5);
    const agents = links[3] as HTMLElement;
    expect(agents.textContent?.trim()).toBe("Agents");
    expect(agents.getAttribute("href")).toBe("/projets/5/agents");
    expect(agents.getAttribute("aria-current")).toBe("page");
    for (const other of links.filter((l) => l !== agents))
      expect(other.getAttribute("aria-current")).toBeNull();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Agents" }),
    ).toBeDefined();
  });
});
