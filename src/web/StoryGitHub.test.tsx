// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 7.6 (decision 038 G, H): the block « GitHub » of the page /us/:id.
// Pinned: GET /api/stories/:id gives story.prNumber, story.prCiState (pending | success | failure | null) and story.prReviewState
// (approved | changes_requested | null); the block is an <h2>« GitHub »</h2> in a <section>; « Actualiser » posts, without body, to
// /api/stories/:id/pr/refresh, which answers 200 { story } (the story as GET gives it); the page reloads on the `change` event of `story:<id>`.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Listener = (event: { data: string }) => void;
class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners = new Map<string, Listener[]>();
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {}
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

type Shown = ReturnType<typeof story> & Record<string, unknown>;
const main = () => screen.getByRole("main");
/** The block titled « GitHub », null when there is none. */
const block = () =>
  (
    screen.queryByRole("heading", { name: "GitHub" })?.closest("section") ??
    null
  )?.textContent ?? null;
const theBlock = () => {
  const found = block();
  expect(found, "the block « GitHub »").not.toBeNull();
  return found as string;
};
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("relire les exports"));

function seed(over: Record<string, unknown>) {
  const shown = {
    ...story(21, 7, "relire les exports", { status: "in_review" }),
    prNumber: 12,
    prCiState: null,
    prReviewState: null,
    ...over,
  } as Shown;
  const api = stubTicketApi([ticket(7, "Idée")], [shown]);
  const inner = globalThis.fetch;
  const refresh: { answer: Record<string, unknown> | null } = { answer: null };
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
      if (method === "POST" && path === "/api/stories/21/pr/refresh") {
        api.calls.push({ method, path, body: init?.body });
        Object.assign(shown, refresh.answer ?? {});
        return Response.json({ story: { ...shown } });
      }
      return inner(input, init);
    }),
  );
  return { ...api, shown, refresh };
}

describe("criterion 8: the block « GitHub » of the story page", () => {
  it("given a story in_review with prNumber 12, when /us/21 loads, then the block shows the link « PR n° 12 » to the pull request of the project and the state « Ouverte »", async () => {
    seed({});

    renderAt("/us/21");

    await loaded();
    const section = screen
      .getByRole("heading", { name: "GitHub" })
      .closest("section") as HTMLElement;
    const link = within(section).getByRole("link", { name: /PR n° 12/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/12",
    );
    expect(section.textContent).toContain("Ouverte");
  });

  it("given a story in_progress with a PR, when /us/21 loads, then the state is « Ouverte »", async () => {
    seed({ status: "in_progress" });

    renderAt("/us/21");

    await loaded();
    expect(theBlock()).toContain("Ouverte");
  });

  it("given a done story whose PR was merged (pr_number kept), when /us/21 loads, then the state is « Mergée »", async () => {
    seed({ status: "done" });

    renderAt("/us/21");

    await loaded();
    expect(theBlock()).toContain("Mergée");
    expect(theBlock()).not.toContain("Ouverte");
  });

  it("given no prNumber, when /us/21 loads, then there is no block « GitHub »", async () => {
    seed({ prNumber: null, status: "ready" });

    renderAt("/us/21");

    await loaded();
    expect(block()).toBeNull();
  });

  it.each([
    ["pending", "En cours"],
    ["success", "Réussie"],
    ["failure", "En échec"],
    [null, "Aucune"],
  ])(
    "given a CI state %s, when /us/21 loads, then the block says the CI is « %s »",
    async (prCiState, text) => {
      seed({ prCiState });

      renderAt("/us/21");

      await loaded();
      expect(theBlock()).toContain(text);
    },
  );

  it.each([
    ["approved", "Approuvée"],
    ["changes_requested", "Modifications demandées"],
    [null, "En attente"],
  ])(
    "given a review state %s, when /us/21 loads, then the block says the review is « %s »",
    async (prReviewState, text) => {
      seed({ prReviewState });

      renderAt("/us/21");

      await loaded();
      expect(theBlock()).toContain(text);
    },
  );

  it("given a button « Actualiser », when it is clicked, then it posts to /api/stories/21/pr/refresh and the block shows the answer", async () => {
    const api = seed({});
    api.refresh.answer = {
      prCiState: "success",
      prReviewState: "changes_requested",
    };
    renderAt("/us/21");
    await loaded();
    expect(theBlock()).toContain("Aucune");

    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));

    await waitFor(() => expect(theBlock()).toContain("Réussie"));
    expect(theBlock()).toContain("Modifications demandées");
    expect(
      api.calls.filter(
        (c) => c.method === "POST" && c.path === "/api/stories/21/pr/refresh",
      ),
    ).toHaveLength(1);
  });

  it("given a refresh that finds the PR merged, when « Actualiser » is clicked, then the block says « Mergée »", async () => {
    const api = seed({});
    api.refresh.answer = { status: "done" };
    renderAt("/us/21");
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));

    await waitFor(() => expect(theBlock()).toContain("Mergée"));
  });

  it("given the page open, when change story:21 arrives (and not another key), then the story is read again and the block follows", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.all = [];
    const api = seed({ prCiState: "pending" });
    renderAt("/us/21");
    await loaded();
    expect(theBlock()).toContain("En cours");
    const source = () => FakeEventSource.all[0] as FakeEventSource;
    await waitFor(() => expect(FakeEventSource.all.length).toBeGreaterThan(0));
    api.shown.prCiState = "failure";

    source().emit("change", "story:99");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(theBlock()).toContain("En cours");

    source().emit("change", "story:21");

    await waitFor(() => expect(theBlock()).toContain("En échec"));
  });
});
