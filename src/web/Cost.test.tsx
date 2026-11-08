// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 14.5 (decision 060 F): the page « Coût » at /claude/cout.
//
// Data route assumed: GET /api/claude/cost -> { monthUsd, runAverageUsd, perMergedPrUsd, budgets: { runUsd, nightUsd,
// monthUsd }, projects: [{ id, name, costUsd }] } (null averages when there is nothing to divide by); the caps save through
// PUT /api/me/budgets { runUsd, nightUsd, monthUsd }.
// Pinned: the fields are labelled « Plafond par run », « Plafond par nuit », « Plafond par mois » (number inputs), the
// button « Enregistrer »; amounts read like « 12,50 $ » (two decimals).

type Call = { method: string; path: string; body: unknown };

function stub() {
  stubHome(empty());
  const inner = globalThis.fetch;
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/claude/cost")
        return Response.json({
          monthUsd: 12.5,
          runAverageUsd: 1.04,
          perMergedPrUsd: 3.1,
          projects: [{ id: 5, name: "octocat/hello", costUsd: 8 }],
        });
      if (path === "/api/me/budgets" && method === "GET")
        return Response.json({ runUsd: 2, nightUsd: null, monthUsd: 40 });
      if (path === "/api/me/budgets") {
        calls.push({
          method,
          path,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        return Response.json({});
      }
      return inner(input, init);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const text = () =>
  (screen.getByRole("main").textContent ?? "").replace(/\s/g, " ");

describe("criterion 6: the page Coût", () => {
  it("given a month of costs, when /claude/cout loads, then it shows the month total, the per-run average, the per-merged-PR cost and the project row", async () => {
    stub();
    renderAt("/claude/cout");

    await waitFor(() => expect(text()).toContain("octocat/hello"));

    expect(text()).toContain("12,50 $");
    expect(text()).toContain("1,04 $");
    expect(text()).toContain("3,10 $");
    expect(text()).toContain("8,00 $");
  });

  it("given the caps 2 / none / 40, when the month cap is set to 50 and saved, then PUT /api/me/budgets carries the three caps", async () => {
    const calls = stub();
    renderAt("/claude/cout");
    const main = within(await screen.findByRole("main"));
    const month = (await main.findByLabelText(
      "Plafond par mois",
    )) as HTMLInputElement;
    await waitFor(() => expect(month.value).toBe("40"));
    expect(
      (main.getByLabelText("Plafond par run") as HTMLInputElement).value,
    ).toBe("2");

    fireEvent.change(month, { target: { value: "50" } });
    fireEvent.click(main.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        runUsd: 2,
        nightUsd: null,
        monthUsd: 50,
      }),
    );
  });
});
