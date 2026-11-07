// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.4 (decision 036 F, G): the section « Questions » of the page of a run. Pinned: GET /api/runs/:id also gives
// questions: [{ id, question, suggestedAnswers: string[] | null, answer: string | null, askedAt, answeredAt }] and the
// page answers with POST /api/questions/:id/answer { answer }, then refetches the run.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const question = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  question: `Question ${id} ?`,
  suggestedAnswers: null,
  answer: null,
  askedAt: `2026-11-05T10:0${id}:00.000Z`,
  answeredAt: null,
  ...over,
});

function stubApi(questions: object[], status = "running") {
  const posts: { path: string; body: unknown }[] = [];
  let runReads = 0;
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
      if (path === "/api/runs/12") {
        runReads++;
        return Response.json({
          run: {
            id: 12,
            status,
            branch: "us/42-login",
            model: "claude-x",
            comment: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt:
              status === "running" ? null : "2026-11-05T11:00:00.000Z",
          },
          steps: [],
          story: { id: 21, iWant: "relire les exports" },
          project: { id: 5, name: "octocat/hello" },
          criteria: [],
          questions,
        });
      }
      if (path.startsWith("/api/questions/") && init?.method === "POST") {
        posts.push({ path, body: JSON.parse(String(init.body)) });
        return Response.json({ question: { id: 1 } });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return { posts, reads: () => runReads };
}

// The pending question is in the right panel (S29), the others in a Questions list: both are inside the page's main.
const section = async () => {
  await screen.findAllByText(/Question [12] \?/);
  return screen.getByRole("main");
};

describe("criterion 7: the Questions section of the run page", () => {
  it("given a pending question with two suggested answers, when I click Valider, then it POSTs { answer: Valider } to /api/questions/:id/answer and the page refetches", async () => {
    const api = stubApi([
      question(1, { suggestedAnswers: ["Valider", "Envoyer"] }),
    ]);
    renderAt("/runs/12");
    const box = within(await section());
    expect(box.getByText("Question 1 ?")).toBeTruthy();
    expect(box.getByRole("button", { name: "Envoyer" })).toBeTruthy();
    const reads = api.reads();

    fireEvent.click(box.getByRole("button", { name: "Valider" }));

    await waitFor(() =>
      expect(api.posts).toEqual([
        { path: "/api/questions/1/answer", body: { answer: "Valider" } },
      ]),
    );
    await waitFor(() => expect(api.reads()).toBeGreaterThan(reads));
  });

  it("given a pending question, when I type in Ta réponse and click Répondre, then it POSTs the typed answer", async () => {
    const api = stubApi([question(1)]);
    renderAt("/runs/12");
    const box = within(await section());

    fireEvent.change(box.getByLabelText("Ta réponse"), {
      target: { value: "Plutôt Confirmer" },
    });
    fireEvent.click(box.getByRole("button", { name: "Répondre" }));

    await waitFor(() =>
      expect(api.posts).toEqual([
        {
          path: "/api/questions/1/answer",
          body: { answer: "Plutôt Confirmer" },
        },
      ]),
    );
  });

  it("given an answered and a pending question, when the page loads, then the pending one comes first and the answered one shows its answer with no field", async () => {
    stubApi([
      question(1, {
        answer: "Valider",
        answeredAt: "2026-11-05T10:05:00.000Z",
        suggestedAnswers: ["Valider", "Envoyer"],
      }),
      question(2),
    ]);
    renderAt("/runs/12");

    const box = await section();

    // the pending one is the panel's question, the answered one is in the list with its answer
    const panel = within(
      screen.getByRole("complementary", { name: "Question de Claude" }),
    );
    expect(panel.getByText("Question 2 ?")).toBeTruthy();
    expect(panel.queryByText("Question 1 ?")).toBeNull();
    const list = within(
      screen
        .getByRole("heading", { name: "Questions" })
        .closest("section") as HTMLElement,
    );
    expect(list.getByText("Question 1 ?")).toBeTruthy();
    expect(list.getByText("Valider")).toBeTruthy();
    expect(within(box).getAllByLabelText("Ta réponse")).toHaveLength(1);
    expect(
      within(box).getAllByRole("button", { name: "Répondre" }),
    ).toHaveLength(1);
    // the suggested answers of an answered question are no longer buttons
    expect(within(box).queryByRole("button", { name: "Envoyer" })).toBeNull();
  });

  it("given the last pending question, when I answer it, then the focus is on the page title, not on the body", async () => {
    stubApi([question(1)]);
    renderAt("/runs/12");
    const box = within(await section());

    fireEvent.change(box.getByLabelText("Ta réponse"), {
      target: { value: "Oui" },
    });
    fireEvent.click(box.getByRole("button", { name: "Répondre" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 1 }),
      ),
    );
  });

  it("given a finished run with a pending question, when the page loads, then it shows Sans réponse and no field", async () => {
    stubApi([question(1, { suggestedAnswers: ["Valider"] })], "failed");
    renderAt("/runs/12");

    const box = within(await section());

    expect(box.getByText("Question 1 ?")).toBeTruthy();
    expect(box.getByText("Sans réponse")).toBeTruthy();
    expect(box.queryByLabelText("Ta réponse")).toBeNull();
    expect(box.queryByRole("button", { name: "Répondre" })).toBeNull();
    expect(box.queryByRole("button", { name: "Valider" })).toBeNull();
  });
});
