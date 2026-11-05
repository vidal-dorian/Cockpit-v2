// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.5 (decision 037 F): on an archived project the run page offers no action (GET /api/runs/:id gives project.archived).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function stubRun(status: string) {
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
            status,
            branch: "us/42-login",
            model: "claude-x",
            comment: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt: null,
            stopRequestedAt: null,
          },
          steps: [],
          story: { id: 21, iWant: "relire", status: "ready" },
          project: { id: 5, name: "octocat/hello", archived: true },
          criteria: [],
          questions: [],
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("Run n° 12"));

describe("run controls of an archived project", () => {
  it("given a running run of an archived project, when it loads, then both buttons are disabled", async () => {
    stubRun("running");
    renderAt("/runs/12");
    await loaded();

    for (const name of ["Demander l'arrêt", "Fermer le run"])
      expect(
        (within(main()).getByRole("button", { name }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
  });

  it("given a finished run of an archived project, when it loads, then there is no « Relancer » link", async () => {
    stubRun("failed");
    renderAt("/runs/12");
    await loaded();

    expect(within(main()).queryByRole("link", { name: "Relancer" })).toBeNull();
  });
});
