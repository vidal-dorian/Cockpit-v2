// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice R4 review (decision 050 C): « + 1 autre » in the singular.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const REASON = "La PR modifie du code de l'app, pas seulement des tests";

function stubRun(prAppFiles: string[] | null, prAppFilesCount: number | null) {
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
          criteria: [],
          verdict: { acceptable: false, reasons: ["app_code_changed"] },
          story: {
            id: 21,
            iWant: "figer la facturation",
            status: "in_review",
            prNumber: 12,
            prCiState: "success",
            prReviewState: null,
            kind: "takeover",
            prAppFiles,
            prAppFilesCount,
          },
          project: { id: 5, name: "octocat/hello", archived: false },
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

const main = () => screen.getByRole("main");

describe("decision 050 C: one more file", () => {
  it("given 1 listed file out of 2, when /runs/12 loads, then the page says « + 1 autre », singular", async () => {
    stubRun(["src/a.ts"], 2);

    renderAt("/runs/12");

    await screen.findByText(REASON);
    await waitFor(() => expect(main().textContent).toContain("+ 1 autre"));
    expect(main().textContent).not.toContain("autres");
  });
});
