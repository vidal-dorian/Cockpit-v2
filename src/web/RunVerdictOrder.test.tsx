// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.7 (decision 039 E): order of the page and the action of a merged PR.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

function stubApi(storyStatus: string) {
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
            status: "succeeded",
            branch: "us/42-login",
            model: "claude-x",
            comment: null,
            stopRequestedAt: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt: "2026-11-05T10:30:00.000Z",
          },
          steps: [],
          questions: [],
          criteria: [
            {
              id: 1,
              position: 1,
              given: "g",
              when: "w",
              then: "t",
              result: "passed",
              evidence: "preuve",
            },
          ],
          verdict: { acceptable: true, reasons: [] },
          story: {
            id: 21,
            iWant: "relire",
            status: storyStatus,
            prNumber: 12,
            prCiState: "success",
            prReviewState: null,
          },
          project: { id: 5, name: "octocat/hello", archived: false },
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

const precedes = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

it("given a finished run, when the page loads, then the verdict comes before Critères, Critères before the action, the action before the journal", async () => {
  stubApi("in_review");

  renderAt("/runs/12");

  const verdict = await screen.findByRole("heading", { name: "Acceptable" });
  const criteria = screen.getByRole("heading", { name: /^Les critères/ });
  const link = screen.getByRole("link", {
    name: "Relire et merger sur GitHub",
  });
  const details = screen.getByRole("main").querySelector("details") as Node;
  expect(precedes(verdict, criteria)).toBe(true);
  expect(precedes(criteria, link)).toBe(true);
  expect(precedes(link, details)).toBe(true);
});

it("given a merged PR, when the page loads, then the link only says Voir la PR sur GitHub", async () => {
  stubApi("done");

  renderAt("/runs/12");

  const link = await screen.findByRole("link", {
    name: "Voir la PR sur GitHub",
  });
  await waitFor(() =>
    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/12",
    ),
  );
  expect(link.className).not.toContain("bg-primary");
  expect(
    screen.queryByRole("link", { name: "Relire et merger sur GitHub" }),
  ).toBeNull();
});
