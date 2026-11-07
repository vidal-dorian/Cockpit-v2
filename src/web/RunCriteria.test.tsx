// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.3 (decision 035 F): the section « Critères » of the page of a run. Pinned: GET /api/runs/:id also gives
// criteria: [{ id, position, given, when, then, result: "passed" | "failed" | null, evidence: string | null }],
// the result and the evidence being those given by this run only.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const criterion = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  position: id,
  given: `donné ${id}`,
  when: `quand ${id}`,
  then: `alors ${id}`,
  result: null,
  evidence: null,
  ...over,
});

function stubApi(criteria: object[]) {
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
          story: { id: 21, iWant: "relire les exports" },
          project: { id: 5, name: "octocat/hello" },
          criteria,
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

describe("criterion 8: the Critères section of the run page", () => {
  it("given three criteria (passed, failed, not reported), when /runs/12 loads, then the section lists each Given/When/Then with Réussi, Échoué or Non signalé dans ce run, and the evidence", async () => {
    stubApi([
      criterion(1, { result: "passed", evidence: "src/a.test.ts > logs in" }),
      criterion(2, { result: "failed", evidence: "src/b.test.ts > logs out" }),
      criterion(3),
    ]);

    renderAt("/runs/12");

    const heading = await screen.findByRole("heading", {
      name: /^Les critères/,
    });
    const section = (heading.closest("section") ??
      heading.parentElement) as HTMLElement;
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("donné 1");
    expect(items[0]?.textContent).toContain("quand 1");
    expect(items[0]?.textContent).toContain("alors 1");
    expect(items[0]?.textContent).toContain("Réussi");
    expect(items[0]?.textContent).toContain("src/a.test.ts > logs in");
    expect(items[1]?.textContent).toContain("Échoué");
    expect(items[1]?.textContent).toContain("src/b.test.ts > logs out");
    expect(items[2]?.textContent).toContain("Non signalé dans ce run");
    expect(items[2]?.textContent).not.toContain("Réussi");
    expect(items[0]?.textContent).not.toContain("Non signalé dans ce run");
    await waitFor(() => expect(screen.getByRole("main")).toBeTruthy());
  });
});
