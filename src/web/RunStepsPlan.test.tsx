// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 9.5 (decision 069 C, E): the steps of a run with those to come, and « Pourquoi Claude demande » in the run panel.
// Pinned: GET /api/runs/:id also gives `upcomingSteps: string[]` and, per question, `context: string | null` and `agent`.
// The clock is local like the Journal's: the dates are built from local times, so the test holds in any time zone.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const at = (h: number, m: number) => new Date(2026, 10, 9, h, m).toISOString();

function stubRun(over: Record<string, unknown> = {}, story: object = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
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
            startedAt: at(9, 44),
            finishedAt: null,
          },
          steps: [
            {
              id: 1,
              agent: "test-writer",
              status: "succeeded",
              summary: null,
              startedAt: at(9, 2),
              finishedAt: at(9, 30),
            },
            {
              id: 2,
              agent: "developer",
              status: "running",
              summary: null,
              startedAt: at(9, 30),
              finishedAt: null,
            },
          ],
          upcomingSteps: ["reviewer"],
          questions: [
            {
              id: 1,
              question: "Quel nom pour le bouton ?",
              suggestedAnswers: null,
              answer: null,
              askedAt: at(9, 56),
              answeredAt: null,
              context: null,
              agent: "developer",
            },
          ],
          criteria: [],
          story: {
            id: 21,
            iWant: "relire les exports",
            status: "in_progress",
            prNumber: null,
            ...story,
          },
          project: { id: 5, name: "octocat/hello" },
          ...over,
        });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
}

const rows = async () => {
  const heading = await screen.findByRole("heading", { name: /Les étapes/ });
  const list = heading.closest("section")?.querySelectorAll("li") ?? [];
  return [...list].map((li) => (li.textContent ?? "").replace(/\s+/g, " "));
};

describe("criterion 5: the steps of a running run", () => {
  it("given test-writer done at 9:02, developer waiting for 4 min and reviewer upcoming, when the run page loads, then the rows are test-writer 9:02, developer waiting, 3 reviewer à venir, 4 PR, and the branch line ends with 16 min", async () => {
    stubRun();

    renderAt("/runs/12");

    const lines = await rows();
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/test-writer.*9:02/);
    expect(lines[1]).toMatch(/developer.*attend ta réponse depuis 4 min/);
    expect(lines[2]).toMatch(/3\s*reviewer.*à venir/);
    expect(lines[3]).toMatch(/4\s*PR.*Claude pousse la branche et ouvre la PR/);
    const branch = within(screen.getByRole("main"))
      .getByText(/us\/42-login/)
      .closest("p");
    expect(branch?.textContent?.trim()).toMatch(/· 16 min$/);
  });
});

describe("criterion 6: the PR row", () => {
  it("given the story in_review with PR 12 during the run, when the run page loads, then the PR row is checked and reads PR #12 ouverte", async () => {
    stubRun({}, { status: "in_review", prNumber: 12 });

    renderAt("/runs/12");

    const lines = await rows();
    expect(lines.at(-1)).toContain("PR #12 ouverte");
    expect(lines.at(-1)).not.toContain("Claude pousse la branche");
  });
});

describe("criterion 7: Pourquoi Claude demande on the run page", () => {
  const side = async () =>
    within(
      await screen.findByRole("complementary", { name: "Question de Claude" }),
    );

  it("given a pending question with a context, when the run page loads, then the right panel shows Pourquoi Claude demande and the context", async () => {
    const context = "L'envoi de l'e-mail est en place, reste le nom.";
    stubRun({
      questions: [
        {
          id: 1,
          question: "Quel nom ?",
          suggestedAnswers: null,
          answer: null,
          askedAt: at(9, 56),
          answeredAt: null,
          context,
          agent: "developer",
        },
      ],
    });

    renderAt("/runs/12");

    const panel = await side();
    expect(panel.getByText("Pourquoi Claude demande")).toBeDefined();
    expect(panel.getByText(context)).toBeDefined();
  });

  it("given a pending question without context, when the run page loads, then there is no Pourquoi Claude demande", async () => {
    stubRun();

    renderAt("/runs/12");

    const panel = await side();
    expect(panel.getByText("Quel nom pour le bouton ?")).toBeDefined();
    expect(panel.queryByText("Pourquoi Claude demande")).toBeNull();
  });
});
