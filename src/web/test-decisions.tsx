// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { vi } from "vitest";
import {
  type Answer,
  type Call,
  type FakeStory,
  type FakeTicket,
  stubTicketApi,
} from "./test-tickets.tsx";

// Shared by the web tests of slice 4.4 (decision 018). It lays the routes of the human decisions over the fake server
// of test-tickets.tsx (project 5, octocat/hello), so the tests of the ticket and story pages keep one fake.
//
// Pinned shapes (the decision leaves them open, the server tests of story-decisions.test.ts pin the same):
// - GET /api/stories/:id gives { story: { ..., rewriteComment: string | null }, ticket, project: { id, fullName, archived } }
// - POST /api/stories/:id/validate | send-back { comment } | abandon, PATCH /api/stories/:id answer 200 { story };
//   POST /api/tickets/:id/abandon answers 200 { ticket }; a refusal answers { error: <code> } with its status.
// - GET /api/stories/:id/history gives { entries: [{ id, at, action, result, actor }] }, newest first.

export type DecisionStory = FakeStory & { rewriteComment: string | null };
export type HistoryEntry = {
  /** Numeric id of the history row: the page keys its list on it. */
  id: number;
  at: string;
  action: string;
  result: string;
  actor: string;
};
export type Decision = "validate" | "sendBack" | "edit" | "abandon";

export const decisionStory = (
  story: FakeStory,
  rewriteComment: string | null = null,
): DecisionStory => ({ ...story, rewriteComment });

/** Stubs fetch with the fake ticket API plus the decisions. `failNext` makes the next call of that kind answer something else. */
export function stubDecisionApi(options: {
  tickets: FakeTicket[];
  stories: DecisionStory[];
  archived?: boolean;
  history?: HistoryEntry[];
}) {
  const { tickets, stories } = options;
  const base = stubTicketApi(tickets, stories);
  const inner = globalThis.fetch;
  const calls: Call[] = [];
  const failNext: Partial<Record<Decision | "abandonTicket", Answer>> = {};
  const state = { archived: options.archived ?? false };
  const history = options.history ?? [];

  const take = (kind: Decision | "abandonTicket") => {
    const answer = failNext[kind];
    failNext[kind] = undefined;
    return answer && Response.json(answer.body, { status: answer.status });
  };
  const wrongStatus = () =>
    Response.json({ error: "wrong_status" }, { status: 409 });

  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
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
      const text =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ method, path, body });

      const storyRoute = /^\/api\/stories\/([^/]+)(\/[a-z-]+)?$/.exec(path);
      const found = storyRoute
        ? stories.find((s) => String(s.id) === storyRoute[1])
        : undefined;
      if (storyRoute && found) {
        const suffix = storyRoute[2];
        if (method === "GET" && !suffix) {
          const parent = tickets.find((t) => t.id === found.ticketId);
          return Response.json({
            story: { ...found },
            ticket: { id: parent?.id, title: parent?.title },
            project: {
              id: 5,
              fullName: "octocat/hello",
              archived: state.archived,
            },
          });
        }
        if (method === "GET" && suffix === "/history")
          return Response.json({ entries: history });
        if (method === "POST" && suffix === "/validate") {
          const refused = take("validate");
          if (refused) return refused;
          if (!["to_validate", "to_rewrite"].includes(found.status))
            return wrongStatus();
          found.status = "ready";
          found.rewriteComment = null;
          return Response.json({ story: { ...found } });
        }
        if (method === "POST" && suffix === "/send-back") {
          const refused = take("sendBack");
          if (refused) return refused;
          if (found.status !== "to_validate") return wrongStatus();
          found.status = "to_rewrite";
          found.rewriteComment = String(body?.comment ?? "").trim();
          return Response.json({ story: { ...found } });
        }
        if (method === "PATCH" && !suffix) {
          const refused = take("edit");
          if (refused) return refused;
          found.asA = body.asA;
          found.iWant = body.iWant;
          found.soThat = body.soThat;
          found.notesMd = body.notesMd ?? "";
          found.criteria = (body.criteria as FakeStory["criteria"]).map(
            (c, i) => ({ ...c, id: 900 + i, position: i + 1 }),
          );
          return Response.json({ story: { ...found } });
        }
        if (method === "POST" && suffix === "/abandon") {
          const refused = take("abandon");
          if (refused) return refused;
          found.status = "abandoned";
          found.rewriteComment = null;
          return Response.json({ story: { ...found } });
        }
      }
      const abandon = /^\/api\/tickets\/([^/]+)\/abandon$/.exec(path);
      if (abandon && method === "POST") {
        const parent = tickets.find((t) => String(t.id) === abandon[1]);
        if (!parent)
          return Response.json({ error: "Not found" }, { status: 404 });
        const refused = take("abandonTicket");
        if (refused) return refused;
        parent.step = "abandoned";
        parent.abandonedAt = new Date().toISOString();
        for (const s of stories)
          if (s.ticketId === parent.id && s.status !== "done")
            s.status = "abandoned";
        return Response.json({ ticket: { ...parent } });
      }
      return inner(input, init);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    failNext,
    state,
    base,
    /** The writes the page sent (everything but GET). */
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}
