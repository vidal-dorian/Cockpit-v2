// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 12.4 review (decision 067 D): an App created before the release lacks `workflows` itself, so the page sends to the App's settings, not to the installation.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const SETTINGS = "https://github.com/settings/apps/cockpit/permissions";
const SENTENCE =
  "Ajoute la permission Workflows en écriture à l'App GitHub de Cockpit, puis approuve-la.";

describe("decision 067 D: an App without the permission", () => {
  it("given permission.appMissing, when the tab shows a starter, then « Faire le commit » is disabled and the sentence links to the App's permissions", async () => {
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
        const answers: Record<string, unknown> = {
          "/api/setup/status": {
            configured: true,
            detectedUrl: "http://localhost",
          },
          "/api/me": { login: "octocat", name: null, avatarUrl: null },
          "/api/projects": {
            projects: [
              {
                id: 5,
                fullName: "octocat/hello",
                defaultBranch: "main",
                archived: false,
              },
            ],
          },
          "/api/projects/5/health": { lines: [] },
          "/api/projects/5/workflows": {
            workflows: [],
            starter: {
              language: "node",
              path: ".github/workflows/ci.yml",
              content: "name: CI\n",
            },
            permission: {
              workflows: false,
              installationUrl: SETTINGS,
              appMissing: true,
            },
            proposal: null,
          },
        };
        if (path in answers) return Response.json(answers[path]);
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );
    window.history.replaceState({}, "", "/projets/5/ci");
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    const commit = (await screen.findByRole("button", {
      name: "Faire le commit",
    })) as HTMLButtonElement;

    expect(commit.disabled).toBe(true);
    expect(screen.getByText(SENTENCE)).toBeDefined();
    expect(
      screen
        .getAllByRole("link")
        .some((l) => l.getAttribute("href") === SETTINGS),
    ).toBe(true);
  });
});
