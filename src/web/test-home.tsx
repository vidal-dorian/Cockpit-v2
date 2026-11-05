import { vi } from "vitest";

// Shared by the tests of slice 8.1 (decision 040). Pinned: GET /api/home answers
// { forYou: Item[], claudeWorks: Work[], projects: { id, name, state: "for_you" | "claude" | "idle" }[] } with
//   Item = { kind: "answer", questionId, question, suggestedAnswers, runId, storyId, iWant, project: { id, name } }
//        | { kind: "validate", storyId, iWant, project }
//        | { kind: "review", storyId, iWant, prNumber, prCiState, project }
//        | { kind: "check", storyId, iWant, runId, reasons: string[], project }
//   Work = { runId, storyId, iWant, project, step: string | null }

export type Project = { id: number; name: string };
export type HomeData = {
  forYou: Record<string, unknown>[];
  claudeWorks: Record<string, unknown>[];
  projects: { id: number; name: string; state: string }[];
};

export const PROJECT: Project = { id: 5, name: "octocat/hello" };
export const empty = (): HomeData => ({
  forYou: [],
  claudeWorks: [],
  projects: [],
});

type Listener = (event: { data: string }) => void;
export class FakeEventSource {
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

/** A logged-in user (or not) and a fake GET /api/home; every call is recorded. */
export function stubHome(initial: HomeData, loggedIn = true) {
  const state = { home: initial };
  const calls: { method: string; path: string; body: unknown }[] = [];
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return loggedIn
          ? Response.json({ login: "octocat", name: null, avatarUrl: null })
          : Response.json({ error: "Unauthorized" }, { status: 401 });
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (path === "/api/home" && method === "GET")
        return Response.json(state.home);
      if (/^\/api\/questions\/\d+\/answer$/.test(path) && method === "POST")
        return Response.json({ question: { id: 1, answer: body?.answer } });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return {
    state,
    calls,
    homeReads: () =>
      calls.filter((c) => c.method === "GET" && c.path === "/api/home").length,
  };
}
