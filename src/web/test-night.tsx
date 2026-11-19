import { vi } from "vitest";
import { empty, type HomeData, PROJECT, stubHome } from "./test-home.tsx";

// Shared by the acceptance tests of the night page (decisions 044, 070 and 083 E). Pinned:
// - GET /api/nights/current -> { night: null | { id, status, startsAt, endsAt, items }, ready, toValidate };
// - GET /api/home -> { ..., night: null | { id, startsAt, endsAt, delivered, total, workSeconds, criteriaProven, failures, items } }.

export type Call = { method: string; path: string; body: unknown };
export const story = (storyId: number, outcome: string | null = null) => ({
  storyId,
  iWant: `faire la chose ${storyId}`,
  project: PROJECT,
  estimatedSeconds: null,
  outcome,
});
export type NightOptions = {
  connected?: boolean;
  night?: {
    id: number;
    status: string;
    startsAt?: string;
    endsAt?: string;
    items: ReturnType<typeof story>[];
  };
  ready?: ReturnType<typeof story>[];
  toValidate?: ReturnType<typeof story>[];
  home?: Partial<HomeData> & { night?: unknown };
};

/** An instant of the night of 8 to 9 November, in the browser's time zone. */
export const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();
export const morningItem = (
  storyId: number,
  outcome: string | null,
  run: [string, string] | null = null,
) => ({
  storyId,
  iWant: `faire la chose ${storyId}`,
  outcome,
  startedAt: run?.[0] ?? null,
  finishedAt: run?.[1] ?? null,
});
/** The `night` of GET /api/home: the morning block. */
export const morning = (
  items: ReturnType<typeof morningItem>[],
  summary: Record<string, unknown> = {},
) => ({
  id: 1,
  startsAt: local(8, 22),
  endsAt: local(9, 7),
  delivered: items.filter((i) => i.outcome === "pr").length,
  total: items.length,
  workSeconds: 0,
  criteriaProven: 0,
  failures: 0,
  ...summary,
  items,
});

/** The home fake plus what /nuit reads (the night, the launcher, the hours); every write is recorded. */
export function stubNight(o: NightOptions = {}) {
  stubHome({ ...empty(), ...o.home } as HomeData);
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
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (method !== "GET") calls.push({ method, path, body });
      if (path === "/api/nights/current" && method === "GET")
        return Response.json({
          night: o.night ?? null,
          ready: o.ready ?? [],
          toValidate: o.toValidate ?? [],
        });
      if (path.startsWith("/api/nights/") && method === "POST")
        return Response.json({});
      if (path === "/api/me/night-hours")
        return Response.json({ startHour: 22, endHour: 7, timeZone: "UTC" });
      if (path === "/api/me/launcher")
        return Response.json({
          connected: o.connected ?? true,
          needsReconnect: false,
          prompt: "P",
          projectIds: [5],
          missingProjectIds: [],
          autoRelaunch: false,
        });
      return inner(input, init);
    }),
  );
  return calls;
}
