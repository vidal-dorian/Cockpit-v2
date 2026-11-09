// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubProjectShell } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Slice 9.3 (decision 045 H): the Kanban in six columns and the tabs of a project. A column is the <section> of an <h3>
// whose text starts with its name and ends with its count.

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
const column = (name: string) => {
  const heading = screen
    .getAllByRole("heading", { level: 3 })
    .find((h) => (h.textContent ?? "").startsWith(name));
  const found = heading?.closest("section");
  if (!heading || !found) throw new Error(`no column ${name}`);
  return { heading, section: found };
};

const idea = { ...ticket(8, "Idée B"), step: "new" };
const tickets = [
  ticket(7, "Idée A"),
  { ...ticket(9, "Autre"), step: "in_progress" },
  idea,
];
const board = [
  story(21, 9, "vouloir-alpha", { status: "to_validate" }),
  story(22, 9, "vouloir-bravo", { status: "to_rewrite", position: 2 }),
  story(23, 9, "vouloir-charlie", { status: "ready", position: 3 }),
  story(24, 9, "vouloir-delta", { status: "in_progress", position: 4 }),
  story(25, 9, "vouloir-echo", { status: "in_review", position: 5 }),
  story(26, 9, "vouloir-foxtrot", { status: "done", position: 6 }),
];

describe("the cards of the Kanban", () => {
  it("given a story with a PR whose CI fails and one with a pending question, when the Kanban loads, then the cards say US n, the criteria count, the PR and the CI failure or « Question pour toi »", async () => {
    const extra = { prNumber: 44, prCiState: "failure" };
    stubProjectShell({}, tickets, [
      story(21, 9, "vouloir-alpha", { status: "to_validate" }),
      story(25, 9, "vouloir-echo", { status: "in_review", ...extra }),
      story(24, 9, "vouloir-delta", {
        status: "in_progress",
        questionPending: true,
      }),
    ]);
    renderAt("/projets/5");

    const alpha = await screen.findByRole("link", { name: /vouloir-alpha/ });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Claude t'attend sur l'US 24. 2 autres user stories au Kanban.",
    );
    expect(alpha.textContent).toContain("US 21 · vouloir-alpha");
    expect(alpha.textContent).toContain("1 critère");
    const echo = screen.getByRole("link", { name: /vouloir-echo/ });
    expect(echo.textContent).toContain("PR #44");
    expect(echo.textContent).toContain("✕ CI en échec");
    expect(
      screen.getByRole("link", { name: /vouloir-delta/ }).textContent,
    ).toContain("✦ Question pour toi");
  });
});

describe("slice 9.3: the six columns of the Kanban", () => {
  it("given a project, when /projets/5 loads, then the columns are Idées, À valider, Prêtes, En cours, En revue, Terminées in that order with their counts and sub-lines", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");

    await screen.findByRole("link", { name: /vouloir-alpha/ });
    const heads = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent ?? "")
      .filter((t) => NAMES.some((n) => t.startsWith(n)));
    expect(heads).toEqual([
      expect.stringMatching(/^Idées\s*2$/),
      expect.stringMatching(/^À valider\s*2$/),
      expect.stringMatching(/^Prêtes\s*1$/),
      expect.stringMatching(/^En cours\s*1$/),
      expect.stringMatching(/^En revue\s*1$/),
      expect.stringMatching(/^Terminées\s*1$/),
    ]);
    const subs: Record<string, string> = {
      Idées: "Claude écrit les US",
      "À valider": "à toi",
      Prêtes: "à toi de lancer",
      "En cours": "Claude développe",
      "En revue": "à toi de relire",
      Terminées: "c'est fait",
    };
    for (const [name, sub] of Object.entries(subs))
      expect(column(name).section.textContent, name).toContain(sub);
  });

  it("given tickets at the step new, when the Kanban loads, then Idées lists them as links to /tickets/:id", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");

    await waitFor(() => expect(() => column("Idées")).not.toThrow());
    const ideas = column("Idées").section;
    const a = await within(ideas).findByRole("link", { name: /Idée A/ });
    expect(a.getAttribute("href")).toBe("/tickets/7");
    expect(
      within(ideas)
        .getByRole("link", { name: /Idée B/ })
        .getAttribute("href"),
    ).toBe("/tickets/8");
    expect(ideas.textContent).not.toContain("Autre");
  });
});

describe("slice 9.3: the sentence of the Kanban tab", () => {
  const h1 = async (text: string) =>
    waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        text,
      ),
    );

  it("given 3 stories waiting for the user, when the Kanban loads, then the sentence says 3 user stories t'attendent and 6 user stories au Kanban", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");

    await h1("3 user stories t'attendent.");
    await h1("6 user stories au Kanban.");
  });

  it("given one story to validate, when the Kanban loads, then it says 1 user story t'attend.", async () => {
    stubProjectShell({}, tickets, [board[0] as (typeof board)[number]]);
    renderAt("/projets/5");

    await h1("1 user story t'attend.");
    await h1("1 user story au Kanban.");
  });

  it("given only stories in progress, when the Kanban loads, then it says Claude développe 2 user stories.", async () => {
    stubProjectShell({}, tickets, [
      story(24, 9, "a", { status: "in_progress" }),
      story(25, 9, "b", { status: "in_progress", position: 2 }),
    ]);
    renderAt("/projets/5");

    await h1("Claude développe 2 user stories.");
  });

  it("given nothing waiting and nothing in progress, when the Kanban loads, then it says Rien ne t'attend sur ce projet.", async () => {
    stubProjectShell({}, tickets, [story(23, 9, "c", { status: "ready" })]);
    renderAt("/projets/5");

    await h1("Rien ne t'attend sur ce projet.");
    await h1("1 user story au Kanban.");
  });

  it("given no story, when the Kanban loads, then the rest says Aucune user story pour l'instant.", async () => {
    stubProjectShell({}, tickets, []);
    renderAt("/projets/5");

    await h1("Rien ne t'attend sur ce projet.");
    await h1("Aucune user story pour l'instant.");
  });
});

describe("slice 9.3: the header and the tabs of a project", () => {
  it("given a project, when its page loads, then the tabs are Kanban, Tickets, Conception, Santé, Agents, CI / CD (067 A), Historique (053 I), Réglages in that order", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");

    const nav = await screen.findByRole("navigation", {
      name: "Sections du projet",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => (l.textContent ?? "").split(" ·")[0]?.trim()),
    ).toEqual([
      "Kanban",
      "Tickets",
      "Conception",
      "Santé",
      "Agents",
      "CI / CD",
      "Historique",
      "Réglages",
    ]);
  });

  it("given a project, when its page loads, then the breadcrumb links to Projets and Ouvrir sur GitHub links to the repo", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");

    const crumb = await screen.findByRole("link", { name: "Projets" });
    expect(crumb.getAttribute("href")).toBe("/projets");
    expect(
      screen
        .getByRole("link", { name: /Ouvrir sur GitHub/ })
        .getAttribute("href"),
    ).toBe("https://github.com/octocat/hello");
  });

  it("given the old address /projets/5/ecriture-us, when it loads, then it lands on the Réglages tab showing the writing of the US", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5/ecriture-us");

    await screen.findByRole("heading", { name: "Écriture automatique des US" });
    expect(window.location.pathname).toBe("/projets/5/reglages");
    const nav = screen.getByRole("navigation", { name: "Sections du projet" });
    expect(
      within(nav)
        .getByRole("link", { name: /^Réglages/ })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("given /projets/5/reglages, when it loads, then it shows the writing of the US", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5/reglages");

    expect(
      await screen.findByRole("heading", {
        name: "Écriture automatique des US",
      }),
    ).toBeDefined();
  });
});
