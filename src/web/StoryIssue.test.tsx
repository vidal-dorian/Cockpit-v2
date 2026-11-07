// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import {
  type DecisionStory,
  decisionStory,
  type HistoryEntry,
  stubDecisionApi,
} from "./test-decisions.tsx";
import { type Answer, fail, renderAt, story, ticket } from "./test-tickets.tsx";

// Slice 4.6 (decision 020 J, 010): the issue on the page /us/:id, and the Journal.
// Pinned shapes (the decision leaves them open, the server tests of issues.test.ts pin the same):
// - GET /api/stories/:id gives a `story.issue`: null when the story has no issue and should have none, otherwise
//   { number: number | null, url: string | null, upToDate: boolean }.
// - « Issue #12 » is a link to `issue.url`; « L'issue GitHub n'est pas à jour. » and a button « Republier » show when
//   `upToDate` is false; the button posts, without body, to /api/stories/:id/publish, which answers 200 { story } (with the new `issue`).
// - A refused publish shows a French role="alert": « statut » for wrong_status, « archiv » for project_archived.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Issue = { number: number | null; url: string | null; upToDate: boolean };
type WithIssue = DecisionStory & { issue: Issue | null };

const URL_12 = "https://github.com/octocat/hello/issues/12";
const main = () => screen.getByRole("main");
const button = (name: string | RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const maybeButton = (name: string | RegExp) =>
  screen.queryByRole("button", { name });
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("relire les exports"));
const STALE = "L'issue GitHub n'est pas à jour.";

/** The decision fake, plus the publish route: it brings the issue up to date (number 13 when the story had none). */
function seed(
  status: string,
  issue: Issue | null,
  options: { archived?: boolean; history?: HistoryEntry[] } = {},
) {
  const shown = decisionStory(
    story(21, 7, "relire les exports", { status }),
    null,
  ) as WithIssue;
  shown.issue = issue;
  const api = stubDecisionApi({
    tickets: [ticket(7, "Idée découpée")],
    stories: [shown],
    ...options,
  });
  const inner = globalThis.fetch;
  // `stale`: the next publish answers 200 but GitHub is still behind (`upToDate` stays false).
  const failPublish: { next?: Answer; stale?: boolean } = {};
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
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && path === "/api/stories/21/publish") {
        api.calls.push({ method, path, body: undefined });
        const refused = failPublish.next;
        failPublish.next = undefined;
        if (refused)
          return Response.json(refused.body, { status: refused.status });
        shown.issue = {
          number: shown.issue?.number ?? 13,
          url: shown.issue?.url ?? "https://github.com/octocat/hello/issues/13",
          upToDate: !failPublish.stale,
        };
        return Response.json({ story: { ...shown } });
      }
      // As the real route: the validation publishes the issue (number 12), the answer and the next read carry it.
      if (method === "POST" && path === "/api/stories/21/validate") {
        const res = await inner(input, init);
        if (!res.ok) return res;
        shown.issue = { number: 12, url: URL_12, upToDate: true };
        return Response.json({ story: { ...shown } });
      }
      return inner(input, init);
    }),
  );
  return { ...api, failPublish };
}

describe("criterion 10: the issue on the page of a story", () => {
  it("given a ready story whose issue #12 is up to date, when the page loads, then « Issue #12 » is a link to the issue on GitHub, with no warning and no Republier", async () => {
    seed("ready", { number: 12, url: URL_12, upToDate: true });

    renderAt("/us/21");

    await loaded();
    const link = within(main()).getByRole("link", { name: /Issue GitHub #12/ });
    expect(link.getAttribute("href")).toBe(URL_12);
    expect(main().textContent).not.toContain("pas à jour");
    expect(maybeButton("Republier")).toBeNull();
  });

  it("given an issue that is not up to date, when the page loads, then the warning and a Republier button are shown next to the link", async () => {
    const api = seed("ready", { number: 12, url: URL_12, upToDate: false });

    renderAt("/us/21");

    await loaded();
    expect(main().textContent).toContain(STALE);
    expect(button("Republier")).toBeDefined();
    expect(
      within(main())
        .getByRole("link", { name: /Issue GitHub #12/ })
        .getAttribute("href"),
    ).toBe(URL_12);
    expect(api.writes()).toEqual([]);
  });

  it("given an issue that is not up to date, when Republier is clicked, then it posts to /api/stories/21/publish and the warning and the button are gone", async () => {
    const api = seed("ready", { number: 12, url: URL_12, upToDate: false });
    renderAt("/us/21");
    await loaded();

    fireEvent.click(button("Republier"));

    await waitFor(() => expect(main().textContent).not.toContain(STALE));
    expect(api.writes().map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/stories/21/publish"],
    ]);
    expect(maybeButton("Republier")).toBeNull();
    expect(
      within(main())
        .getByRole("link", { name: /Issue GitHub #12/ })
        .getAttribute("href"),
    ).toBe(URL_12);
  });

  it("given a ready story whose issue could not be created (no number yet), when the page loads, then the warning and Republier are shown without any « Issue # », and after Republier the link to the new issue appears", async () => {
    seed("ready", { number: null, url: null, upToDate: false });
    renderAt("/us/21");
    await loaded();
    expect(main().textContent).toContain(STALE);
    expect(main().textContent).not.toContain("Issue GitHub #");

    fireEvent.click(button("Republier"));

    const link = await within(main()).findByRole("link", {
      name: /Issue GitHub #13/,
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/issues/13",
    );
    expect(main().textContent).not.toContain(STALE);
  });

  it("given an abandoned story whose issue is still open on GitHub (not up to date), when the page loads, then Republier is offered", async () => {
    seed("abandoned", { number: 12, url: URL_12, upToDate: false });

    renderAt("/us/21");

    await loaded();
    expect(main().textContent).toContain(STALE);
    expect(button("Republier")).toBeDefined();
  });

  it.each(["to_validate", "to_rewrite"])(
    "given a %s story that has no issue and should have none, when the page loads, then nothing about issues is shown; once Valider publishes the issue, « Issue #12 » appears without a reload",
    async (status) => {
      seed(status, null);

      renderAt("/us/21");

      await loaded();
      expect(main().textContent).not.toMatch(/issue/i);
      expect(maybeButton("Republier")).toBeNull();
      expect(within(main()).queryByRole("link", { name: /issue/i })).toBeNull();
      fireEvent.click(button("Valider"));
      const link = await within(main()).findByRole("link", {
        name: /Issue GitHub #12/,
      });
      expect(link.getAttribute("href")).toBe(URL_12);
      expect(maybeButton("Republier")).toBeNull();
    },
  );

  it.each([
    ["wrong_status", /statut/i],
    ["project_archived", /archiv/i],
  ])(
    "given a stale issue, when the server answers 409 %s to Republier, then a French alert is shown, never the code, and the warning stays",
    async (code, word) => {
      const api = seed("ready", { number: 12, url: URL_12, upToDate: false });
      renderAt("/us/21");
      await loaded();
      api.failPublish.next = fail(409, code);

      fireEvent.click(button("Republier"));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(word);
      expect(alert.textContent).not.toContain(code);
      expect(main().textContent).toContain(STALE);
    },
  );
});

describe("criterion 11: the Journal names sync_issue", () => {
  it("given a sync_issue entry, when /journal loads, then the row has a French label of its own that speaks of the issue, never the code or « Outil inconnu »", async () => {
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
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
        if (path === "/api/history")
          return Response.json({
            entries: [
              {
                id: 1,
                at: "2026-10-29T12:01:00.000Z",
                actor: "system",
                origin: "system",
                action: "sync_issue",
                result: "ok",
              },
            ],
          });
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );
    window.history.replaceState({}, "", "/journal");

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Journal" });
    const row = await waitFor(() => {
      const found = within(screen.getByRole("main")).getAllByRole("listitem");
      expect(found).toHaveLength(1);
      return found[0] as HTMLElement;
    });
    const label = row.querySelector("span")?.textContent ?? "";
    expect(label).not.toContain("sync_issue");
    expect(label).toMatch(/issue/i);
    expect(screen.queryByText("Outil inconnu")).toBeNull();
  });
});

// Review of slice 4.6 (S6): who did it, what a screen reader hears, where the focus goes.
describe("review S6: the page of a story and the Journal", () => {
  it("given a sync_issue entry made by the system, when the history of the story is opened, then the row says « Cockpit », not « Toi »", async () => {
    seed(
      "ready",
      { number: 12, url: URL_12, upToDate: true },
      {
        history: [
          {
            id: 2,
            at: "2026-10-29T12:02:00.000Z",
            action: "sync_issue",
            result: "ok",
            actor: "system",
          },
          {
            id: 1,
            at: "2026-10-29T12:01:00.000Z",
            action: "validate_story",
            result: "ok",
            actor: "human",
          },
        ],
      },
    );
    renderAt("/us/21");
    await loaded();
    const details = main().querySelector("details") as HTMLDetailsElement;

    fireEvent.click(details.querySelector("summary") as HTMLElement);
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() =>
      expect(within(details).getAllByRole("listitem")).toHaveLength(2),
    );
    const [system, human] = within(details)
      .getAllByRole("listitem")
      .map((r) => r.textContent ?? "");
    expect(system).toContain("Cockpit");
    expect(system).not.toContain("Toi");
    expect(human).toContain("Toi");
    expect(human).not.toContain("Cockpit");
  });

  it("given an entry whose origin is system, when /journal loads, then the origin is a French word, « Cockpit », never the code", async () => {
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
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
        if (path === "/api/history")
          return Response.json({
            entries: [
              {
                id: 1,
                at: "2026-10-29T12:01:00.000Z",
                actor: "system",
                origin: "system",
                action: "sync_issue",
                result: "ok",
              },
            ],
          });
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );
    window.history.replaceState({}, "", "/journal");

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Journal" });
    const row = await waitFor(() => {
      const found = within(screen.getByRole("main")).getAllByRole("listitem");
      expect(found).toHaveLength(1);
      return found[0] as HTMLElement;
    });
    expect(row.textContent).toContain("Cockpit");
    expect(row.textContent).not.toMatch(/\bsystem\b/);
  });

  it("given Republier answers 200 but the issue is still not up to date, when it is clicked, then an alert says so in French, the warning stays and Republier can be clicked again", async () => {
    const api = seed("ready", { number: 12, url: URL_12, upToDate: false });
    renderAt("/us/21");
    await loaded();
    api.failPublish.stale = true;

    fireEvent.click(button("Republier"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/issue|GitHub/i);
    expect(alert.textContent).not.toMatch(/upToDate|wrong_status|HTTP/);
    expect(main().textContent).toContain(STALE);
    await waitFor(() => expect(button("Republier").disabled).toBe(false));
  });

  it("given an issue that is not up to date, when the page loads, then the warning is in a live region (role status)", async () => {
    seed("ready", { number: 12, url: URL_12, upToDate: false });

    renderAt("/us/21");

    await loaded();
    expect(within(main()).getByRole("status").textContent).toContain(STALE);
  });

  it.each([
    ["a link already there", { number: 12, url: URL_12, upToDate: false }, 12],
    ["no issue yet", { number: null, url: null, upToDate: false }, 13],
  ])(
    "given %s, when Republier succeeds, then the focus is on the link of the issue",
    async (_case, issue, number) => {
      seed("ready", issue);
      renderAt("/us/21");
      await loaded();

      fireEvent.click(button("Republier"));

      const link = await within(main()).findByRole("link", {
        name: new RegExp(`Issue GitHub #${number}`),
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(
          within(main()).getByRole("link", {
            name: new RegExp(`Issue GitHub #${number}`),
          }),
        );
      });
      expect(link.getAttribute("href")).toContain(`/issues/${number}`);
    },
  );
});
