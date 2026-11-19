// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice S07 (decision 084 A, D, L): the page of a run. Same API as RunVerdict.test.tsx and RunQuestions.test.tsx.
// Pinned: the answered « Questions » list and the end of the page stay as they are; « Résumé » is no longer a section of
// the page, the summary is in the card of the verdict; a reason of the verdict is a link named by its text.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const criterion = (id: number, result: string | null) => ({
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
  summary?: string | null;
  storyStatus?: string;
  prNumber?: number | null;
  questions?: object[];
  criteria?: object[];
};

function stubApi(over: Over = {}) {
  const status = over.status ?? "succeeded";
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
            summary: over.summary ?? null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt:
              status === "running" ? null : "2026-11-05T10:30:00.000Z",
          },
          steps: [],
          questions: over.questions ?? [],
          criteria: over.criteria ?? [criterion(1, "passed")],
          verdict:
            status === "running"
              ? null
              : (over.verdict ?? { acceptable: true, reasons: [] }),
          story: {
            id: 21,
            iWant: "relire les exports",
            status: over.storyStatus ?? "in_review",
            prNumber: over.prNumber === undefined ? 12 : over.prNumber,
            prCiState: null,
            prReviewState: null,
          },
          project: { id: 5, name: "octocat/hello", archived: false },
        });
      if (path.startsWith("/api/questions/") && init?.method === "POST") {
        posts.push({ path, body: JSON.parse(String(init.body)) });
        return Response.json({ question: { id: 1 } });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return { posts };
}

const precedes = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const pending = (suggested: string[] | null = null) => [
  {
    id: 1,
    question: "Quelle couleur ?",
    suggestedAnswers: suggested,
    answer: null,
    context: null,
    askedAt: "2026-11-05T10:01:00.000Z",
    answeredAt: null,
  },
  {
    id: 2,
    question: "Déjà répondue ?",
    suggestedAnswers: null,
    answer: "Oui",
    context: null,
    askedAt: "2026-11-05T10:00:30.000Z",
    answeredAt: "2026-11-05T10:00:40.000Z",
  },
];

describe("S07 L: the pending question comes right after the status sentence", () => {
  it("given a running run with a pending question, when the page loads, then the question panel comes before the steps and the criteria, and the answered Questions list stays after them", async () => {
    stubApi({ status: "running", questions: pending(["Bleu", "Rouge"]) });

    renderAt("/runs/12");

    const panel = await screen.findByRole("complementary", {
      name: "Question de Claude",
    });
    const sentence = screen.getByRole("heading", { name: /^Run 12/ });
    const steps = screen.getByRole("heading", { name: /^Les étapes/ });
    const criteria = screen.getByRole("heading", { name: /^Les critères/ });
    const answered = screen.getByRole("heading", {
      level: 2,
      name: "Questions",
    });
    expect(precedes(sentence, panel)).toBe(true);
    expect(precedes(panel, steps)).toBe(true);
    expect(precedes(panel, criteria)).toBe(true);
    expect(precedes(criteria, answered)).toBe(true);
  });
});

describe("S07 keys 1 and 2: the suggested answers", () => {
  it("given two suggested answers, when 2 is pressed, then the second is POSTed, and 1 sends the first", async () => {
    const api = stubApi({
      status: "running",
      questions: pending(["Bleu", "Rouge"]),
    });
    renderAt("/runs/12");
    await screen.findByRole("button", { name: /Rouge/ });

    fireEvent.keyDown(document.body, { key: "2" });

    await waitFor(() =>
      expect(api.posts).toEqual([
        { path: "/api/questions/1/answer", body: { answer: "Rouge" } },
      ]),
    );
  });

  it("given two suggested answers, when 1 is pressed, then the first is POSTed", async () => {
    const api = stubApi({
      status: "running",
      questions: pending(["Bleu", "Rouge"]),
    });
    renderAt("/runs/12");
    await screen.findByRole("button", { name: /Bleu/ });

    fireEvent.keyDown(document.body, { key: "1" });

    await waitFor(() =>
      expect(api.posts).toEqual([
        { path: "/api/questions/1/answer", body: { answer: "Bleu" } },
      ]),
    );
  });

  it("given the free-text field, when 1 is typed in it, then nothing is sent; and each suggested button declares its key with aria-keyshortcuts", async () => {
    const api = stubApi({
      status: "running",
      questions: pending(["Bleu", "Rouge"]),
    });
    renderAt("/runs/12");
    const field = await screen.findByLabelText("Ta réponse");

    fireEvent.keyDown(field, { key: "1" });
    await new Promise((r) => setTimeout(r, 50));

    expect(api.posts).toEqual([]);
    expect(
      screen
        .getByRole("button", { name: /Bleu/ })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("1");
    expect(
      screen
        .getByRole("button", { name: /Rouge/ })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("2");
  });

  it("given a question with no suggested answer, when 1 is pressed, then nothing is sent", async () => {
    const api = stubApi({ status: "running", questions: pending(null) });
    renderAt("/runs/12");
    await screen.findByLabelText("Ta réponse");

    fireEvent.keyDown(document.body, { key: "1" });
    await new Promise((r) => setTimeout(r, 50));

    expect(api.posts).toEqual([]);
  });

  it("given the window of the shortcuts, when ? is pressed, then it lists the keys 1 and 2", async () => {
    stubApi({ status: "running", questions: pending(["Bleu", "Rouge"]) });
    renderAt("/runs/12");
    await screen.findByLabelText("Ta réponse");

    fireEvent.keyDown(document.body, { key: "?" });

    const dialog = await screen.findByRole("dialog", {
      name: "Raccourcis clavier",
    });
    const keys = Array.from(dialog.querySelectorAll("kbd")).map(
      (k) => k.textContent,
    );
    expect(keys).toContain("1");
    expect(keys).toContain("2");
  });
});

describe("S07 D: a failed run says why in the card of the verdict", () => {
  it("given a failed run with a summary, when the page loads, then the summary is inside the card of the verdict and there is no Résumé section", async () => {
    stubApi({
      status: "failed",
      summary: "Un test ne passe pas après 3 essais.",
      verdict: { acceptable: false, reasons: ["run_not_succeeded"] },
      prNumber: null,
    });

    renderAt("/runs/12");

    const verdict = (
      await screen.findByRole("heading", { name: "Le verdict de Claude" })
    ).closest("section") as HTMLElement;
    expect(verdict.textContent).toContain(
      "Un test ne passe pas après 3 essais.",
    );
    expect(screen.queryByRole("heading", { name: "Résumé" })).toBeNull();
    expect(
      screen.getAllByText("Un test ne passe pas après 3 essais."),
    ).toHaveLength(1);
  });
});

describe("S07 D: the reasons of the verdict lead to their cause", () => {
  const reason = async (code: string, text: string, over: Over = {}) => {
    stubApi({
      status: "succeeded",
      verdict: { acceptable: false, reasons: [code] },
      ...over,
    });
    renderAt("/runs/12");
    const card = (
      await screen.findByRole("heading", { name: "Le verdict de Claude" })
    ).closest("section") as HTMLElement;
    return within(card).getByRole("link", { name: text });
  };

  it.each([
    ["ci_failing", "La CI échoue"],
    ["ci_pending", "La CI tourne encore"],
  ])(
    "given the reason %s, when the page loads, then « %s » links to the checks of the PR on GitHub",
    async (code, text) => {
      const link = await reason(code, text);

      expect(link.getAttribute("href")).toBe(
        "https://github.com/octocat/hello/pull/12/checks",
      );
    },
  );

  it("given changes_requested, when the page loads, then the reason links to the PR on GitHub", async () => {
    const link = await reason(
      "changes_requested",
      "Des modifications sont demandées sur la PR",
    );

    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/12",
    );
  });

  it("given ci_missing, when the page loads, then the reason links to the CI / CD tab of the project", async () => {
    const link = await reason("ci_missing", "Aucune CI sur la PR");

    expect(link.getAttribute("href")).toBe("/projets/5/ci");
  });

  it("given criteria_failed, when the page loads, then the reason links to an anchor on the criteria section", async () => {
    const link = await reason("criteria_failed", "1 critère en échec", {
      criteria: [criterion(1, "failed")],
    });

    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("#")).toBe(true);
    const target = document.getElementById(href.slice(1));
    expect(target).not.toBeNull();
    expect(
      target?.contains(screen.getByRole("heading", { name: /^Les critères/ })),
    ).toBe(true);
  });
});

describe("S07 D: Relancer opens Développer avec Claude directly", () => {
  it("given a finished run of a ready story, when the page loads, then Relancer links to the story page with the develop window asked", async () => {
    stubApi({ status: "failed", storyStatus: "ready", prNumber: null });

    renderAt("/runs/12");

    const link = await screen.findByRole("link", { name: "Relancer" });
    expect(link.getAttribute("href")).toMatch(/^\/us\/21\?developper/);
  });
});
