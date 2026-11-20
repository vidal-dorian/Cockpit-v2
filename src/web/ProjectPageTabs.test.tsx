// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Project page, the tab names (story 53)", () => {
  it("given the page of a project, when I look at its tabs, then the tab Agents is called Claude and still opens /projets/5/agents", async () => {
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
          return Response.json({ configured: true, detectedUrl: "http://x" });
        if (path === "/api/me")
          return Response.json({ login: "o", name: null, avatarUrl: null });
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
        return Response.json({}, { status: 404 });
      }),
    );
    window.history.replaceState({}, "", "/projets/5/sante");
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
    const link = within(nav).getByRole("link", { name: "Claude" });
    expect(link.getAttribute("href")).toBe("/projets/5/agents");
    expect(within(nav).queryByRole("link", { name: "Agents" })).toBeNull();
  });

  it("given ProjectPage.tsx, when the comment on the tabs is read, then it gives the real number of tabs", () => {
    const src = readFileSync("src/web/ProjectPage.tsx", "utf8");
    const real = (src.match(/\{ tab: "/g) ?? []).length;
    const words = [
      "",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
    ];
    const m = src.match(/page of a project in (\w+) tabs/);
    expect(
      m,
      "the comment « page of a project in N tabs » exists",
    ).not.toBeNull();
    const said = Number.isNaN(Number(m?.[1]))
      ? words.indexOf(m?.[1] ?? "")
      : Number(m?.[1]);
    expect(said).toBe(real);
  });
});
