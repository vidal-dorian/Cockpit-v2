// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R4 (decision 050 C): the reason « La PR modifie du code de l'app, pas seulement des tests » (code app_code_changed) on the page of a run and on the home.
// Pinned: GET /api/runs/:id gives story.prAppFiles (string[] | null, 20 at most) and story.prAppFilesCount (number | null), see src/server/test-freeze.ts.
// The page lists the files under the reason; when the count is greater than the list, « + N autres » (N = count - list length).

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

describe("decision 050 C: the run page", () => {
  it("given the reason app_code_changed and two app files, when /runs/12 loads, then the reason is read in French with both paths and no « autres »", async () => {
    stubRun(["src/a.ts", "src/b.ts"], 2);

    renderAt("/runs/12");

    expect(await screen.findByText(REASON)).toBeDefined();
    expect(main().textContent).toContain("src/a.ts");
    expect(main().textContent).toContain("src/b.ts");
    expect(main().textContent).not.toMatch(/autres?/);
  });

  it("given 20 listed files out of 25, when /runs/12 loads, then the page says « + 5 autres »", async () => {
    const files = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`);
    stubRun(files, 25);

    renderAt("/runs/12");

    await screen.findByText(REASON);
    await waitFor(() => expect(main().textContent).toContain("src/f19.ts"));
    expect(main().textContent).toContain("+ 5 autres");
  });
});

describe("decision 050 C: the home", () => {
  it("given a check item with app_code_changed, when the home loads, then the panel gives the reason in French", async () => {
    stubHome({
      ...empty(),
      forYou: [
        {
          kind: "check",
          storyId: 24,
          iWant: "figer la facturation",
          runId: 31,
          reasons: ["app_code_changed"],
          project: { id: 5, name: "octocat/hello" },
        },
      ],
    } as never);

    renderAt("/");

    expect(await screen.findByText(REASON)).toBeDefined();
  });
});
