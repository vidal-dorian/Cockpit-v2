// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.1 (decision 033 H, I): the page of a run at /runs/:id, reloaded on each `change` event of `run:<id>`.
// Pinned: GET /api/runs/:id -> { run: { id, status, branch, model, comment, summary, startedAt, finishedAt },
// steps: [{ id, agent, status, summary, startedAt, finishedAt }], story: { id, iWant }, project: { id, name } }.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Listener = (event: { data: string }) => void;
class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners = new Map<string, Listener[]>();
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: string) {
    if (this.closed) return;
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

const run = (over: Record<string, unknown> = {}) => ({
  id: 12,
  status: "running",
  branch: "us/42-login",
  model: "claude-x",
  comment: "Fais attention au CSS",
  summary: null,
  startedAt: "2026-11-05T10:00:00.000Z",
  finishedAt: null,
  ...over,
});
const stepOf = (id: number, agent: string, over = {}) => ({
  id,
  agent,
  status: "running",
  summary: null,
  startedAt: "2026-11-05T10:00:00.000Z",
  finishedAt: null,
  ...over,
});

function stubApi(initial: { run: object; steps: object[] }) {
  const state = { ...initial };
  let runReads = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.all = [];
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
      if (path === "/api/runs/12") {
        runReads++;
        return Response.json({
          ...state,
          story: { id: 21, iWant: "relire les exports" },
          project: { id: 5, name: "octocat/hello" },
        });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return { state, reads: () => runReads };
}

const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("Run 12"));

describe("criterion 8: the run page", () => {
  it("given a running run with a step, when /runs/12 loads, then it shows the title, the story link, the French status, branch, model, comment and the step", async () => {
    stubApi({
      run: run(),
      steps: [
        stepOf(1, "test-writer", {
          status: "succeeded",
          summary: "Tests écrits",
        }),
        stepOf(2, "developer"),
      ],
    });

    renderAt("/runs/12");

    await loaded();
    const text = main().textContent ?? "";
    expect(text).toContain("En cours");
    expect(text).toContain("us/42-login");
    expect(text).toContain("claude-x");
    expect(text).toContain("Fais attention au CSS");
    expect(text).toContain("test-writer");
    expect(text).toContain("Tests écrits");
    expect(text).toContain("developer");
    expect(text).toContain("Réussi");
    const link = within(main()).getByRole("link", {
      name: /relire les exports/,
    });
    expect(link.getAttribute("href")).toBe("/us/21");
  });

  it.each([
    ["succeeded", "Réussi"],
    ["failed", "Échoué"],
    ["stopped", "Arrêté"],
    ["closed_manually", "Fermé à la main"],
  ])(
    "given a run %s, when the page loads, then the status reads %s and the run summary is shown",
    async (status, label) => {
      stubApi({
        run: run({
          status,
          summary: "Le résumé final",
          finishedAt: "2026-11-05T10:30:00.000Z",
        }),
        steps: [],
      });

      renderAt("/runs/12");

      await loaded();
      expect(main().textContent).toContain(label);
      expect(main().textContent).not.toContain("En cours");
      expect(main().textContent).toContain("Le résumé final");
      expect(main().textContent).not.toContain(status);
    },
  );

  it("given an open stream, when a change run:12 event arrives, then the page refetches and shows the new step; another key does not refetch", async () => {
    const api = stubApi({ run: run(), steps: [stepOf(1, "test-writer")] });
    renderAt("/runs/12");
    await loaded();
    await waitFor(() => expect(FakeEventSource.all.length).toBeGreaterThan(0));
    const source = FakeEventSource.all[0] as FakeEventSource;
    expect(source.url).toBe("/api/events");
    expect(main().textContent).not.toContain("reviewer");
    const before = api.reads();

    source.emit("change", "run:99");
    await new Promise((r) => setTimeout(r, 50));
    expect(api.reads()).toBe(before);

    api.state.steps = [stepOf(1, "test-writer"), stepOf(2, "reviewer")];
    source.emit("change", "run:12");

    await waitFor(() => expect(main().textContent).toContain("reviewer"));
    expect(api.reads()).toBeGreaterThan(before);
  });
});
