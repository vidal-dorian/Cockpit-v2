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
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { panel, withHome } from "./test-shell.tsx";
import { type FakeStory, renderAt, story, ticket } from "./test-tickets.tsx";
import { layer, type RichTicket, rich } from "./test-tickets-full.tsx";

// Decision 085 A, C, D, F, J, K (slice S04): the tickets.
// Pinned: the fakes of test-decisions.tsx (GET /api/stories/:id, POST /api/stories/:id/validate) and of test-tickets-full.tsx (routine, search);
// GET /api/projects may give a `role` and `archived` per project.
// Pinned names: « ← Ticket » is a button of the story panel; the title of a story row stays a link (href /us/:id) whose plain click opens the panel;
// on the Tickets tab the open ticket is `?ticket=<id>` (as `?us=` at the Kanban); chip, tag and search have no pinned parameter, the tests go away and come back.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const pathOf = (input: string | URL | Request) =>
  new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    "http://localhost",
  ).pathname;

/** The decision fake with the shell and the routine/search layer, for the Tickets tab. */
function stubTab(
  tickets: (RichTicket | ReturnType<typeof ticket>)[],
  stories: FakeStory[],
  options: Parameters<typeof layer>[0] = {},
) {
  const api = stubDecisionApi({
    tickets,
    stories: stories.map((s) => decisionStory(s)),
  });
  withHome();
  return { api, ...layer(options) };
}

/** What GET /api/projects says of project 5, over whatever fake is stubbed. */
function projectIs(extra: Record<string, unknown>) {
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (
        pathOf(input) === "/api/projects" &&
        (init?.method ?? "GET") === "GET"
      )
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
              ...extra,
            },
          ],
        });
      return inner(input, init);
    }),
  );
}

const WITH_STORIES = ticket(12, "Connexion sans mot de passe");
const TWO = [
  story(42, 12, "Lien par e-mail", {
    asA: "cliente",
    criteria: [
      {
        id: 1,
        position: 1,
        given: "un lien envoyé",
        when: "elle clique",
        then: "elle entre",
      },
    ],
  }),
  story(43, 12, "Lien expiré", {
    position: 2,
    asA: "administratrice",
    criteria: [
      {
        id: 2,
        position: 1,
        given: "un lien périmé",
        when: "elle clique",
        then: "un refus",
      },
    ],
  }),
];
const openRow = async (title: string) =>
  fireEvent.click(await screen.findByRole("button", { name: title }));

describe("085 J, A: a story of the panel of a ticket opens in the panel", () => {
  it("given the panel of a ticket with stories to validate, when a story is clicked, then the panel shows its narrative, its criteria and Valider, with « ← Ticket », and the page does not change", async () => {
    stubTab([{ ...WITH_STORIES, step: "to_validate" }], TWO);
    renderAt("/projets/5/tickets");
    await openRow("Connexion sans mot de passe");

    fireEvent.click(await screen.findByText(/US 42 · Lien par e-mail/));

    await waitFor(() => within(panel()).getByText("cliente"));
    const aside = within(panel());
    expect(aside.getByText("un lien envoyé")).toBeDefined();
    expect(aside.getByRole("button", { name: "Valider" })).toBeDefined();
    expect(aside.getByRole("button", { name: "← Ticket" })).toBeDefined();
    expect(window.location.pathname).toBe("/projets/5/tickets");
  });

  it("given a story open in the panel, when « ← Ticket » is clicked, then the panel shows the ticket again", async () => {
    stubTab([{ ...WITH_STORIES, step: "to_validate" }], TWO);
    renderAt("/projets/5/tickets");
    await openRow("Connexion sans mot de passe");
    fireEvent.click(await screen.findByText(/US 42 · Lien par e-mail/));
    fireEvent.click(await screen.findByRole("button", { name: "← Ticket" }));

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Connexion sans mot de passe",
      }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "← Ticket" })).toBeNull();
  });

  it("given two stories to validate of the ticket, when the first is validated in the panel, then the second opens in the panel", async () => {
    const api = stubTab([{ ...WITH_STORIES, step: "to_validate" }], TWO);
    renderAt("/projets/5/tickets");
    await openRow("Connexion sans mot de passe");
    fireEvent.click(await screen.findByText(/US 42 · Lien par e-mail/));
    await waitFor(() => within(panel()).getByText("cliente"));

    fireEvent.click(within(panel()).getByRole("button", { name: "Valider" }));

    await waitFor(() => within(panel()).getByText("administratrice"));
    expect(api.api.writes().map((w) => w.path)).toEqual([
      "/api/stories/42/validate",
    ]);
  });
});

describe("085 A: the page of a ticket lets you read a story before Valider", () => {
  it("given a story to validate on /tickets/:id, when its title is clicked, then the right panel shows the narrative, the criteria and the decisions, and the page stays", async () => {
    stubDecisionApi({
      tickets: [{ ...WITH_STORIES, step: "to_validate" }],
      stories: TWO.map((s) => decisionStory(s)),
    });
    renderAt("/tickets/12");

    fireEvent.click(
      await screen.findByRole("link", { name: /US 42 · Lien par e-mail/ }),
    );

    await waitFor(() => within(panel()).getByText("cliente"));
    expect(within(panel()).getByText("un lien envoyé")).toBeDefined();
    expect(
      within(panel()).getByRole("button", { name: "Valider" }),
    ).toBeDefined();
    expect(window.location.pathname).toBe("/tickets/12");
    // The Valider of the row stays for who has already read.
    expect(
      within(screen.getByRole("main")).getAllByRole("button", {
        name: "Valider",
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("085 F: the Tickets tab keeps what is open in the address", () => {
  const T1 = rich(11, "Exporter en CSV", { tags: ["export"] });
  const T2 = rich(12, "Connexion sans mot de passe", { step: "in_progress" });
  const T3 = rich(13, "Thème sombre");

  it("given the tab, when a row is clicked, then the address says ?ticket=<id>", async () => {
    stubTab([T1, T2, T3], []);
    renderAt("/projets/5/tickets");

    await openRow("Exporter en CSV");

    await screen.findByRole("complementary", { name: "Ticket" });
    expect(new URLSearchParams(window.location.search).get("ticket")).toBe(
      "11",
    );
  });

  it("given an address with ?ticket=<id>, when the tab loads, then the panel of that ticket is open", async () => {
    stubTab([T1, T2, T3], []);
    renderAt("/projets/5/tickets?ticket=12");

    const aside = await screen.findByRole("complementary", { name: "Ticket" });
    expect(
      within(aside).getByRole("heading", {
        level: 2,
        name: "Connexion sans mot de passe",
      }),
    ).toBeDefined();
  });

  it("given the chip Nouveaux, a tag and an open ticket, when the user opens the ticket page and goes back, then the chip, the tag and the panel are as they were left", async () => {
    stubTab([T1, T2, T3], []);
    renderAt("/projets/5/tickets");
    fireEvent.click(
      await screen.findByRole("button", { name: "Nouveaux · 2" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Étiquette" }), {
      target: { value: "export" },
    });
    await openRow("Exporter en CSV");
    fireEvent.click(
      await screen.findByRole("link", { name: "Ouvrir le ticket" }),
    );
    await screen.findByRole("heading", { level: 1, name: /^Exporter en CSV/ });

    window.history.back();

    await screen.findByRole("complementary", { name: "Ticket" });
    expect(
      screen
        .getByRole("button", { name: "Nouveaux · 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByRole("combobox", { name: "Étiquette" }) as HTMLSelectElement)
        .value,
    ).toBe("export");
    expect(screen.queryByRole("button", { name: "Thème sombre" })).toBeNull();
  });

  it("given a search and an open result, when the user opens the ticket page and goes back, then the search box still holds the words and the panel is open", async () => {
    stubTab([T1, T2, T3], [], {
      search: () => ({
        tickets: [{ id: 11, title: "Exporter en CSV", step: "new" }],
        stories: [],
      }),
    });
    renderAt("/projets/5/tickets");
    fireEvent.change(
      await screen.findByRole("textbox", {
        name: "Chercher dans les tickets et les US",
      }),
      { target: { value: "csv" } },
    );
    await openRow("Exporter en CSV");
    fireEvent.click(
      await screen.findByRole("link", { name: "Ouvrir le ticket" }),
    );
    await screen.findByRole("heading", { level: 1, name: /^Exporter en CSV/ });

    window.history.back();

    await screen.findByRole("complementary", { name: "Ticket" });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Chercher dans les tickets et les US",
        }) as HTMLInputElement
      ).value,
    ).toBe("csv");
  });
});

describe("085 A: a new ticket can get its stories written", () => {
  const routine = {
    routineConnected: true,
    schedule: { frequency: "daily", hour: 7 },
  };

  it("given a ticket without stories on /tickets/:id, when the page loads, then it says when Claude writes them and Écrire les US maintenant fires the writing", async () => {
    stubDecisionApi({ tickets: [ticket(7, "Idée brute")], stories: [] });
    const { runs } = layer(routine);
    renderAt("/tickets/7");

    await screen.findByText(
      "Claude les écrira à 7 h, ou maintenant si tu veux.",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Écrire les US maintenant" }),
    );

    await waitFor(() => expect(runs).toEqual(["5"]));
  });

  it("given a ticket with stories on /tickets/:id, when the page loads, then there is no Écrire les US maintenant", async () => {
    stubDecisionApi({
      tickets: [{ ...WITH_STORIES, step: "to_validate" }],
      stories: TWO.map((s) => decisionStory(s)),
    });
    layer(routine);
    renderAt("/tickets/12");

    await screen.findByRole("link", { name: /US 42 · Lien par e-mail/ });
    expect(
      screen.queryByRole("button", { name: "Écrire les US maintenant" }),
    ).toBeNull();
  });

  it("given the panel of a ticket without stories, when it is open, then the panel offers Écrire les US maintenant", async () => {
    stubTab([ticket(7, "Idée brute")], [], routine);
    renderAt("/projets/5/tickets?ticket=7");

    const aside = within(
      await screen.findByRole("complementary", { name: "Ticket" }),
    );

    expect(
      await aside.findByRole("button", { name: "Écrire les US maintenant" }),
    ).toBeDefined();
  });
});

describe("085 C: Run and US are links on the page of a ticket", () => {
  it("given a story in progress with a run and a dependency, when /tickets/:id loads, then « Run 17 » leads to /runs/17 and « US 20 » to /us/20", async () => {
    const inProgress = story(21, 7, "exporter le journal", {
      status: "in_progress",
      dependsOn: [{ id: 20, iWant: "préparer", status: "done" }],
    });
    stubDecisionApi({
      tickets: [{ ...ticket(7, "Idée découpée"), step: "in_progress" }],
      stories: [decisionStory(inProgress)],
    });
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const res = await inner(input, init);
        if (
          pathOf(input) !== "/api/tickets/7" ||
          (init?.method ?? "GET") !== "GET"
        )
          return res;
        const body = await res.json();
        return Response.json({
          ...body,
          stories: body.stories.map((s: object) => ({ ...s, runId: 17 })),
        });
      }),
    );
    renderAt("/tickets/7");

    const row = (await screen.findByRole("link", { name: /US 21 · / })).closest(
      "li",
    ) as HTMLElement;

    expect(
      within(row).getByRole("link", { name: "Run 17" }).getAttribute("href"),
    ).toBe("/runs/17");
    expect(
      within(row).getByRole("link", { name: "US 20" }).getAttribute("href"),
    ).toBe("/us/20");
  });
});

describe("085 K: deleting a ticket returns to the Tickets tab", () => {
  it("given a ticket without stories, when its deletion is confirmed, then the page is /projets/5/tickets", async () => {
    stubDecisionApi({
      tickets: [ticket(7, "Disparaît"), ticket(6, "Survit")],
      stories: [],
    });
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Disparaît/ });
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la suppression" }),
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/projets/5/tickets"),
    );
  });
});

describe("085 D: the page of a ticket offers only what the role and the archive allow", () => {
  const withStory = () =>
    stubDecisionApi({
      tickets: [{ ...WITH_STORIES, step: "to_validate" }],
      stories: TWO.map((s) => decisionStory(s)),
    });
  const without = () =>
    stubDecisionApi({ tickets: [ticket(7, "Idée brute")], stories: [] });

  it.each([
    ["a read_only member", { role: "read_only" }],
    ["an archived project", { role: "owner", archived: true }],
  ])(
    "given %s, when a ticket with stories loads, then Modifier, Valider, Abandonner and + Ajouter are not offered",
    async (_name, extra) => {
      withStory();
      projectIs(extra);
      renderAt("/tickets/12");

      await screen.findByRole("link", { name: /US 42 · Lien par e-mail/ });

      for (const name of [
        "Modifier",
        "Valider",
        "Abandonner le ticket",
        "+ Ajouter",
      ])
        expect(screen.queryByRole("button", { name }), name).toBeNull();
    },
  );

  it.each([
    ["a read_only member", { role: "read_only" }],
    ["an archived project", { role: "owner", archived: true }],
  ])(
    "given %s, when a ticket without stories loads, then Supprimer is not offered either",
    async (_name, extra) => {
      without();
      projectIs(extra);
      renderAt("/tickets/7");

      await screen.findByRole("heading", { level: 1, name: /^Idée brute/ });

      expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
    },
  );

  it("given a can_validate member on a live project, when a ticket with stories loads, then Modifier, Valider and Abandonner are offered", async () => {
    withStory();
    projectIs({ role: "can_validate" });
    renderAt("/tickets/12");

    await screen.findByRole("link", { name: /US 42 · Lien par e-mail/ });

    for (const name of ["Modifier", "Abandonner le ticket"])
      expect(screen.getByRole("button", { name })).toBeDefined();
    expect(
      screen.getAllByRole("button", { name: "Valider" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("085 tags: the form Modifier of a ticket suggests the tags already used", () => {
  it("given other tickets of the project tagged auth and export, when Modifier is clicked, then the tag field suggests both", async () => {
    stubDecisionApi({
      tickets: [
        ticket(7, "Idée brute"),
        rich(8, "Autre", { tags: ["export", "auth"] }),
      ],
      stories: [],
    });
    renderAt("/tickets/7");
    fireEvent.click(await screen.findByRole("button", { name: "Modifier" }));

    const input = await screen.findByRole("combobox", { name: "Étiquette" });

    const suggestions = () =>
      [
        ...(document
          .getElementById(input.getAttribute("list") ?? "")
          ?.querySelectorAll("option") ?? []),
      ]
        .map((o) => o.getAttribute("value"))
        .sort();
    await waitFor(() => expect(suggestions()).toEqual(["auth", "export"]));
  });
});
