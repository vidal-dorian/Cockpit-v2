// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 14.1 (decision 054 I): the page of a run says « cloud » or « ce PC », and links to the session.
// Pinned: GET /api/runs/:id also answers `cloud`: { sessionUrl: string | null } | null; the page shows the word « cloud »
// and a link « Voir la session » for a cloud run (the link only when sessionUrl is not null), « ce PC » otherwise.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function stubRun(cloud: { sessionUrl: string | null } | null) {
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
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
            status: "running",
            branch: "us/42-login",
            model: "claude-x",
            comment: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt: null,
          },
          steps: [],
          cloud,
          story: { id: 21, iWant: "relire les exports" },
          project: { id: 5, name: "octocat/hello" },
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}
const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("Run 12"));

describe("criterion 10: the target of the run page", () => {
  it("given a cloud run with a session address, when /runs/12 loads, then it says cloud and « Voir la session » links to it", async () => {
    stubRun({ sessionUrl: "https://claude.ai/code/session_01ABC" });
    renderAt("/runs/12");
    await loaded();

    expect(main().textContent).toMatch(/\bcloud\b/);
    expect(main().textContent).not.toContain("ce PC");
    const link = within(main()).getByRole("link", { name: /Voir la session/ });
    expect(link.getAttribute("href")).toBe(
      "https://claude.ai/code/session_01ABC",
    );
  });

  it("given a cloud run without session address, when /runs/12 loads, then it says cloud and shows no « Voir la session »", async () => {
    stubRun({ sessionUrl: null });
    renderAt("/runs/12");
    await loaded();

    expect(main().textContent).toMatch(/\bcloud\b/);
    expect(
      within(main()).queryByRole("link", { name: /Voir la session/ }),
    ).toBeNull();
  });

  it("given a run started on this PC, when /runs/12 loads, then it says ce PC and no « Voir la session »", async () => {
    stubRun(null);
    renderAt("/runs/12");
    await loaded();

    expect(main().textContent).toContain("ce PC");
    expect(main().textContent).not.toMatch(/\bcloud\b/);
    expect(
      within(main()).queryByRole("link", { name: /Voir la session/ }),
    ).toBeNull();
  });
});
