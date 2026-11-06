// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.7 (decision 039 E): the verdict at the top of the page of a finished run. Pinned: GET /api/runs/:id also gives
// verdict: { acceptable: boolean, reasons: string[] } | null (codes of 039 C), and story.prNumber (number | null);
// the counts of the reasons are those of the criteria of the page.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const criterion = (id: number, result: string | null = null) => ({
  id,
  position: id,
  given: `donné ${id}`,
  when: `quand ${id}`,
  then: `alors ${id}`,
  result,
  evidence: result ? "preuve" : null,
});

type Over = {
  status?: string;
  verdict?: { acceptable: boolean; reasons: string[] } | null;
  prNumber?: number | null;
  criteria?: object[];
};

function stubApi({
  status = "succeeded",
  verdict = { acceptable: true, reasons: [] },
  prNumber = 12,
  criteria = [criterion(1, "passed")],
}: Over = {}) {
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
            stopRequestedAt: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt:
              status === "running" ? null : "2026-11-05T10:30:00.000Z",
          },
          steps: [
            {
              id: 1,
              agent: "test-writer",
              status: "succeeded",
              summary: "Tests écrits",
              startedAt: "2026-11-05T10:00:00.000Z",
              finishedAt: "2026-11-05T10:05:00.000Z",
            },
          ],
          questions: [],
          criteria,
          verdict: status === "running" ? null : verdict,
          story: {
            id: 21,
            iWant: "relire les exports",
            status: "in_review",
            prNumber,
            prCiState: null,
            prReviewState: null,
          },
          project: { id: 5, name: "octocat/hello", archived: false },
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("Run n° 12"));
const precedes = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("criterion 3: the verdict at the top of a finished run", () => {
  it("given an acceptable verdict, when /runs/12 loads, then Acceptable is said in words before the Critères section, without À vérifier", async () => {
    stubApi();

    renderAt("/runs/12");

    const verdict = await screen.findByText("Acceptable");
    await loaded();
    const criteria = screen.getByRole("heading", { name: "Critères" });
    expect(precedes(verdict, criteria)).toBe(true);
    expect(main().textContent).not.toContain("À vérifier");
  });

  it("given a to-check verdict, when /runs/12 loads, then À vérifier is said before the Critères section, without Acceptable", async () => {
    stubApi({
      verdict: { acceptable: false, reasons: ["no_pull_request"] },
      prNumber: null,
    });

    renderAt("/runs/12");

    const verdict = await screen.findByText("À vérifier");
    const criteria = screen.getByRole("heading", { name: "Critères" });
    expect(precedes(verdict, criteria)).toBe(true);
    expect(main().textContent).not.toContain("Acceptable");
  });

  it.each([
    ["run_not_succeeded", "Le run n'a pas réussi"],
    ["no_pull_request", "Aucune PR liée"],
    ["ci_failing", "La CI échoue"],
    ["ci_pending", "La CI tourne encore"],
    ["ci_missing", "Aucune CI sur la PR"],
    ["changes_requested", "Des modifications sont demandées sur la PR"],
  ])(
    "given the reason %s, when the page loads, then it reads « %s » before the Critères section",
    async (code, text) => {
      stubApi({
        status: "failed",
        verdict: { acceptable: false, reasons: [code] },
      });

      renderAt("/runs/12");

      const reason = await screen.findByText(text);
      expect(
        precedes(reason, screen.getByRole("heading", { name: "Critères" })),
      ).toBe(true);
    },
  );

  it.each([
    [
      "two failed and two not reported criteria",
      [
        criterion(1, "failed"),
        criterion(2, "failed"),
        criterion(3),
        criterion(4),
        criterion(5, "passed"),
      ],
      ["2 critères en échec", "2 critères non signalés dans ce run"],
    ],
    [
      "one failed and one not reported criterion",
      [criterion(1, "failed"), criterion(2), criterion(3, "passed")],
      ["1 critère en échec", "1 critère non signalé dans ce run"],
    ],
  ])(
    "given %s, when the page loads, then the counts are read from the criteria of the page: %j",
    async (_l, criteria, texts) => {
      stubApi({
        verdict: {
          acceptable: false,
          reasons: ["criteria_failed", "criteria_not_reported"],
        },
        criteria,
      });

      renderAt("/runs/12");

      for (const text of texts)
        expect(await screen.findByText(text)).toBeTruthy();
    },
  );
});

describe("criterion 4: the main action", () => {
  it("given a story with PR 12, when the page loads, then a link Relire et merger sur GitHub points to the PR", async () => {
    stubApi();

    renderAt("/runs/12");

    const link = await screen.findByRole("link", {
      name: "Relire et merger sur GitHub",
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/12",
    );
  });

  it("given a story without PR, when the page loads, then there is no such link", async () => {
    stubApi({
      prNumber: null,
      verdict: { acceptable: false, reasons: ["no_pull_request"] },
    });

    renderAt("/runs/12");

    await screen.findByText("Aucune PR liée");
    expect(
      screen.queryByRole("link", { name: "Relire et merger sur GitHub" }),
    ).toBeNull();
  });
});

describe("criterion 5: the journal of a finished run", () => {
  it("given a finished run, when the page loads, then its steps are in a closed details whose summary is Journal détaillé", async () => {
    stubApi();

    renderAt("/runs/12");

    await screen.findByText("Acceptable");
    const details = main().querySelector("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.querySelector("summary")?.textContent).toBe(
      "Journal détaillé",
    );
    expect(details.open).toBe(false);
    expect(within(details).getByText("test-writer")).toBeTruthy();
    expect(within(details).getByText("Tests écrits")).toBeTruthy();
  });

  it("given a running run, when the page loads, then the steps are shown outside any details and there is no verdict", async () => {
    stubApi({ status: "running" });

    renderAt("/runs/12");

    await loaded();
    expect(screen.getByText("test-writer")).toBeTruthy();
    expect(main().querySelector("details")).toBeNull();
    expect(main().textContent).not.toContain("Acceptable");
    expect(main().textContent).not.toContain("À vérifier");
    expect(main().textContent).not.toContain("Journal détaillé");
  });
});
