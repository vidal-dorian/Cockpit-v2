// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Ticket #52: « Tous les projets » (/projets) has a search field, like the import one (084 A1).
// Pinned: the field is the searchbox named « Chercher un projet »; no match reads « Aucun projet ne correspond à « xyz ». ».

const project = (id: number, fullName: string, archived = false) => ({
  id,
  fullName,
  defaultBranch: "main",
  archived,
});

function stubApi(projects: ReturnType<typeof project>[]) {
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
      if (path === "/api/projects") return Response.json({ projects });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: true,
          repositories: [],
        });
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
}

function renderProjects() {
  window.history.replaceState({}, "", "/projets");
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
});
afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const field = async () =>
  (await screen.findByRole("searchbox", {
    name: "Chercher un projet",
  })) as HTMLInputElement;

describe("ticket #52: search in « Tous les projets »", () => {
  it("given several projects, when I type part of a name in another case, then only the projects whose name contains it stay", async () => {
    stubApi([
      project(1, "octocat/Hello-World"),
      project(2, "octocat/api"),
      project(3, "acme/hello-tools", true),
    ]);
    renderProjects();
    await screen.findByText("octocat/api");

    fireEvent.change(await field(), { target: { value: "HELLO" } });

    expect(screen.getByText("octocat/Hello-World")).toBeDefined();
    expect(screen.getByText("acme/hello-tools")).toBeDefined();
    expect(screen.queryByText("octocat/api")).toBeNull();
  });

  it("given a search with no result, when it shows, then a text says no project matches", async () => {
    stubApi([project(1, "octocat/hello"), project(2, "octocat/api")]);
    renderProjects();
    await screen.findByText("octocat/api");

    fireEvent.change(await field(), { target: { value: "xyz" } });

    expect(
      screen.getByText("Aucun projet ne correspond à « xyz »."),
    ).toBeDefined();
    expect(screen.queryByText("octocat/hello")).toBeNull();
  });
});
