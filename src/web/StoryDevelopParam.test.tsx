// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice S07 (decision 084 D): /us/:id?developper opens the window « Développer avec Claude » at once, when the button would be
// there (status ready or in_review, project not archived, role can_launch or more). Same API as DevelopWindowRelaunch.test.tsx.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

function stub(options: { archived?: boolean; status?: string } = {}) {
  stubTicketApi(
    [ticket(7, "Idée")],
    [
      story(42, 7, "Me connecter avec GitHub", {
        status: options.status ?? "in_review",
      }),
    ],
  );
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
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/stories/42") {
        const body = await (await inner(input, init)).json();
        body.story.branch = "us/42-me-connecter";
        body.story.prNumber = 12;
        body.project.archived = options.archived ?? false;
        return Response.json(body);
      }
      if (path === "/api/projects/5/branches")
        return Response.json({ branches: ["main", "us/42-me-connecter"] });
      if (path === "/api/projects/5/agents")
        return Response.json({
          agents: [],
          catalog: [],
          team: null,
          teams: [],
        });
      return inner(input, init);
    }),
  );
}

const loaded = () =>
  waitFor(() =>
    expect(screen.getByRole("main").textContent).toContain(
      "Me connecter avec GitHub",
    ),
  );

describe("S07 D: /us/:id?developper", () => {
  it("given an in_review story, when /us/42?developper loads, then the window Développer avec Claude is open without a click", async () => {
    stub();
    renderAt("/us/42?developper");

    expect(
      await screen.findByRole("complementary", {
        name: "Développer avec Claude",
      }),
    ).toBeDefined();
  });

  it("given a ready story, when /us/42?developper loads, then the window is open too", async () => {
    stub({ status: "ready" });
    renderAt("/us/42?developper");

    expect(
      await screen.findByRole("complementary", {
        name: "Développer avec Claude",
      }),
    ).toBeDefined();
  });

  it("given /us/42 without the parameter, when it loads, then the window stays closed", async () => {
    stub();
    renderAt("/us/42");
    await loaded();

    expect(
      await screen.findByRole("button", { name: "Développer avec Claude" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("complementary", { name: "Développer avec Claude" }),
    ).toBeNull();
  });

  it("given an archived project, when /us/42?developper loads, then the window does not open", async () => {
    stub({ archived: true });
    renderAt("/us/42?developper");
    await loaded();
    await new Promise((r) => setTimeout(r, 50));

    expect(
      screen.queryByRole("complementary", { name: "Développer avec Claude" }),
    ).toBeNull();
  });

  it("given a to_validate story, when /us/42?developper loads, then the window does not open", async () => {
    stub({ status: "to_validate" });
    renderAt("/us/42?developper");
    await loaded();
    await new Promise((r) => setTimeout(r, 50));

    expect(
      screen.queryByRole("complementary", { name: "Développer avec Claude" }),
    ).toBeNull();
  });
});
