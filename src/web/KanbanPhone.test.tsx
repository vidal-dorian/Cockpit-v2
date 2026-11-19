// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { panel, stubProjectShell } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";
import { stubWidth } from "./test-width.ts";

// Decision 084 C (C1 to C4): the Kanban of a project on a phone. jsdom has no layout, so the visibility is read on the
// responsive classes (max-sm:hidden, max-lg:hidden) and the width read at the touch is simulated with matchMedia (test-width.ts).
//
// Choices the decision leaves open, fixed here:
// - a chip is a button named « <colonne> <nombre> » in the group « Colonne affichée »; the group is hidden from sm (sm:hidden);
// - a column that is not shown on a phone carries max-sm:hidden, the shown one does not, and no column carries a plain hidden;
// - the width is read with matchMedia at the touch: below 1024 px a card goes to its page, from 1024 px it opens the panel.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const NAMES = [
  "Idées",
  "À valider",
  "Prêtes",
  "En cours",
  "En revue",
  "Terminées",
];

const tickets = [
  ticket(7, "Idée A"),
  { ...ticket(9, "Autre"), step: "in_progress" },
];
const full = [
  story(21, 9, "vouloir-alpha", { status: "to_validate" }),
  story(22, 9, "vouloir-bravo", { status: "to_validate", position: 2 }),
  story(23, 9, "vouloir-charlie", { status: "ready", position: 3 }),
  story(24, 9, "vouloir-delta", { status: "in_progress", position: 4 }),
  story(25, 9, "vouloir-echo", { status: "in_review", position: 5 }),
  story(26, 9, "vouloir-foxtrot", { status: "done", position: 6 }),
];

const chips = async () =>
  within(await screen.findByRole("group", { name: "Colonne affichée" }));
const chip = async (name: string) =>
  (await chips()).getByRole("button", {
    name: new RegExp(`^${name}\\s*\\d+$`),
  });
const columnOf = (name: string) => {
  const section = screen
    .getByRole("heading", { name: new RegExp(`^${name} \\(\\d+\\)$`) })
    .closest("section");
  if (!section) throw new Error(`no column ${name}`);
  return section;
};
const hiddenOnPhone = (name: string) =>
  columnOf(name).classList.contains("max-sm:hidden");
const pressed = async () => {
  const group = await chips();
  return group
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => (b.textContent ?? "").replace(/\s*\d+$/, ""));
};

describe("C1: one column at a time below sm", () => {
  it("given a project with stories, when the Kanban loads, then the group « Colonne affichée » holds one aria-pressed chip per column with its count, and is hidden from sm", async () => {
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    const group = await screen.findByRole("group", {
      name: "Colonne affichée",
    });
    expect(group.classList.contains("sm:hidden")).toBe(true);
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, " "))).toEqual([
      "Idées 1",
      "À valider 2",
      "Prêtes 1",
      "En cours 1",
      "En revue 1",
      "Terminées 1",
    ]);
    for (const b of buttons) expect(b.hasAttribute("aria-pressed")).toBe(true);
  });

  it("given the chips, when a chip is pressed, then only that chip is pressed and only its column is shown below sm, the five others carrying max-sm:hidden", async () => {
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await chip("En cours"));

    await waitFor(async () => expect(await pressed()).toEqual(["En cours"]));
    for (const name of NAMES)
      expect(hiddenOnPhone(name), name).toBe(name !== "En cours");
  });

  it("given a chip pressed then another, when the second is pressed, then the first column is hidden again", async () => {
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await chip("Terminées"));
    fireEvent.click(await chip("Idées"));

    await waitFor(async () => expect(await pressed()).toEqual(["Idées"]));
    expect(hiddenOnPhone("Terminées")).toBe(true);
    expect(hiddenOnPhone("Idées")).toBe(false);
  });

  it("given any column shown on a phone, when the board renders, then no column is hidden at every width, so the six are all there from sm", async () => {
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    await chips();
    for (const name of NAMES) {
      const classes = columnOf(name).classList;
      expect(classes.contains("hidden"), name).toBe(false);
      expect(classes.contains("sm:hidden"), name).toBe(false);
    }
  });
});

describe("C2: the column shown by default", () => {
  it("given cards in À valider and in Prêtes, when the Kanban loads, then À valider is the pressed chip and the only column not hidden below sm", async () => {
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    await waitFor(async () => expect(await pressed()).toEqual(["À valider"]));
    for (const name of NAMES)
      expect(hiddenOnPhone(name), name).toBe(name !== "À valider");
  });

  it("given À valider empty and cards in Prêtes and En revue, when the Kanban loads, then Prêtes is shown, even with an idea in Idées", async () => {
    stubProjectShell({}, tickets, [
      story(23, 9, "vouloir-charlie", { status: "ready" }),
      story(25, 9, "vouloir-echo", { status: "in_review", position: 2 }),
    ]);
    renderAt("/projets/5");

    await waitFor(async () => expect(await pressed()).toEqual(["Prêtes"]));
  });

  it("given only En revue among the three waiting columns, and an idea, when the Kanban loads, then En revue is shown", async () => {
    stubProjectShell({}, tickets, [
      story(24, 9, "vouloir-delta", { status: "in_progress" }),
      story(25, 9, "vouloir-echo", { status: "in_review", position: 2 }),
    ]);
    renderAt("/projets/5");

    await waitFor(async () => expect(await pressed()).toEqual(["En revue"]));
  });

  it("given none of the three waiting columns filled, an idea and a running story, when the Kanban loads, then the first non-empty column of the board, Idées, is shown", async () => {
    stubProjectShell({}, tickets, [
      story(24, 9, "vouloir-delta", { status: "in_progress" }),
    ]);
    renderAt("/projets/5");

    await waitFor(async () => expect(await pressed()).toEqual(["Idées"]));
  });

  it("given no idea and only running and finished stories, when the Kanban loads, then En cours, the first non-empty column, is shown", async () => {
    stubProjectShell(
      {},
      [{ ...ticket(9, "Autre"), step: "in_progress" }],
      [
        story(24, 9, "vouloir-delta", { status: "in_progress" }),
        story(26, 9, "vouloir-foxtrot", { status: "done", position: 2 }),
      ],
    );
    renderAt("/projets/5");

    await waitFor(async () => expect(await pressed()).toEqual(["En cours"]));
  });

  it("given an empty board, when the Kanban loads, then Idées is shown", async () => {
    stubProjectShell({}, [], []);
    renderAt("/projets/5");

    await waitFor(async () => expect(await pressed()).toEqual(["Idées"]));
    expect(hiddenOnPhone("Idées")).toBe(false);
  });

  it("given a chip pressed on a project, when the user moves to another project, then the default column is pressed again", async () => {
    stubProjectShell({}, tickets, full);
    // The fake serves project 5 only: project 6 answers with the same board.
    const fake = fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      fake(
        typeof input === "string"
          ? input.replace("/api/projects/6/", "/api/projects/5/")
          : input,
        init,
      ),
    );
    renderAt("/projets/5");

    fireEvent.click(await chip("Terminées"));
    await waitFor(async () => expect(await pressed()).toEqual(["Terminées"]));
    window.history.pushState({}, "", "/projets/6");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(async () => expect(await pressed()).toEqual(["À valider"]));
  });
});

describe("C3: touching a card below lg", () => {
  it("given a phone of 390 px, when a US card is touched, then the user lands on the page of the US, not on the panel", async () => {
    stubWidth(390);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await screen.findByRole("link", { name: /vouloir-alpha/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/us/21"));
    expect(window.location.search).toBe("");
  });

  it("given a phone of 390 px and the Idées column shown, when an idea card is touched, then the user lands on the page of the ticket", async () => {
    stubWidth(390);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await chip("Idées"));
    fireEvent.click(await screen.findByRole("link", { name: /Idée A/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/tickets/7"));
  });

  it("given a width of 1023 px, when a US card is touched, then the page of the US opens (the panel is not yet fixed on the right)", async () => {
    stubWidth(1023);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await screen.findByRole("link", { name: /vouloir-alpha/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/us/21"));
  });

  it("given a width of 1024 px, when a US card is touched, then nothing changes: ?us= opens the panel on the project page", async () => {
    stubWidth(1024);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await screen.findByRole("link", { name: /vouloir-alpha/ }));

    await waitFor(() => expect(window.location.search).toBe("?us=21"));
    expect(window.location.pathname).toBe("/projets/5");
    expect(await waitFor(() => panel())).toBeDefined();
  });

  it("given a width of 1280 px, when an idea card is touched, then ?ticket= opens the panel on the project page", async () => {
    stubWidth(1280);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    fireEvent.click(await screen.findByRole("link", { name: /Idée A/ }));

    await waitFor(() => expect(window.location.search).toBe("?ticket=7"));
    expect(window.location.pathname).toBe("/projets/5");
  });

  it("given a board rendered on a phone, when the width becomes 1280 px before the touch, then the touch opens the panel: the width is read at the touch", async () => {
    stubWidth(390);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");
    const card = await screen.findByRole("link", { name: /vouloir-alpha/ });

    stubWidth(1280);
    fireEvent.click(card);

    await waitFor(() => expect(window.location.search).toBe("?us=21"));
    expect(window.location.pathname).toBe("/projets/5");
  });

  it("given a card, when its link is read, then it keeps its ?us= address for a long press or a middle click", async () => {
    stubWidth(390);
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    const link = await screen.findByRole("link", { name: /vouloir-alpha/ });

    expect(link.getAttribute("href")).toBe("/projets/5?us=21");
  });
});

describe("C4: the help sentence", () => {
  it("given a board, when the Kanban loads, then the sentence « Pas de glisser-déposer : un clic ouvre la carte à droite. » is hidden below lg (max-lg:hidden)", async () => {
    stubProjectShell({}, tickets, full);
    renderAt("/projets/5");

    const sentence = await screen.findByText(
      "Pas de glisser-déposer : un clic ouvre la carte à droite.",
    );
    expect(sentence.classList.contains("max-lg:hidden")).toBe(true);
  });
});
