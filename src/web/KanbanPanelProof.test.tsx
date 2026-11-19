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
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { panel, withHome } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Decision 084 A, C, E, G, H: the panel of a Kanban card shows what is needed to decide (the story, the PR and verdict, the question),
// links the ticket, the rules and the diverged issue, brings the focus on the phone, and the page sentence is a link.
// Pinned: the board route may add `blockedBy: number | null` to a card (see server/kanban-blocked.test.ts); GET /api/stories/:id gives
// story.runs, story.issue and story.prNumber as on the page of the story; GET /api/runs/:id and POST /api/questions/:id/answer as on the run page.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Seed = Record<string, unknown>;
type Extra = { issueDiverged?: boolean; blockedBy?: number | null };

const kriteria = (id: number, over: Seed = {}) => ({
  id,
  position: 1,
  given: "un état",
  when: "une action",
  then: "un résultat",
  result: null,
  evidence: null,
  resultRunId: null,
  summary: null,
  takeoverState: null,
  ...over,
});

const run = (over: Seed = {}) => ({
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
  criteria: [{ ...kriteria(1), result: "passed", evidence: "preuve" }],
  verdict: { acceptable: false, reasons: ["no_pull_request"] },
  story: {
    id: 42,
    iWant: "vouloir-alpha",
    status: "in_review",
    prNumber: 12,
    prCiState: null,
    prReviewState: null,
  },
  project: { id: 5, name: "octocat/hello", archived: false },
  ...over,
});

/** The decision fake plus what the panel reads: the board extras, the runs and the answer. Returns the writes to /api/questions. */
function load(
  stories: ReturnType<typeof decisionStory>[],
  options: {
    extra?: Record<number, Extra>;
    runs?: Record<number, object>;
  } = {},
) {
  stubDecisionApi({ tickets: [ticket(7, "Idée A")], stories });
  withHome({});
  const inner = globalThis.fetch;
  const answers: unknown[] = [];
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
      const runId = /^\/api\/runs\/(\d+)$/.exec(path)?.[1];
      if (runId && options.runs?.[Number(runId)])
        return Response.json(options.runs[Number(runId)]);
      if (/^\/api\/questions\/\d+\/answer$/.test(path)) {
        answers.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true });
      }
      const res = await inner(input, init);
      if (path !== "/api/projects/5/stories") return res;
      const { stories: cards } = (await res.json()) as {
        stories: { id: number }[];
      };
      return Response.json({
        stories: cards.map((c) => ({
          issueDiverged: false,
          blockedBy: null,
          ...c,
          ...options.extra?.[c.id],
        })),
      });
    }),
  );
  return answers;
}

const withStory = (
  id: number,
  iWant: string,
  over: Seed = {},
  comment: string | null = null,
) =>
  decisionStory(
    {
      ...story(id, 7, iWant, { status: "to_validate" }),
      ...over,
    } as ReturnType<typeof story>,
    comment,
  );

const card = (name: RegExp) => screen.findByRole("link", { name });
const open = async (name: RegExp) => {
  fireEvent.click(await card(name));
  return within(await waitFor(() => panel()));
};

describe("decision 084 A, G: the panel shows the story to decide on it", () => {
  it("given a story to validate, when its card is opened, then the panel shows the narrative and the Given/When/Then criteria beside Valider", async () => {
    load([
      withStory(42, "vouloir-alpha", {
        asA: "responsable paie",
        soThat: "gagner du temps",
      }),
    ]);
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    await p.findByText(/responsable paie/);
    expect(p.getByText(/gagner du temps/)).toBeDefined();
    expect(p.getByText(/un état/)).toBeDefined();
    expect(p.getByText(/une action/)).toBeDefined();
    expect(p.getByText(/un résultat/)).toBeDefined();
    expect(p.getByRole("button", { name: "Valider" })).toBeDefined();
  });

  it("given a story to rewrite with a comment, when its card is opened, then the panel shows the comment and the narrative", async () => {
    load([
      withStory(
        42,
        "vouloir-alpha",
        { status: "to_rewrite", soThat: "gagner du temps" },
        "Précise le format de l'export",
      ),
    ]);
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    await p.findByText(/Précise le format de l'export/);
    expect(p.getByText(/gagner du temps/)).toBeDefined();
    expect(p.getByText(/un résultat/)).toBeDefined();
  });

  it("given a ready story, when its card is opened, then the panel shows the narrative and the criteria", async () => {
    load([withStory(42, "vouloir-alpha", { status: "ready" })]);
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    await p.findByText(/gagner du temps/);
    expect(p.getByText(/un état/)).toBeDefined();
  });
});

describe("decision 084 A, G: a story in review shows its PR, CI and verdict", () => {
  it("given a story in review with PR 12 and an unacceptable verdict, when its card is opened, then the panel shows the PR link, the CI row and À vérifier", async () => {
    load(
      [
        withStory(42, "vouloir-alpha", {
          status: "in_review",
          prNumber: 12,
          prCiState: "failure",
          prReviewState: null,
          branch: "us/42-login",
          runs: [
            {
              id: 12,
              status: "succeeded",
              startedAt: "2026-11-05T10:00:00.000Z",
              finishedAt: "2026-11-05T10:30:00.000Z",
            },
          ],
        }),
      ],
      { runs: { 12: run() } },
    );
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    const pr = await p.findByRole("link", { name: /PR #12/ });
    expect(pr.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/12",
    );
    expect(p.getByText("CI")).toBeDefined();
    expect(await p.findByText("À vérifier")).toBeDefined();
  });
});

describe("decision 084 A, G: a question of Claude is answered in the panel", () => {
  it("given an in-progress story with a pending question, when its card is opened and a suggested answer is clicked, then the question is shown and the answer is posted", async () => {
    const answers = load(
      [
        withStory(42, "vouloir-alpha", {
          status: "in_progress",
          questionPending: true,
          runs: [
            {
              id: 17,
              status: "running",
              startedAt: "2026-11-05T10:00:00.000Z",
              finishedAt: null,
            },
          ],
        }),
      ],
      {
        runs: {
          17: run({
            run: { ...run().run, id: 17, status: "running", finishedAt: null },
            questions: [
              {
                id: 3,
                question: "Quel nom pour le bouton ?",
                suggestedAnswers: ["Valider", "Envoyer"],
                answer: null,
                context: "Deux libellés existent déjà.",
                askedAt: "2026-11-05T10:10:00.000Z",
                answeredAt: null,
              },
            ],
            verdict: null,
            story: { ...run().story, status: "in_progress" },
          }),
        },
      },
    );
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    await p.findByText("Quel nom pour le bouton ?");
    expect(p.getByText("Deux libellés existent déjà.")).toBeDefined();
    fireEvent.click(p.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(answers).toEqual([{ answer: "Envoyer" }]));
  });
});

describe("decision 084 G: the badge Issue modifiée, the ticket and the rules are links", () => {
  it("given a story whose issue changed on GitHub, when its card is opened, then the panel says it and links the choice on the page of the story", async () => {
    load(
      [
        withStory(42, "vouloir-alpha", {
          status: "ready",
          issue: {
            number: 12,
            url: "https://github.com/octocat/hello/issues/12",
            upToDate: true,
            diverged: {
              at: "2026-11-05T10:00:00.000Z",
              githubTitle: "t",
              githubBody: "b",
              cockpitTitle: "t2",
              cockpitBody: "b2",
            },
          },
        }),
      ],
      { extra: { 42: { issueDiverged: true } } },
    );
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    await p.findByText(/Issue modifiée sur GitHub/);
    expect(
      p.getByRole("link", { name: /Choisir la version/ }).getAttribute("href"),
    ).toBe("/us/42");
  });

  it("given a story of a ticket, when its card is opened, then the panel links the ticket page", async () => {
    load([withStory(42, "vouloir-alpha")]);
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    expect(
      (await p.findByRole("link", { name: /Idée A/ })).getAttribute("href"),
    ).toBe("/tickets/7");
  });

  it("given a takeover story with two rules to decide, when its card is opened, then each rule is a link to its own rule of the takeover screen", async () => {
    load([
      withStory(42, "vouloir-alpha", {
        kind: "takeover",
        criteria: [
          kriteria(210, { summary: "règle A", takeoverState: "pending" }),
          kriteria(211, { summary: "règle B", takeoverState: "pending" }),
        ],
      }),
    ]);
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    expect(
      (await p.findByRole("link", { name: "règle A" })).getAttribute("href"),
    ).toBe("/projets/5/conception/regles?regle=210");
    expect(p.getByRole("link", { name: "règle B" }).getAttribute("href")).toBe(
      "/projets/5/conception/regles?regle=211",
    );
  });
});

describe("decision 084 G: a ready card says what it waits for", () => {
  it("given a ready story blocked by the US 43, when the Kanban loads, then its card says « dépend de l'US 43 » and the others do not", async () => {
    load(
      [
        withStory(42, "vouloir-alpha", { status: "ready" }),
        withStory(44, "vouloir-bravo", { status: "ready", position: 2 }),
      ],
      { extra: { 42: { blockedBy: 43 } } },
    );
    renderAt("/projets/5");

    const blocked = await card(/vouloir-alpha/);
    expect(blocked.textContent).toContain("dépend de l'US 43");
    expect((await card(/vouloir-bravo/)).textContent).not.toContain("dépend");
  });
});

describe("decision 084 H: on a phone, opening a card brings the panel into view", () => {
  it("given the Kanban, when a card is opened, then the panel's US line takes the focus and is scrolled into view", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    load([withStory(42, "vouloir-alpha")]);
    renderAt("/projets/5");

    const p = await open(/vouloir-alpha/);

    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("US 42"),
    );
    expect(p.getByRole("link", { name: "Ouvrir l'US" })).toBeDefined();
    expect(panel().contains(document.activeElement)).toBe(true);
    expect(scroll).toHaveBeenCalled();
  });
});

describe("decision 084 E: the sentence of the page is a link to the first thing to do", () => {
  it("given a story waiting on an answer, when the Kanban loads, then « l'US 42 » of the title links ?us=42 and opens the panel", async () => {
    load([
      withStory(41, "vouloir-zero", { status: "ready" }),
      withStory(42, "vouloir-alpha", {
        status: "in_progress",
        questionPending: true,
      }),
    ]);
    renderAt("/projets/5");

    const link = await within(
      await screen.findByRole("heading", { level: 1 }),
    ).findByRole("link", { name: /US 42/ });
    expect(link.getAttribute("href")).toMatch(/\?us=42$/);
    fireEvent.click(link);

    await waitFor(() => expect(window.location.search).toBe("?us=42"));
    await waitFor(() => expect(panel()).toBeDefined());
  });

  it("given two stories to validate, when the Kanban loads, then « 2 user stories t'attendent » links ?us= of the first one", async () => {
    load([
      withStory(42, "vouloir-alpha"),
      withStory(43, "vouloir-bravo", { position: 2 }),
    ]);
    renderAt("/projets/5");

    const link = await within(
      await screen.findByRole("heading", { level: 1 }),
    ).findByRole("link", { name: /2 user stories t'attendent/ });
    expect(link.getAttribute("href")).toMatch(/\?us=42$/);
  });
});

describe("decision 084 E: a story Claude rewrites does not wait for you", () => {
  it("given one story to validate and one to rewrite, when the Kanban loads, then the title counts only the first", async () => {
    load([
      withStory(42, "vouloir-alpha"),
      withStory(43, "vouloir-bravo", { status: "to_rewrite", position: 2 }),
    ]);
    renderAt("/projets/5");

    const title = await screen.findByRole("heading", { level: 1 });
    await waitFor(() =>
      expect(title.textContent).toContain("1 user story t'attend."),
    );
  });

  it("given only a story to rewrite, when the Kanban loads, then nothing waits for you", async () => {
    load([withStory(43, "vouloir-bravo", { status: "to_rewrite" })]);
    renderAt("/projets/5");

    const title = await screen.findByRole("heading", { level: 1 });
    await waitFor(() =>
      expect(title.textContent).toContain("Rien ne t'attend sur ce projet."),
    );
  });
});
