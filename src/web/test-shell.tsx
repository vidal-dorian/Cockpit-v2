import { vi } from "vitest";
import { empty, type HomeData, stubHome } from "./test-home.tsx";
import { stubTicketApi } from "./test-tickets.tsx";

// Shared by the acceptance tests of slice 9.3 (decision 045). The shell reads /api/home, /api/health and /api/me
// whatever the page; these helpers add what the shell sends (the idea, the logout) to the existing fakes.

export type Sent = { method: string; path: string; body: unknown };

function wrap(
  home: HomeData | null,
  options: { ticketStatus?: number; ticketsToo: boolean },
) {
  const inner = globalThis.fetch;
  const sent: Sent[] = [];
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
      if (home && path === "/api/home" && method === "GET")
        return Response.json(home);
      if (home && path === "/api/history" && method === "GET")
        return Response.json({ entries: [], hasMore: false });
      const isIdea =
        options.ticketsToo &&
        method === "POST" &&
        /^\/api\/projects\/\d+\/tickets$/.test(path);
      if (isIdea || (method === "POST" && path === "/api/auth/logout")) {
        const text =
          typeof init?.body === "string"
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : "";
        sent.push({ method, path, body: text ? JSON.parse(text) : undefined });
        if (path === "/api/auth/logout") return Response.json({ ok: true });
        if (options.ticketStatus && options.ticketStatus !== 201)
          return Response.json(
            { error: "x" },
            { status: options.ticketStatus },
          );
        return Response.json({ ticket: { id: 100 } }, { status: 201 });
      }
      return inner(input, init);
    }),
  );
  return sent;
}

/** The home fake (stubHome) plus the idea POST and the logout. */
export function stubShell(
  home: Partial<HomeData> = {},
  options: { loggedIn?: boolean; ticketStatus?: number } = {},
) {
  const api = stubHome({ ...empty(), ...home }, options.loggedIn ?? true);
  const sent = wrap(null, { ...options, ticketsToo: true });
  return { ...api, sent };
}

/** The fake of the project 5 pages (stubTicketApi) plus /api/home for the shell. */
export function stubProjectShell(
  home: Partial<HomeData>,
  tickets: Parameters<typeof stubTicketApi>[0],
  stories: Parameters<typeof stubTicketApi>[1] = [],
) {
  const api = stubTicketApi(tickets, stories);
  wrap({ ...empty(), ...home }, { ticketsToo: false });
  return api;
}

export const panel = () => {
  const found = document.querySelector<HTMLElement>("aside[data-panel]");
  if (!found) throw new Error("no right panel (aside[data-panel])");
  return found;
};

/** Adds GET /api/home to whatever fetch fake is already stubbed. */
export function withHome(home: Partial<HomeData> = {}) {
  wrap({ ...empty(), ...home }, { ticketsToo: false });
}
