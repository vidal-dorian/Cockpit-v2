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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("slice 9.3: the question of a run in the right panel (S29)", () => {
  it("given a run with a pending question, when /runs/12 loads, then the question and its answer form are in a complementary landmark named Question de Claude", async () => {
    const posts: unknown[] = [];
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
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
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
            criteria: [],
            questions: [
              {
                id: 1,
                question: "Quel nom pour le bouton ?",
                suggestedAnswers: ["Valider", "Envoyer"],
                answer: null,
                askedAt: "2026-11-05T10:01:00.000Z",
                answeredAt: null,
              },
            ],
          });
        if (path === "/api/questions/1/answer" && init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return Response.json({ question: { id: 1 } });
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      }),
    );
    renderAt("/runs/12");

    const side = within(
      await screen.findByRole("complementary", { name: "Question de Claude" }),
    );
    expect(side.getByText("Quel nom pour le bouton ?")).toBeDefined();
    fireEvent.click(side.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(posts).toEqual([{ answer: "Envoyer" }]));
  });
});
