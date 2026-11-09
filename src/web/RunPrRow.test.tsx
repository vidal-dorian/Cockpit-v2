// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Decision 069 C: a relaunched story keeps its PR number while in progress; the PR row is not ticked before in_review.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("given a story in progress that still has PR 12, when the run page loads, then the PR row is not ticked", async () => {
  const at = new Date().toISOString();
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
            startedAt: at,
            finishedAt: null,
          },
          steps: [],
          upcomingSteps: [],
          questions: [],
          criteria: [],
          story: { id: 21, iWant: "x", status: "in_progress", prNumber: 12 },
          project: { id: 5, name: "octocat/hello" },
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );

  renderAt("/runs/12");

  const heading = await screen.findByRole("heading", { name: /Les étapes/ });
  const last = [
    ...(heading.closest("section")?.querySelectorAll("li") ?? []),
  ].at(-1);
  expect(last?.textContent).toContain("Claude pousse la branche");
  expect(last?.textContent).not.toContain("ouverte");
});
