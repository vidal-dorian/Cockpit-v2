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
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 4.5 (decision 019): the « Kanban » section of /projets/:id. The stub of test-tickets.tsx answers
// GET /api/projects/5/stories like the real route: { stories: [{ id, ticketId, ticketTitle, position, iWant, status }] },
// without the abandoned stories, ordered by ticket then position.
//
// Choices the decision leaves open, fixed here:
// - the section is titled « Kanban » (a heading), above the heading « Tickets »;
// - a column is a <section> whose heading reads « <Nom> (<compte>) »; its cards are <li> of a <ul>/<ol>;
// - a card is one link (the whole <li> content) to /us/:id; the « à réécrire » mark is text inside that link;
// - the query of the board is ["stories", <project id as a string>], like ["tickets", <project id>]; the decisions of
//   StoryDecisions.tsx invalidate it. Test 5 only observes the effect (see below), not the key.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const COLUMNS = ["À valider", "Prêtes", "En cours", "En revue", "Terminées"];

const kanban = () => {
  const section = screen
    .getByRole("heading", { name: "Kanban" })
    .closest("section");
  expect(section, "the heading Kanban must sit in a section").not.toBeNull();
  return section as HTMLElement;
};
/** The column section whose heading is « <name> (<count>) ». */
const column = (name: string, count?: number) => {
  const heading = screen.getByRole("heading", {
    name:
      count === undefined
        ? new RegExp(`^${name} \\(\\d+\\)$`)
        : `${name} (${count})`,
  });
  const section = heading.closest("section");
  expect(section, `${name} must be a section`).not.toBeNull();
  return section as HTMLElement;
};
const cardOf = (iWant: string) => {
  const card = screen
    .getByRole("link", { name: new RegExp(iWant) })
    .closest("li");
  expect(card, `${iWant} must be a list item`).not.toBeNull();
  return card as HTMLElement;
};

const tickets = [ticket(7, "Idée A"), ticket(8, "Idée B")];
const onBoard = [
  story(21, 7, "vouloir-alpha", { status: "to_validate" }),
  story(22, 7, "vouloir-bravo", { status: "to_rewrite", position: 2 }),
  story(23, 8, "vouloir-charlie", { status: "ready" }),
  story(24, 8, "vouloir-delta", { status: "in_progress", position: 2 }),
  story(25, 8, "vouloir-echo", { status: "in_review", position: 3 }),
  story(26, 8, "vouloir-foxtrot", { status: "done", position: 4 }),
  story(27, 8, "vouloir-golf", { status: "abandoned", position: 5 }),
];

describe("criterion 2: the Kanban section and its five columns", () => {
  it("given a project with stories, when /projets/:id loads, then the Kanban section shows the five columns in order, each a section with a counted heading and a list, and the Tickets section is not on this tab (decision 028 G)", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    await screen.findByRole("heading", { name: "À valider (2)" });
    const heading = screen.getByRole("heading", { name: "Kanban" });
    expect(heading).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Tickets" })).toBeNull();
    const names = within(kanban())
      .getAllByRole("heading")
      .map((h) => h.textContent ?? "")
      .filter((text) => /\d+$/.test(text) && !text.startsWith("Idées"));
    // The count is a pill after the name since slice 9.3 (the accessible name keeps « (n) »).
    expect(names).toEqual([
      "À valider 2",
      "Prêtes 1",
      "En cours 1",
      "En revue 1",
      "Terminées 1",
    ]);
    for (const name of COLUMNS)
      expect(within(column(name)).getByRole("list"), name).toBeDefined();
  });

  it("given a project without story, when the page loads, then the five columns say Aucune and count 0", async () => {
    stubTicketApi([ticket(7, "Idée A")], []);

    renderAt("/projets/5");

    await screen.findByRole("heading", { name: "À valider (0)" });
    for (const name of COLUMNS) {
      const section = column(name, 0);
      expect(within(section).getByText("Aucune"), name).toBeDefined();
      expect(within(section).queryAllByRole("listitem"), name).toEqual([]);
    }
  });
});

describe("criterion 3: grouping", () => {
  it("given one story per status, when the page loads, then each card is in its column, to_validate and to_rewrite share À valider and the abandoned story is nowhere", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    await screen.findByRole("heading", { name: "À valider (2)" });
    await screen.findByRole("link", { name: /vouloir-alpha/ });
    const iWants = (name: string) =>
      within(column(name))
        .getAllByRole("listitem")
        .map((li) => /vouloir-\w+/.exec(li.textContent ?? "")?.[0]);
    expect(iWants("À valider")).toEqual(["vouloir-alpha", "vouloir-bravo"]);
    expect(iWants("Prêtes")).toEqual(["vouloir-charlie"]);
    expect(iWants("En cours")).toEqual(["vouloir-delta"]);
    expect(iWants("En revue")).toEqual(["vouloir-echo"]);
    expect(iWants("Terminées")).toEqual(["vouloir-foxtrot"]);
    expect(kanban().textContent).not.toContain("vouloir-golf");
  });

  it("given a to_rewrite story next to a to_validate one, when the page loads, then only the first card is marked à réécrire", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    await screen.findByRole("link", { name: /vouloir-alpha/ });
    expect(cardOf("vouloir-bravo").textContent).toContain("à réécrire");
    expect(cardOf("vouloir-alpha").textContent).not.toContain("à réécrire");
    expect(cardOf("vouloir-charlie").textContent).not.toContain("à réécrire");
  });
});

describe("criterion 4: the cards", () => {
  it("given a story, when the page loads, then its card shows the je veux and the ticket title and the whole card is a link to /us/:id", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    const link = await screen.findByRole("link", { name: /vouloir-alpha/ });
    expect(link.getAttribute("href")).toBe("/us/21");
    expect(link.textContent).toContain("Idée A");
    const card = cardOf("vouloir-alpha");
    // Nothing of the card sits outside the link.
    expect(card.textContent).toBe(link.textContent);
    expect(
      within(column("Prêtes")).getByRole("link", { name: /vouloir-charlie/ }),
    ).toBeDefined();
    expect(
      within(column("Prêtes")).getByRole("link", { name: /vouloir-charlie/ })
        .textContent,
    ).toContain("Idée B");
    expect(
      screen
        .getByRole("link", { name: /vouloir-charlie/ })
        .getAttribute("href"),
    ).toBe("/us/23");
  });

  it("given a board with cards, when the page loads, then the Kanban section holds no button", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    await screen.findByRole("link", { name: /vouloir-alpha/ });
    expect(within(kanban()).queryAllByRole("button")).toEqual([]);
  });
});

describe("criterion 5: the board is fresh when the user comes back to the project", () => {
  // The client never considers a query stale by itself: only an invalidation (decision 019 E) makes the project page
  // read the board again when it is shown again. Without it, the old board stays on screen.
  function renderWithClient(path = "/projets/5") {
    window.history.replaceState({}, "", path);
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity } },
          })
        }
      >
        <App />
      </QueryClientProvider>,
    );
  }
  const stub = (status = "to_validate") =>
    stubDecisionApi({
      tickets: [ticket(7, "Idée A")],
      stories: [
        decisionStory(
          story(21, 7, "vouloir-alpha", { status }),
          status === "to_rewrite" ? "Précise" : null,
        ),
      ],
    });
  const goBackToProject = async () => {
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Navigation principale" }),
      ).getByRole("link", { name: /^Tous les projets/ }),
    );
    fireEvent.click(await screen.findByRole("link", { name: "hello" }));
  };
  const decide = async (act: () => Promise<void> | void, done: string) => {
    renderWithClient();
    fireEvent.click(await screen.findByRole("link", { name: /vouloir-alpha/ }));
    await screen.findByRole("button", { name: "Valider" });
    await act();
    // The story page shows the new status once the decision went through.
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain(done),
    );
    await goBackToProject();
  };

  it("given a story to validate, when Valider is clicked on its page and the user goes back to the project, then the card moved from À valider to Prêtes", async () => {
    stub();

    await decide(() => {
      fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    }, "prête");

    await screen.findByRole("heading", { name: "Prêtes (1)" });
    expect(column("À valider", 0)).toBeDefined();
    expect(
      within(column("Prêtes")).getByRole("link", { name: /vouloir-alpha/ }),
    ).toBeDefined();
  });

  it("given a story to validate, when it is sent back and the user goes back to the project, then the card is still in À valider, now marked à réécrire", async () => {
    stub();

    await decide(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Renvoyer à Claude" }),
      );
      fireEvent.change(screen.getByLabelText(/Commentaire/), {
        target: { value: "Précise le cas vide" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Renvoyer à Claude" }),
      );
    }, "à réécrire");

    await waitFor(() =>
      expect(cardOf("vouloir-alpha").textContent).toContain("à réécrire"),
    );
    expect(
      within(column("À valider", 1)).getByRole("link", {
        name: /vouloir-alpha/,
      }),
    ).toBeDefined();
  });

  it("given a story to validate, when it is abandoned and the user goes back to the project, then its card is gone", async () => {
    stub();

    await decide(() => {
      fireEvent.click(screen.getByRole("button", { name: "Abandonner" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Confirmer l'abandon" }),
      );
    }, "abandonnée");

    await screen.findByRole("heading", { name: "À valider (0)" });
    expect(screen.queryByRole("link", { name: /vouloir-alpha/ })).toBeNull();
    expect(within(column("À valider", 0)).getByText("Aucune")).toBeDefined();
  });

  // Decision 028 G: the tickets have their own tab.
  const openTicket = async () => {
    renderWithClient("/projets/5/tickets");
    const tickets = (
      await screen.findByRole("heading", { name: "Tickets" })
    ).closest("section") as HTMLElement;
    fireEvent.click(
      await within(tickets).findByRole("link", { name: "Idée A" }),
    );
    await screen.findByRole("heading", { level: 1, name: /^Idée A/ });
  };

  it("given a ticket with a story, when the ticket is abandoned from its page and the user goes back to the project, then its cards are gone from the board", async () => {
    stub();
    await openTicket();

    fireEvent.click(
      screen.getByRole("button", { name: "Abandonner le ticket" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer l'abandon" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain("Abandonné"),
    );
    await goBackToProject();

    await screen.findByRole("heading", { name: "À valider (0)" });
    expect(screen.queryByRole("link", { name: /vouloir-alpha/ })).toBeNull();
  });

  it("given a ticket with a story, when the ticket is renamed and the user goes back to the project, then the card shows the new title", async () => {
    stub();
    await openTicket();

    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    fireEvent.change(screen.getByLabelText("Titre"), {
      target: { value: "Idée renommée" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByRole("heading", { level: 1, name: /^Idée renommée/ });
    await goBackToProject();

    await screen.findByRole("link", { name: /vouloir-alpha/ });
    await waitFor(() =>
      expect(cardOf("vouloir-alpha").textContent).toContain("Idée renommée"),
    );
    expect(cardOf("vouloir-alpha").textContent).not.toContain("Idée A");
  });

  it("given a story, when its Je veux is changed with Modifier and the user goes back to the project, then the card shows the new text", async () => {
    stub();
    renderWithClient();
    fireEvent.click(await screen.findByRole("link", { name: /vouloir-alpha/ }));
    await screen.findByRole("button", { name: "Modifier" });
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    fireEvent.change(screen.getAllByLabelText(/Je veux/)[0] as HTMLElement, {
      target: { value: "vouloir-reécrit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain("vouloir-reécrit"),
    );
    await goBackToProject();

    await screen.findByRole("heading", { name: "À valider (1)" });
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /vouloir-reécrit/ }),
      ).toBeDefined(),
    );
    expect(screen.queryByRole("link", { name: /vouloir-alpha/ })).toBeNull();
  });
});

const storiesGets = (api: { calls: { method: string; path: string }[] }) =>
  api.calls.filter(
    (c) => c.method === "GET" && c.path === "/api/projects/5/stories",
  ).length;

describe("the board when the stories route refuses", () => {
  it("given the stories route answers 401, when the page loads, then the Kanban shows no alert and either the Se connecter avec GitHub link or nothing", async () => {
    const api = stubTicketApi(tickets, onBoard);
    api.failStories.status = 401;

    renderAt("/projets/5");

    await waitFor(() => expect(screen.queryByText("Chargement…")).toBeNull());
    expect(storiesGets(api)).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();
    const heading = screen.queryByRole("heading", { name: "Kanban" });
    if (heading) {
      const section = heading.closest("section") as HTMLElement;
      const login = within(section).queryByRole("link", {
        name: "Se connecter avec GitHub",
      });
      if (login) expect(login.getAttribute("href")).toBe("/api/auth/login");
      else {
        // Nothing but the heading.
        expect(within(section).queryAllByRole("listitem")).toEqual([]);
        expect(within(section).queryAllByRole("heading")).toHaveLength(1);
        expect(section.textContent).toBe("Kanban");
      }
    }
  });

  it("given the stories route answers 500, when the page loads, then the Kanban shows an alert with Réessayer, and clicking it reads the route again and shows the board", async () => {
    const api = stubTicketApi(tickets, onBoard);
    api.failStories.status = 500;

    renderAt("/projets/5");

    await screen.findByRole("heading", { name: "Kanban" });
    const alert = await within(kanban()).findByRole("alert");
    expect(alert.textContent).toContain("Impossible de lire les user stories");
    const retry = within(kanban()).getByRole("button", { name: "Réessayer" });
    const before = storiesGets(api);
    api.failStories.status = undefined;
    fireEvent.click(retry);

    await screen.findByRole("heading", { name: "À valider (2)" });
    expect(storiesGets(api)).toBeGreaterThan(before);
    expect(within(kanban()).queryByRole("alert")).toBeNull();
  });
});

describe("accessibility of the board", () => {
  it("given a card, when the page loads, then the link's accessible name names the ticket before its title", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    const link = await screen.findByRole("link", { name: /vouloir-alpha/ });
    // The tickets list also links « Idée A », so the word « ticket » tells the card from it.
    expect(
      screen.queryByRole("link", { name: /vouloir-alpha.*ticket.*Idée A/i }),
    ).toBe(link);
  });

  it("given the columns, when the page loads, then their scroll container is focusable by keyboard and is a named region", async () => {
    stubTicketApi(tickets, onBoard);

    renderAt("/projets/5");

    await screen.findByRole("heading", { name: "À valider (2)" });
    const scroller = column("À valider").parentElement as HTMLElement;
    for (const name of COLUMNS)
      expect(column(name).parentElement, name).toBe(scroller);
    expect(scroller).not.toBe(kanban());
    expect(scroller.tabIndex).toBe(0);
    expect(scroller.getAttribute("role")).toBe("region");
    expect(scroller.getAttribute("aria-label")).toMatch(/kanban|colonnes/i);
  });
});
