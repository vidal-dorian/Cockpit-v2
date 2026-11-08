// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Review of slice 12.1: each chip starts from nothing, and the chips show before the read ends.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("given an open rule, when another chip is clicked, then the rule editor is gone", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        "http://localhost",
      ).pathname;
      const json = (body: unknown) => Response.json(body);
      if (path === "/api/setup/status")
        return json({ configured: true, detectedUrl: "http://localhost" });
      if (path === "/api/me")
        return json({ login: "o", name: null, avatarUrl: null });
      if (path === "/api/projects")
        return json({
          projects: [
            { id: 5, fullName: "o/h", defaultBranch: "main", archived: false },
          ],
        });
      if (path === "/api/projects/5/health") return json({ lines: [] });
      if (path === "/api/projects/5/agents")
        return json({ agents: [], catalog: [] });
      if (path === "/api/projects/5/claude-config")
        return json({
          claudeMd: "x\n",
          mcpJson: null,
          rules: [{ name: "style", text: "Use tabs\n" }],
          skills: [],
        });
      throw new Error(`Unexpected fetch ${path}`);
    }),
  );
  window.history.replaceState({}, "", "/projets/5/agents?fichier=regles");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Ouvrir style" }));
  await screen.findByRole("button", { name: "Supprimer la règle" });

  fireEvent.click(screen.getByRole("link", { name: "CLAUDE.md" }));

  await screen.findByLabelText("Ton texte");
  expect(
    screen.queryByRole("button", { name: "Supprimer la règle" }),
  ).toBeNull();
});
