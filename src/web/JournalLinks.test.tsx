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
import { empty, stubHome } from "./test-home.tsx";
import { entry, stubJournal } from "./test-journal.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 084 C (S06): the objects a journal entry names are links.
//
// Pinned choices (the decision leaves them open):
// - Home « Dernièrement »: a row with an object holds one link, to /runs/:runId, else /us/:storyId, else /tickets/:ticketId; a row with none holds no link.
// - The panel « Entrée du journal » (Journal page and Historique tab of a project) has a field « Lié à » with the links « Run n » (/runs/n), « US n » (/us/n), « Ticket n » (/tickets/n);
//   only the ids present. The field « Projet » is a link to /projets/:projectId when the entry has a project.
// - A row of the Historique tab names its objects in small text under the sentence (« Run 17 · US 42 »): plain text, the row is already a button.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const homeEntry = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  at: `2026-10-${20 - id}T12:00:00.000Z`,
  actor: "human",
  origin: "ui",
  action: "validate_story",
  result: "ok",
  project: "octocat/hello",
  projectId: 5,
  ticketId: null,
  storyId: null,
  runId: null,
  ...over,
});

describe("084 C: Dernièrement links the object of each entry", () => {
  it("given entries with a run, a story, a ticket and nothing, when the home loads, then each row links its object in that order of preference and the last stays inert", async () => {
    const api = stubHome(empty());
    api.state.history = {
      entries: [
        homeEntry(1, { runId: 12, storyId: 42, ticketId: 7 }),
        homeEntry(2, { storyId: 42, ticketId: 7 }),
        homeEntry(3, { ticketId: 7 }),
        homeEntry(4, { action: "login", project: null, projectId: null }),
      ],
      hasMore: false,
    };
    renderAt("/");

    const heading = await screen.findByRole("heading", {
      name: "Dernièrement",
    });
    const rows = within(heading.closest("section") as HTMLElement).getAllByRole(
      "listitem",
    );
    const href = (i: number) =>
      within(rows[i] as HTMLElement)
        .queryByRole("link")
        ?.getAttribute("href") ?? null;
    expect([href(0), href(1), href(2), href(3)]).toEqual([
      "/runs/12",
      "/us/42",
      "/tickets/7",
      null,
    ]);
  });
});

const FULL = entry(3, {
  action: "validate_story",
  project: "octocat/api-facturation",
  projectId: 6,
  ticketId: 12,
  storyId: 43,
  runId: 17,
});
const BARE = entry(2, { action: "login" });

const panel = () =>
  screen.getByRole("complementary", { name: "Entrée du journal" });

async function openRow(path: string, row: RegExp | string) {
  stubJournal(() => ({ entries: [FULL, BARE] }));
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
  const label = await screen.findByText(row);
  fireEvent.click(label.closest("button") as HTMLElement);
  await waitFor(() => expect(panel()).toBeDefined());
}

describe("084 C: the panel of an entry links its objects", () => {
  it.each([
    ["the Journal page", "/journal", /Validée|validée/],
    [
      "the Historique tab of a project",
      "/projets/6/historique",
      /User story validée/,
    ],
  ])(
    "given an entry with a run, a story, a ticket and a project, when it is opened on %s, then « Lié à » links them",
    async (_name, path, row) => {
      await openRow(path, row);

      const links = within(panel());
      expect(
        links.getByRole("link", { name: "Run 17" }).getAttribute("href"),
      ).toBe("/runs/17");
      expect(
        links.getByRole("link", { name: "US 43" }).getAttribute("href"),
      ).toBe("/us/43");
      expect(
        links.getByRole("link", { name: "Ticket 12" }).getAttribute("href"),
      ).toBe("/tickets/12");
      expect(
        links
          .getByRole("link", { name: "octocat/api-facturation" })
          .getAttribute("href"),
      ).toBe("/projets/6");
      expect(panel().textContent).toContain("Lié à");
    },
  );

  it("given an entry with no object, when it is opened, then the panel has no link to a run, a story or a ticket", async () => {
    stubJournal(() => ({ entries: [BARE] }));
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
    fireEvent.click(
      (await screen.findByText("Connexion")).closest("button") as HTMLElement,
    );
    await waitFor(() => expect(panel()).toBeDefined());

    expect(within(panel()).queryAllByRole("link")).toHaveLength(0);
    expect(panel().textContent).not.toContain("Lié à");
  });
});

describe("084 C: a row of the Historique tab names its objects", () => {
  it("given an entry of the run 17, the story 43 and the ticket 12, when the tab loads, then its row says Run 17, US 43 and Ticket 12", async () => {
    stubJournal(() => ({ entries: [FULL] }));
    window.history.replaceState({}, "", "/projets/6/historique");
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    const row = (await screen.findByText(/User story validée/)).closest(
      "li",
    ) as HTMLElement;
    expect(row.textContent).toContain("Run 17");
    expect(row.textContent).toContain("US 43");
    expect(row.textContent).toContain("Ticket 12");
  });
});
