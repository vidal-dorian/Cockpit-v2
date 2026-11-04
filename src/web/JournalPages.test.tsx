// @vitest-environment jsdom
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

// Decision 028 F: the Journal shows 25 entries, then « Afficher plus » while `hasMore` is true.
//
// Pinned choices (the decision leaves them open):
// - GET /api/history answers { entries, hasMore }; the first request has no `before`, the next one `?before=<id of the last entry shown>`.
// - The button is a <button> named « Afficher plus »; while the next page is read it is disabled and « Chargement… » is shown in the page.
// - A failed next page shows a role="alert" holding a « Réessayer » button that sends the same request again; entries already shown stay.
// - One entry is one <time> element (its date), so the rows are counted by their dates.

type Entry = {
  id: number;
  at: string;
  actor: string;
  origin: string;
  action: string;
  result: string;
};
type Page = { entries: Entry[]; hasMore: boolean };

/** Entries newest first: ids from `from` down, one minute apart, so the id tells the row. */
const entries = (from: number, count: number, action = "login"): Entry[] =>
  Array.from({ length: count }, (_, i) => ({
    id: from - i,
    at: new Date(Date.UTC(2026, 9, 22, 12, from - i)).toISOString(),
    actor: "human",
    origin: "ui",
    action,
    result: "ok",
  }));

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

/** `history` answers each request of the page; the requests are recorded with their `before`. */
function stubApi(
  history: (before: string | null) => Response | Promise<Response>,
) {
  const befores: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, "http://localhost");
      if (url.pathname === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (url.pathname === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (url.pathname === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (url.pathname === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/x",
        });
      if (url.pathname === "/api/history") {
        const before = url.searchParams.get("before");
        befores.push(before);
        return history(before);
      }
      throw new Error(`Unexpected fetch ${raw}`);
    }),
  );
  return befores;
}

const rows = () => screen.getByRole("main").querySelectorAll("time");
const more = () => screen.findByRole("button", { name: "Afficher plus" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Journal, Afficher plus (decision 028 F)", () => {
  it("given 25 entries and hasMore true, when /journal loads, then the 25 rows are shown with an Afficher plus button and the first request has no before", async () => {
    const befores = stubApi(() =>
      Response.json({ entries: entries(40, 25), hasMore: true } satisfies Page),
    );

    renderAt("/journal");

    expect(await more()).toBeDefined();
    expect(rows()).toHaveLength(25);
    expect(befores).toEqual([null]);
  });

  it("given 25 entries and hasMore true, when Afficher plus is clicked, then ?before=<id of the last entry> is requested and the received entries are added below the first 25", async () => {
    const befores = stubApi((before) =>
      before === null
        ? Response.json({
            entries: entries(30, 25),
            hasMore: true,
          } satisfies Page)
        : Response.json({
            entries: entries(5, 5),
            hasMore: false,
          } satisfies Page),
    );
    renderAt("/journal");

    fireEvent.click(await more());

    await waitFor(() => expect(rows()).toHaveLength(30));
    // The last entry of the first page has the id 6.
    expect(befores).toEqual([null, "6"]);
    const dates = [...rows()].map((t) => t.getAttribute("datetime"));
    expect(dates).toEqual(
      [...entries(30, 25), ...entries(5, 5)].map((e) => e.at),
    );
  });

  it("given the last page (hasMore false), when it is added, then the Afficher plus button is gone", async () => {
    stubApi((before) =>
      before === null
        ? Response.json({
            entries: entries(30, 25),
            hasMore: true,
          } satisfies Page)
        : Response.json({
            entries: entries(5, 5),
            hasMore: false,
          } satisfies Page),
    );
    renderAt("/journal");
    fireEvent.click(await more());
    await waitFor(() => expect(rows()).toHaveLength(30));

    expect(screen.queryByRole("button", { name: "Afficher plus" })).toBeNull();
  });

  it("given hasMore false on the first page, when /journal loads, then there is no Afficher plus button", async () => {
    stubApi(() =>
      Response.json({ entries: entries(3, 3), hasMore: false } satisfies Page),
    );

    renderAt("/journal");

    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Afficher plus" })).toBeNull();
  });

  it("given the next page is being read, when Afficher plus was clicked, then Chargement… is shown, the button is disabled and the entries stay", async () => {
    let release: (res: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stubApi((before) =>
      before === null
        ? Response.json({
            entries: entries(30, 25),
            hasMore: true,
          } satisfies Page)
        : slow,
    );
    renderAt("/journal");

    fireEvent.click(await more());

    expect((await screen.findAllByText("Chargement…")).length).toBeGreaterThan(
      0,
    );
    const button = screen.getByRole("button", {
      name: /Afficher plus|Chargement/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(rows()).toHaveLength(25);
    release(
      Response.json({ entries: entries(5, 5), hasMore: false } satisfies Page),
    );
    await waitFor(() => expect(rows()).toHaveLength(30));
    expect(screen.queryByText("Chargement…")).toBeNull();
  });

  it("given the next page fails, when Afficher plus is clicked, then the entries already shown stay, an alert says so, and Réessayer sends the same request again", async () => {
    let failing = true;
    const befores = stubApi((before) => {
      if (before === null)
        return Response.json({
          entries: entries(30, 25),
          hasMore: true,
        } satisfies Page);
      return failing
        ? Response.json({ error: "boom" }, { status: 500 })
        : Response.json({
            entries: entries(5, 5),
            hasMore: false,
          } satisfies Page);
    });
    renderAt("/journal");
    fireEvent.click(await more());

    const alert = await screen.findByRole("alert");
    expect(rows()).toHaveLength(25);
    failing = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));

    await waitFor(() => expect(rows()).toHaveLength(30));
    expect(befores).toEqual([null, "6", "6"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Afficher plus" })).toBeNull();
  });

  it("given an entry change_public_url already written, when /journal loads, then it keeps its label Adresse publique modifiée (decision 028 I)", async () => {
    stubApi(() =>
      Response.json({
        entries: entries(1, 1, "change_public_url"),
        hasMore: false,
      } satisfies Page),
    );

    renderAt("/journal");

    expect(await screen.findByText("Adresse publique modifiée")).toBeDefined();
  });
});
