// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 4.3 (decision 017 L): the page of one story at /us/:id, loaded on demand like the ticket page. It shows,
// it changes nothing (validating, sending back, editing and abandoning are slice 4.4, StoryDecisions.test.tsx).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
/** The page has loaded once the story's « je veux » text is in it. */
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("relire les exports"));

const notes =
  "Du **gras** ici\n\n![x](https://tracker.example/p.png)\n\n<img src=x onerror=alert(1)>\n\n[clic](javascript:alert(3))";

function seed() {
  const base = story(20, 7, "la base", { position: 1, status: "ready" });
  const shown = story(21, 7, "relire les exports", {
    position: 2,
    asA: "lectrice attentive",
    soThat: "corriger les erreurs",
    notesMd: notes,
    status: "to_validate",
    criteria: [
      {
        id: 210,
        position: 1,
        given: "donné-alpha",
        when: "quand-alpha",
        then: "alors-alpha",
      },
      {
        id: 211,
        position: 2,
        given: "donné-beta",
        when: "quand-beta",
        then: "alors-beta",
      },
    ],
    dependsOn: [{ id: 20, iWant: "la base", status: "ready" }],
  });
  return stubTicketApi([ticket(7, "Idée découpée")], [base, shown]);
}

describe("criterion 15: Story page", () => {
  it("given a story, when /us/:id loads, then it reads En tant que, je veux and afin de, each followed by its text, in that order", async () => {
    seed();

    renderAt("/us/21");

    await loaded();
    // The title of the page (« US 21 · relire les exports ») repeats the « je veux » text: the story card is what is compared.
    const text = (main().textContent ?? "").replace(
      screen.getByRole("heading", { level: 1 }).textContent ?? "",
      "",
    );
    const at = [
      text.search(/En tant que/i),
      text.indexOf("lectrice attentive"),
      text.search(/je veux/i),
      text.indexOf("relire les exports"),
      text.search(/afin de/i),
      text.indexOf("corriger les erreurs"),
    ];
    expect(
      at.every((i) => i >= 0),
      `positions ${at}`,
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("given notes in markdown, when the page loads, then bold text is rendered as <strong> and no image, raw HTML or javascript: link comes from them", async () => {
    seed();

    renderAt("/us/21");

    await loaded();
    expect(within(main()).getByText("gras").tagName).toBe("STRONG");
    expect(main().textContent).not.toContain("**");
    expect(main().querySelector("img")).toBeNull();
    expect(document.querySelector('[src*="tracker.example"]')).toBeNull();
    expect(document.querySelector("[onerror]")).toBeNull();
    for (const a of main().querySelectorAll("a"))
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
  });

  it("given two criteria, when the page loads, then each is shown as Étant donné / Quand / Alors with its texts, in order", async () => {
    seed();

    renderAt("/us/21");

    await loaded();
    const text = main().textContent ?? "";
    for (const label of ["Étant donné", "Quand", "Alors"])
      expect(text, label).toContain(label);
    const at = [
      "donné-alpha",
      "quand-alpha",
      "alors-alpha",
      "donné-beta",
      "quand-beta",
      "alors-beta",
    ].map((t) => text.indexOf(t));
    expect(
      at.every((i) => i >= 0),
      `positions ${at}`,
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text.indexOf("Étant donné")).toBeLessThan(at[0] as number);
  });

  it("given a dependency, when the page loads, then it is a link to its story with its status, and the story's own status and a link back to the ticket are shown", async () => {
    seed();

    renderAt("/us/21");

    await loaded();
    const dependency = within(main()).getByRole("link", { name: /la base/ });
    expect(dependency.getAttribute("href")).toBe("/us/20");
    const row = dependency.closest("li");
    expect(row, "the dependency must be inside a list item").not.toBeNull();
    expect(row?.textContent).toMatch(/prête/i);
    expect(main().textContent).toMatch(/à valider/i);
    expect(main().textContent).not.toMatch(/to_validate|ready/);
    expect(main().querySelector('a[href="/tickets/7"]')).not.toBeNull();
  });

  it("given an abandoned story, when the page loads, then it offers no action button (the decisions of slice 4.4 are tested in StoryDecisions.test.tsx)", async () => {
    stubTicketApi(
      [ticket(7, "Idée découpée")],
      [story(21, 7, "relire les exports", { status: "abandoned" })],
    );

    renderAt("/us/21");

    await loaded();
    expect(within(main()).queryAllByRole("button")).toEqual([]);
  });

  it.each(["999", "abc"])(
    "given the story %s does not exist for the user, when its page loads, then a French not-found message is shown and nothing of another story",
    async (id) => {
      const api = seed();

      renderAt(`/us/${id}`);

      await screen.findByText(/introuvable/i);
      expect(main().textContent).not.toContain("relire les exports");
      expect(api.calls.some((c) => c.path === `/api/stories/${id}`)).toBe(true);
    },
  );
});
