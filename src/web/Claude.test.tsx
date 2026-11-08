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

// Slice 14.3 (decision 058 F): the page « Claude » at /claude.
//
// Data source chosen: one new route GET /api/claude for what no existing route gives, plus GET /api/queue (decision 058 B).
//   GET /api/claude -> { questions: [{ questionId, question, runId, storyId, iWant, project: { id, name } }],
//     running: [{ runId, storyId, iWant, project, step: string | null, cloud: boolean }],
//     finishedToday: [{ runId, storyId, iWant, project, outcome: "succeeded" | "failed" }],
//     readyStories: [{ storyId, iWant, project }] }   (readyStories: ready, not queued, of the projects ticked in the launcher)
//   GET /api/queue -> { paused, pausedReason, items: [{ storyId, iWant, projectId, projectName, waiting }] }
// - Four <section>s found by their heading (level 2): « Maintenant », « En cours », « File d'attente », « Finis aujourd'hui ».
// - Each queue row is a listitem with the buttons « Monter », « Descendre » and « Retirer » (labelled ↑ ↓ ✕); they call
//   PUT /api/queue { storyIds } (the new order) and DELETE /api/queue/:storyId.
// - « + Ajouter une US » opens a list of the readyStories, each a button named by its iWant, which POSTs /api/queue { storyId }.
// - « Mettre en pause » / « Reprendre » POST /api/queue/pause and /resume.

type Call = { method: string; path: string; body: unknown };
const project = { id: 5, name: "octocat/hello" };
const item = (storyId: number, iWant: string, waiting: unknown = null) => ({
  storyId,
  iWant,
  projectId: 5,
  projectName: "octocat/hello",
  waiting,
});

function stub(
  claude: Record<string, unknown> = {},
  queue: Record<string, unknown> = {},
) {
  const api = stubHome(empty());
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
      if (path === "/api/claude")
        return Response.json({
          questions: [],
          running: [],
          finishedToday: [],
          readyStories: [],
          ...claude,
        });
      if (path.startsWith("/api/queue")) {
        calls.push({
          method,
          path,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        return method === "GET"
          ? Response.json({
              paused: false,
              pausedReason: null,
              items: [],
              ...queue,
            })
          : Response.json({}, { status: method === "POST" ? 201 : 200 });
      }
      return inner(input, init);
    }),
  );
  return { calls, api };
}

const section = async (name: string) =>
  (await screen.findByRole("heading", { level: 2, name })).closest(
    "section",
  ) as HTMLElement;
const sent = (calls: Call[], method: string, path: string) =>
  calls.find((c) => c.method === method && c.path === path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("criterion 5: the page Claude", () => {
  it("given a user, when a page loads, then the sidebar link Claude goes to /claude", async () => {
    stub();
    renderAt("/");

    const link = await within(
      await screen.findByRole("complementary"),
    ).findByRole("link", { name: /^Claude/ });

    expect(link.getAttribute("href")).toBe("/claude");
  });

  it("given a question, two running runs and a finished one, when the page loads, then Maintenant, En cours and Finis aujourd'hui show them, the question with « Répondre » to its run", async () => {
    stub({
      questions: [
        {
          questionId: 7,
          question: "Quelle couleur ?",
          runId: 31,
          storyId: 42,
          iWant: "Choisir",
          project,
        },
      ],
      running: [
        {
          runId: 31,
          storyId: 42,
          iWant: "Choisir",
          project,
          step: "developer",
          cloud: true,
        },
        {
          runId: 32,
          storyId: 43,
          iWant: "Ranger",
          project,
          step: null,
          cloud: false,
        },
      ],
      finishedToday: [
        {
          runId: 20,
          storyId: 40,
          iWant: "Fini hier soir",
          project,
          outcome: "succeeded",
        },
      ],
    });
    renderAt("/claude");

    const now = await section("Maintenant");
    const running = await section("En cours");
    const done = await section("Finis aujourd'hui");

    expect(now.textContent).toContain("Quelle couleur ?");
    expect(
      within(now)
        .getByRole("link", { name: /Répondre/ })
        .getAttribute("href"),
    ).toBe("/runs/31");
    expect(running.textContent).toMatch(/Choisir[\s\S]*cloud/);
    expect(running.textContent).toMatch(/Ranger[\s\S]*ce PC/);
    expect(done.textContent).toContain("Fini hier soir");
  });

  it("given a queue of three with a skipped story and a paused queue, when the page loads, then File d'attente shows the rows in order, the skip reason and the pause reason in French, and « Reprendre »", async () => {
    stub(
      {},
      {
        paused: true,
        pausedReason: "run_failed",
        items: [
          item(1, "Première"),
          item(2, "Seconde", { reason: "not_ready" }),
          item(3, "Troisième", { reason: "dependency", storyId: 9 }),
        ],
      },
    );
    renderAt("/claude");

    const queue = await section("File d'attente");

    const text = queue.textContent ?? "";
    expect(text.indexOf("Première")).toBeLessThan(text.indexOf("Seconde"));
    expect(text.indexOf("Seconde")).toBeLessThan(text.indexOf("Troisième"));
    for (const code of ["run_failed", "not_ready", "dependency"])
      expect(text).not.toContain(code);
    const rows = within(queue).getAllByRole("listitem");
    expect(
      rows[1]?.textContent?.replace(/Seconde|octocat\/hello/g, "").trim()
        .length,
    ).toBeGreaterThan(5);
    expect(
      within(queue).getByRole("button", { name: "Reprendre" }),
    ).toBeDefined();
    expect(
      within(queue).queryByRole("button", { name: "Mettre en pause" }),
    ).toBeNull();
    expect(
      text
        .replace(
          /Première|Seconde|Troisième|octocat\/hello|Reprendre|File d'attente/g,
          "",
        )
        .trim().length,
    ).toBeGreaterThan(30);
  });

  it("given a queue of two, when ↓ is clicked on the first, then PUT /api/queue sends the swapped order, and ✕ on the second sends DELETE /api/queue/2", async () => {
    const { calls } = stub(
      {},
      { items: [item(1, "Première"), item(2, "Seconde")] },
    );
    renderAt("/claude");
    const rows = within(await section("File d'attente")).getAllByRole(
      "listitem",
    );

    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Descendre" }),
    );
    await waitFor(() => expect(sent(calls, "PUT", "/api/queue")).toBeDefined());
    expect(sent(calls, "PUT", "/api/queue")?.body).toEqual({
      storyIds: [2, 1],
    });
    fireEvent.click(
      within(rows[1] as HTMLElement).getByRole("button", { name: "Retirer" }),
    );

    await waitFor(() =>
      expect(sent(calls, "DELETE", "/api/queue/2")).toBeDefined(),
    );
  });

  it("given a queue not paused and a ready story, when « Mettre en pause » is clicked and then a story is added, then POST /api/queue/pause and POST /api/queue { storyId } are sent", async () => {
    const { calls } = stub({
      readyStories: [{ storyId: 8, iWant: "Prête à lancer", project }],
    });
    renderAt("/claude");
    const queue = await section("File d'attente");

    fireEvent.click(
      await within(queue).findByRole("button", { name: "Mettre en pause" }),
    );
    fireEvent.click(
      within(queue).getByRole("button", { name: "+ Ajouter une US" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Prête à lancer/ }),
    );

    await waitFor(() =>
      expect(sent(calls, "POST", "/api/queue")).toBeDefined(),
    );
    expect(sent(calls, "POST", "/api/queue")?.body).toEqual({ storyId: 8 });
    expect(sent(calls, "POST", "/api/queue/pause")).toBeDefined();
  });

  it("given the page, when it loads, then a link « Tâches programmées » leads to /claude/taches", async () => {
    stub();
    renderAt("/claude");

    const link = await screen.findByRole("link", {
      name: /Tâches programmées/,
    });

    expect(link.getAttribute("href")).toBe("/claude/taches");
  });
});
