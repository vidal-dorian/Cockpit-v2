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
import {
  type FakeFinding,
  finding,
  HASHER,
  stubFindings,
} from "./test-findings.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R5 (decision 051 D, E, F, G, I; screen S44): the screen of the findings at /projets/:id/conception/constats.
//
// Pinned where the decisions leave it open (the developer follows these):
// - The server answers as pinned in src/web/test-findings.tsx (GET /api/projects/5/findings, the decisions at /api/findings/:id/...). The screen shows the findings TO DECIDE
//   (status open or later) under « Tous » and the filters; the ticketed ones are tickets now and are shown nowhere. It sorts them itself: severity (critical, high, medium, low),
//   then the most recent first (createdAt), whatever the order the server gave.
// - The Conception tab shows four chips, links in <nav aria-label="Vues de la conception">: « Modèle », « Règles · N », « Fonctionnalités » and « Constats · N » (to
//   /projets/5/conception/constats, aria-current="page" on that screen), N being the number of findings to decide.
// - The state sentence is the h1: « 9 constats sur hello, dont 2 failles. » then « Triés par gravité. Une faille devient un ticket en un clic. » (« 1 constat sur hello, dont 1 faille. »
//   for one; no « , dont … » when no finding is a faille, i.e. of kind security). `hello` is the name of the repo (octocat/hello).
// - Filters (decision 052 H, slice R6: « Versions » joins them between « Failles » and « Architecture »): buttons « Tous », « Bugs », « Failles », « Versions », « Architecture », « Stack » and « Rejetés » in a group named « Filtrer les constats », the selected one has aria-pressed="true",
//   the others "false". « Tous » is selected at first. « Rejetés » shows the dismissed findings (and no « À corriger d'abord »).
// - A <section> holds the label « 1 · À corriger d'abord » and the first finding to decide: a card with its title, a line « <type> <gravité> » (« faille critique », « bug moyenne »...,
//   the type being bug, faille (security), architecture or stack) and the first cited place `<path>:<start line>`, and the button « En faire un ticket ». Another <section> holds the label
//   « Les autres constats » and one list item per other finding to decide, with its title, its type, its place and the severity word (critique, haute, moyenne, basse).
//   Every finding has a button named « Ouvrir <title> » that opens it in the right panel (aside[data-panel]).
// - Red is only in the featured card: elements with a class containing « you- » (the red tokens of styles.css) exist there and nowhere else in the page, and nowhere at all
//   when no finding is to be decided.
// - The panel has the title as its first heading, the type and severity words, « Effort : petit | moyen | grand » when there is an effort, the body as Markdown, the code of each
//   source as CodeView (header with the file in a <code>, « lignes 22–30 » / « ligne 22 », « vérifié sur GitHub », one role="tab" per source named by its path when there are several,
//   none for one), the line « Aucune règle figée ne protège ce code : reprends d'abord la fonctionnalité qui le touche. » only when `unprotected` is true, the field « Raison du rejet
//   (facultative) » and the buttons « En faire un ticket », « Rejeter » and « Plus tard ».
// - « En faire un ticket » posts /api/findings/:id/ticket, « Rejeter » posts /api/findings/:id/dismiss with { reason } (no reason, or an empty one, when the field is blank),
//   « Plus tard » posts /api/findings/:id/later; the findings are then read again. A refusal is an alert in French (never the code) and the finding stays.
// - On an archived project (GET /api/projects gives `archived: true`) the three decisions are disabled.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const PATH = "/projets/5/conception/constats";
const GROUP = "Filtrer les constats";
const REMINDER =
  "Aucune règle figée ne protège ce code : reprends d'abord la fonctionnalité qui le touche.";
const main = () => screen.getByRole("main");
const inPanel = () => within(panel());
const open = async (
  list: FakeFinding[],
  path = PATH,
  options: Parameters<typeof stubFindings>[1] = {},
) => {
  const api = stubFindings(list, options);
  renderAt(path);
  await screen.findByRole("link", { name: /^Constats · \d+$/ });
  return api;
};
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";
const featured = () =>
  screen.getByText("1 · À corriger d'abord").closest("section") as HTMLElement;
const others = () =>
  screen.getByText("Les autres constats").closest("section") as HTMLElement;
const titlesOfOthers = () =>
  within(others())
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
const filter = (name: string) =>
  within(screen.getByRole("group", { name: GROUP })).getByRole("button", {
    name,
  });
const openFinding = (title: string) =>
  fireEvent.click(
    within(main()).getByRole("button", { name: `Ouvrir ${title}` }),
  );
const shown = (title: string) =>
  within(main()).queryByRole("button", { name: `Ouvrir ${title}` }) !== null;

/** The nine findings of the screen S44: two failles, the others bugs, architecture and stack. Handed in disorder. */
const nine = (): FakeFinding[] => [
  finding(1, {
    title: "Les factures calculent la TVA à trois endroits",
    kind: "architecture",
    severity: "low",
    createdAt: "2026-11-02T10:00:00Z",
  }),
  finding(2, {
    title: "Injection SQL dans la recherche de clients",
    kind: "security",
    severity: "high",
    createdAt: "2026-11-03T10:00:00Z",
  }),
  finding(3, {
    title: "Mots de passe hachés en MD5",
    kind: "security",
    severity: "critical",
    effort: "small",
    createdAt: "2026-11-01T10:00:00Z",
  }),
  finding(4, {
    title: "Aucun test sur le module de relance",
    kind: "architecture",
    severity: "low",
    createdAt: "2026-11-05T10:00:00Z",
  }),
  finding(5, {
    title: "Remplacer le client HTTP maison",
    kind: "stack",
    severity: "low",
    createdAt: "2026-11-04T10:00:00Z",
  }),
  finding(6, {
    title: "Arrondi faux sur les remises",
    kind: "bug",
    severity: "medium",
    createdAt: "2026-11-02T08:00:00Z",
  }),
  finding(7, {
    title: "Le panier se vide à la déconnexion",
    kind: "bug",
    severity: "high",
    createdAt: "2026-11-06T10:00:00Z",
  }),
  finding(8, {
    title: "Date de relance décalée d'un jour",
    kind: "bug",
    severity: "medium",
    createdAt: "2026-11-06T09:00:00Z",
  }),
  finding(9, {
    title: "Migrer vers un ORM",
    kind: "stack",
    severity: "low",
    createdAt: "2026-11-03T08:00:00Z",
  }),
];

describe("decision 051 D: the chips of the Conception tab", () => {
  it("given nine findings to decide, when the Conception tab loads, then the four chips are there in order and « Constats · 9 » links to the screen", async () => {
    stubFindings(nine());
    renderAt("/projets/5/conception");

    const chip = await screen.findByRole("link", { name: "Constats · 9" });

    expect(chip.getAttribute("href")).toBe(PATH);
    const nav = within(main()).getByRole("navigation", {
      name: "Vues de la conception",
    });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Modèle", "Règles · 0", "Fonctionnalités", "Constats · 9"]);
  });

  it("given findings in every status, when the tab loads, then N counts the open and the later ones only", async () => {
    stubFindings([
      finding(1),
      finding(2, { status: "later" }),
      finding(3, { status: "dismissed" }),
      finding(4, { status: "ticketed", ticketId: 904 }),
    ]);
    renderAt("/projets/5/conception");

    expect(
      await screen.findByRole("link", { name: "Constats · 2" }),
    ).toBeDefined();
  });

  it("given no finding, when the tab loads, then the chip says « Constats · 0 »", async () => {
    stubFindings([]);
    renderAt("/projets/5/conception");

    expect(
      await screen.findByRole("link", { name: "Constats · 0" }),
    ).toBeDefined();
  });

  it("given the screen, when it loads, then « Constats · 9 » is the current chip and the others are not", async () => {
    await open(nine());

    expect(
      within(main())
        .getByRole("link", { name: "Constats · 9" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(main())
        .getByRole("link", { name: "Modèle" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("given the map, when « Constats · 9 » is clicked, then the screen of the findings is shown", async () => {
    stubFindings(nine());
    renderAt("/projets/5/conception");

    fireEvent.click(await screen.findByRole("link", { name: "Constats · 9" }));

    await waitFor(() => expect(window.location.pathname).toBe(PATH));
    expect(await screen.findByText("1 · À corriger d'abord")).toBeDefined();
  });
});

describe("decision 051 D: the state sentence and the filters", () => {
  it("given nine findings of which two are failles, when the screen opens, then the h1 says so and the line under it", async () => {
    await open(nine());

    expect(h1()).toContain("9 constats sur hello, dont 2 failles.");
    expect(h1()).toContain(
      "Triés par gravité. Une faille devient un ticket en un clic.",
    );
  });

  it("given one finding that is a faille, when the screen opens, then the sentence is singular", async () => {
    await open([finding(1, { kind: "security", severity: "high" })]);

    expect(h1()).toContain("1 constat sur hello, dont 1 faille.");
  });

  it("given findings and no faille, when the screen opens, then the sentence has no « dont »", async () => {
    await open([finding(1), finding(2, { kind: "stack" })]);

    expect(h1()).toContain("2 constats sur hello.");
    expect(h1()).not.toContain("dont");
  });

  it("given dismissed and ticketed findings next to two to decide, when the screen opens, then the sentence counts the two", async () => {
    await open([
      finding(1),
      finding(2, { status: "later" }),
      finding(3, { status: "dismissed" }),
      finding(4, { status: "ticketed", ticketId: 904 }),
    ]);

    expect(h1()).toContain("2 constats sur hello.");
    expect(shown("Constat numéro 3")).toBe(false);
    expect(shown("Constat numéro 4")).toBe(false);
  });

  // Changed by decision 052 H (slice R6): « Versions » is a filter between « Failles » and « Architecture » (screen S44); by decision 085 C « En ticket » is the one before « Rejetés ».
  it("given the screen, when it opens, then the eight filters are there, « Tous » is selected and the others are not", async () => {
    await open(nine());

    const group = screen.getByRole("group", { name: GROUP });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Tous",
      "Bugs",
      "Failles",
      "Versions",
      "Architecture",
      "Stack",
      "En ticket",
      "Rejetés",
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
  });

  it.each([
    [
      "Bugs",
      [
        "Arrondi faux sur les remises",
        "Le panier se vide à la déconnexion",
        "Date de relance décalée d'un jour",
      ],
    ],
    [
      "Failles",
      [
        "Injection SQL dans la recherche de clients",
        "Mots de passe hachés en MD5",
      ],
    ],
    [
      "Architecture",
      [
        "Les factures calculent la TVA à trois endroits",
        "Aucun test sur le module de relance",
      ],
    ],
    ["Stack", ["Remplacer le client HTTP maison", "Migrer vers un ORM"]],
  ])(
    "given nine findings, when the filter %s is clicked, then only those of that kind are shown, it is the pressed one, and the chip and the sentence still count nine",
    async (name, titles) => {
      await open(nine());

      fireEvent.click(filter(name));

      for (const f of nine())
        expect(shown(f.title), f.title).toBe(titles.includes(f.title));
      expect(filter(name).getAttribute("aria-pressed")).toBe("true");
      expect(filter("Tous").getAttribute("aria-pressed")).toBe("false");
      expect(
        within(main()).getByRole("link", { name: "Constats · 9" }),
      ).toBeDefined();
      expect(h1()).toContain("9 constats sur hello");
    },
  );

  it("given a filter, when « Tous » is clicked, then the nine are back", async () => {
    await open(nine());
    fireEvent.click(filter("Stack"));

    fireEvent.click(filter("Tous"));

    expect(nine().every((f) => shown(f.title))).toBe(true);
  });

  it("given a dismissed finding, when « Rejetés » is clicked, then it is shown, the ones to decide are not and there is no « À corriger d'abord »", async () => {
    await open([
      finding(1),
      finding(2, { status: "dismissed", dismissReason: "faux positif" }),
    ]);

    fireEvent.click(filter("Rejetés"));

    expect(shown("Constat numéro 2")).toBe(true);
    expect(shown("Constat numéro 1")).toBe(false);
    expect(screen.queryByText("1 · À corriger d'abord")).toBeNull();
  });
});

describe("decision 051 D, E: the order and the first finding to fix", () => {
  it("given nine findings handed in disorder, when the screen opens, then the first is alone under « 1 · À corriger d'abord » and the eight others come by severity, then the most recent first", async () => {
    await open(nine());

    expect(featured().textContent).toContain("Mots de passe hachés en MD5");
    expect(featured().textContent).not.toContain("Injection SQL");
    const rows = titlesOfOthers();
    const order = [
      "Le panier se vide à la déconnexion", // high, 11-06
      "Injection SQL dans la recherche de clients", // high, 11-03
      "Date de relance décalée d'un jour", // medium, 11-06 09:00
      "Arrondi faux sur les remises", // medium, 11-02
      "Aucun test sur le module de relance", // low, 11-05
      "Remplacer le client HTTP maison", // low, 11-04
      "Migrer vers un ORM", // low, 11-03 08:00
      "Les factures calculent la TVA à trois endroits", // low, 11-02
    ];
    expect(rows).toHaveLength(8);
    order.forEach((title, i) => {
      expect(rows[i], title).toContain(title);
    });
  });

  it("given the first finding, when the card is read, then it says « faille critique » and the first cited place, and its button « En faire un ticket » is there", async () => {
    await open(nine());

    expect(featured().textContent).toContain("faille critique");
    expect(featured().textContent).toContain(`${HASHER}:22`);
    expect(
      within(featured()).getByRole("button", { name: "En faire un ticket" }),
    ).toBeDefined();
  });

  it("given the other findings, when the list is read, then each says its type, its place and its severity as a word", async () => {
    await open(nine());

    const rows = titlesOfOthers();
    const row = (title: string) =>
      rows.find((r) => r.includes(title)) as string;
    expect(row("Le panier se vide")).toMatch(/bug/);
    expect(row("Le panier se vide")).toContain("haute");
    expect(row("Injection SQL")).toMatch(/faille/);
    expect(row("Injection SQL")).toContain(`${HASHER}:22`);
    expect(row("Arrondi faux")).toContain("moyenne");
    expect(row("Migrer vers un ORM")).toMatch(/stack/);
    expect(row("Migrer vers un ORM")).toContain("basse");
    expect(row("Aucun test")).toMatch(/architecture/);
  });

  it("given findings of the same severity and the same day, when they are listed, then the later hour comes first", async () => {
    await open([
      finding(1, { severity: "low", createdAt: "2026-11-05T08:00:00Z" }),
      finding(2, { severity: "low", createdAt: "2026-11-05T18:00:00Z" }),
      finding(3, { severity: "low", createdAt: "2026-11-05T12:00:00Z" }),
    ]);

    expect(featured().textContent).toContain("Constat numéro 2");
    expect(titlesOfOthers().map((t) => /numéro (\d)/.exec(t)?.[1])).toEqual([
      "3",
      "1",
    ]);
  });

  it("given one finding only, when the screen opens, then the first card is there and « Les autres constats » is not", async () => {
    await open([finding(1)]);

    expect(featured().textContent).toContain("Constat numéro 1");
    expect(screen.queryByText("Les autres constats")).toBeNull();
  });

  it("given a finding put off (later) that is the most serious, when the screen opens, then it is still to decide and comes first", async () => {
    await open([
      finding(1, { severity: "low" }),
      finding(2, { severity: "critical", status: "later" }),
    ]);

    expect(featured().textContent).toContain("Constat numéro 2");
  });
});

describe("decision 051 E: the red", () => {
  const reds = (root: HTMLElement) =>
    root.querySelectorAll('[class*="you-"]').length;

  it("given findings to decide, when the screen opens, then the first card is red and the list of the others is not", async () => {
    await open(nine());

    expect(reds(featured())).toBeGreaterThan(0);
    expect(reds(others())).toBe(0);
  });

  it("given findings that are all dismissed or ticketed, when the screen opens, then there is no red in the page", async () => {
    await open([
      finding(1, { status: "dismissed" }),
      finding(2, { status: "ticketed", ticketId: 902 }),
    ]);

    expect(reds(main())).toBe(0);
    expect(screen.queryByText("1 · À corriger d'abord")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "En faire un ticket" }),
    ).toBeNull();
  });

  it("given the only finding to decide, when it is made a ticket, then the page has no red left", async () => {
    await open([finding(1)]);

    fireEvent.click(
      within(featured()).getByRole("button", { name: "En faire un ticket" }),
    );

    await waitFor(() => expect(shown("Constat numéro 1")).toBe(false));
    expect(reds(main())).toBe(0);
  });
});

describe("decision 051 F, I: the panel of a finding", () => {
  it("given the first finding, when it is opened, then the panel gives its title, type, severity, effort, body in Markdown and the three buttons", async () => {
    await open([
      finding(1, {
        title: "Mots de passe hachés en MD5",
        kind: "security",
        severity: "critical",
        effort: "small",
        bodyMd: "Le **hash** est MD5.\n\n- première étape\n- deuxième étape",
      }),
    ]);

    openFinding("Mots de passe hachés en MD5");

    expect(inPanel().getAllByRole("heading")[0]?.textContent).toBe(
      "Mots de passe hachés en MD5",
    );
    expect(panel().textContent).toMatch(/faille/i);
    expect(panel().textContent).toContain("critique");
    expect(panel().textContent).toMatch(/Effort\s*:\s*petit/);
    expect(inPanel().getByText("hash").tagName).toBe("STRONG");
    expect(
      inPanel()
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(expect.arrayContaining(["première étape", "deuxième étape"]));
    for (const name of ["En faire un ticket", "Rejeter", "Plus tard"])
      expect(inPanel().getByRole("button", { name })).toBeDefined();
    expect(inPanel().getByLabelText(/Raison du rejet/)).toBeDefined();
  });

  it.each([
    ["small", "petit"],
    ["medium", "moyen"],
    ["large", "grand"],
  ] as const)(
    "given an effort %s, when the finding is opened, then the panel says « Effort : %s »",
    async (effort, word) => {
      await open([finding(1, { effort })]);

      openFinding("Constat numéro 1");

      expect(panel().textContent).toMatch(new RegExp(`Effort\\s*:\\s*${word}`));
    },
  );

  it("given a finding with no effort, when it is opened, then the panel does not speak of effort", async () => {
    await open([finding(1, { effort: null })]);

    openFinding("Constat numéro 1");

    expect(panel().textContent).not.toMatch(/Effort/i);
  });

  it("given a finding in the list, when its row is clicked, then the panel is on that one", async () => {
    await open(nine());

    openFinding("Migrer vers un ORM");

    expect(inPanel().getAllByRole("heading")[0]?.textContent).toBe(
      "Migrer vers un ORM",
    );
  });

  it("given a body with a script tag, when the finding is opened, then it is shown as text and no script element is created", async () => {
    await open([
      finding(1, { bodyMd: "Avant <script>window.hacked = 1</script> après" }),
    ]);

    openFinding("Constat numéro 1");

    expect(panel().querySelector("script")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("given a finding with one source, when it is open, then the header says the file in mono, the lines and « vérifié sur GitHub », and there is no tab", async () => {
    await open([finding(1)]);

    openFinding("Constat numéro 1");

    await waitFor(() => expect(panel().textContent).toContain(`${HASHER}:22`));
    expect(inPanel().getByText(HASHER, { selector: "code" })).toBeDefined();
    expect(panel().textContent).toContain("lignes 22–30");
    expect(panel().textContent).toContain("vérifié sur GitHub");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("given a source of one line, when the finding is open, then the header says « ligne 12 »", async () => {
    await open([
      finding(1, {
        sources: [
          {
            path: HASHER,
            startLine: 12,
            endLine: 12,
            commitSha: "a".repeat(40),
          },
        ],
      }),
    ]);

    openFinding("Constat numéro 1");

    await waitFor(() => expect(panel().textContent).toContain("ligne 12"));
    expect(panel().textContent).not.toContain("lignes 12");
  });

  it("given a source at the commit a1b2c3d and lines 22 to 30, when the code is read, then it is asked at that commit and shows 19 to 33 with exactly the lines 22 to 30 cited", async () => {
    const api = await open([finding(1)]);

    openFinding("Constat numéro 1");

    await waitFor(() =>
      expect(panel().querySelectorAll("[data-line]").length).toBeGreaterThan(0),
    );
    const read = api.codeReads()[0];
    expect(Object.fromEntries(new URLSearchParams(read?.search))).toEqual({
      sha: "a1b2c3d".padEnd(40, "0"),
      path: HASHER,
      start: "22",
      end: "30",
    });
    const rows = [...panel().querySelectorAll<HTMLElement>("[data-line]")];
    expect(rows.map((r) => r.dataset.line)).toEqual(
      Array.from({ length: 15 }, (_, i) => String(19 + i)),
    );
    expect(
      rows
        .filter((r) => r.hasAttribute("data-cited"))
        .map((r) => r.dataset.line),
    ).toEqual(Array.from({ length: 9 }, (_, i) => String(22 + i)));
  });

  it("given a finding with two sources, when it is open, then there is one tab per source named by its path, the first is selected, and a click on the second shows its code at its commit", async () => {
    const second = {
      path: "src/Repository/ClientRepository.php",
      startLine: 61,
      endLine: 61,
      commitSha: "b".repeat(40),
    };
    const api = await open([
      finding(1, {
        sources: [
          {
            path: HASHER,
            startLine: 22,
            endLine: 30,
            commitSha: "a".repeat(40),
          },
          second,
        ],
      }),
    ]);
    openFinding("Constat numéro 1");

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining(HASHER),
      expect.stringContaining("ClientRepository.php"),
    ]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
    fireEvent.click(tabs[1] as HTMLElement);

    await waitFor(() =>
      expect(panel().textContent).toContain("ClientRepository.php:61"),
    );
    expect(panel().textContent).toContain("ligne 61");
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected")),
    ).toEqual(["false", "true"]);
    expect(
      api.codeReads().map((c) => new URLSearchParams(c.search).get("sha")),
    ).toContain("b".repeat(40));
  });

  it("given an architecture finding that no frozen rule protects, when it is open, then the panel says so in a line; with a protected one, a bug and a faille, it does not", async () => {
    await open([
      finding(1, { kind: "architecture", unprotected: true }),
      finding(2, { kind: "architecture", unprotected: false, severity: "low" }),
      finding(3, { kind: "bug", severity: "low" }),
      finding(4, { kind: "security", severity: "low" }),
    ]);

    openFinding("Constat numéro 1");
    expect(panel().textContent).toContain(REMINDER);
    for (const n of [2, 3, 4]) {
      openFinding(`Constat numéro ${n}`);
      expect(panel().textContent, `finding ${n}`).not.toContain(REMINDER);
    }
  });
});

describe("decision 051 G: the decisions", () => {
  it("given the first finding, when « En faire un ticket » of the card is clicked, then POST ticket, the finding leaves the list, the next one is first and the sentence and the chip count one less", async () => {
    const api = await open(nine());

    fireEvent.click(
      within(featured()).getByRole("button", { name: "En faire un ticket" }),
    );

    await waitFor(() =>
      expect(shown("Mots de passe hachés en MD5")).toBe(false),
    );
    expect(api.writes()).toEqual(["POST /api/findings/3/ticket"]);
    expect(featured().textContent).toContain("Le panier se vide");
    expect(h1()).toContain("8 constats sur hello, dont 1 faille.");
    expect(
      within(main()).getByRole("link", { name: "Constats · 8" }),
    ).toBeDefined();
  });

  it("given a finding opened in the panel, when « En faire un ticket » of the panel is clicked, then POST ticket for that finding and it leaves the list", async () => {
    const api = await open(nine());
    openFinding("Migrer vers un ORM");

    fireEvent.click(
      inPanel().getByRole("button", { name: "En faire un ticket" }),
    );

    await waitFor(() => expect(shown("Migrer vers un ORM")).toBe(false));
    expect(api.writes()).toEqual(["POST /api/findings/9/ticket"]);
  });

  it("given a finding in the panel, when « Rejeter » is clicked after a reason is typed, then POST dismiss with the reason, the finding leaves « Tous » and « Rejetés » shows it", async () => {
    const api = await open(nine());
    openFinding("Migrer vers un ORM");
    fireEvent.change(inPanel().getByLabelText(/Raison du rejet/), {
      target: { value: "pas pour cette année" },
    });

    fireEvent.click(inPanel().getByRole("button", { name: "Rejeter" }));

    await waitFor(() => expect(shown("Migrer vers un ORM")).toBe(false));
    const sent = api.calls.find((c) => c.path === "/api/findings/9/dismiss");
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toEqual({ reason: "pas pour cette année" });
    expect(h1()).toContain("8 constats sur hello");
    fireEvent.click(filter("Rejetés"));
    await waitFor(() => expect(shown("Migrer vers un ORM")).toBe(true));
  });

  it("given a finding in the panel, when « Rejeter » is clicked with the reason blank, then POST dismiss with no reason", async () => {
    const api = await open(nine());
    openFinding("Migrer vers un ORM");

    fireEvent.click(inPanel().getByRole("button", { name: "Rejeter" }));

    await waitFor(() => expect(shown("Migrer vers un ORM")).toBe(false));
    const sent = api.calls.find((c) => c.path === "/api/findings/9/dismiss");
    expect((sent?.body as { reason?: string } | undefined)?.reason ?? "").toBe(
      "",
    );
  });

  it("given a finding in the panel, when « Plus tard » is clicked, then POST later and the finding is still to decide, the count unchanged", async () => {
    const api = await open(nine());
    openFinding("Migrer vers un ORM");

    fireEvent.click(inPanel().getByRole("button", { name: "Plus tard" }));

    await waitFor(() =>
      expect(api.writes()).toEqual(["POST /api/findings/9/later"]),
    );
    expect(shown("Migrer vers un ORM")).toBe(true);
    expect(h1()).toContain("9 constats sur hello");
  });

  it("given the server refusing a decision (409), when « En faire un ticket » is clicked, then an alert in French without the code is shown and the finding stays", async () => {
    const api = await open(nine());
    api.failNext.status = 409;

    fireEvent.click(
      within(featured()).getByRole("button", { name: "En faire un ticket" }),
    );

    const alert = await screen.findByRole("alert");
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(10);
    expect(alert.textContent).not.toContain("stub failure");
    expect(shown("Mots de passe hachés en MD5")).toBe(true);
  });

  it("given an archived project, when the screen opens, then the three decisions are disabled in the card and in the panel", async () => {
    await open(nine(), PATH, { archived: true });

    const card = within(featured()).getByRole("button", {
      name: "En faire un ticket",
    }) as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    openFinding("Migrer vers un ORM");
    for (const name of ["En faire un ticket", "Rejeter", "Plus tard"])
      expect(
        (inPanel().getByRole("button", { name }) as HTMLButtonElement).disabled,
        name,
      ).toBe(true);
  });
});

describe("decision 051 G: a settled finding is only read", () => {
  it("given a dismissed finding opened from « Rejetés », when its panel shows, then it has no decision and no reason field", async () => {
    await open([
      finding(2, { status: "dismissed", dismissReason: "faux positif" }),
    ]);
    fireEvent.click(filter("Rejetés"));

    openFinding("Constat numéro 2");

    const aside = inPanel();
    expect(aside.getByText("Rejeté : faux positif")).toBeDefined();
    for (const name of ["En faire un ticket", "Rejeter", "Plus tard"])
      expect(aside.queryByRole("button", { name }), name).toBeNull();
    expect(aside.queryByText(/Raison du rejet/)).toBeNull();
    expect(aside.getByRole("button", { name: "Fermer" })).toBeDefined();
  });

  it("given a finding, when its row is read, then its accessible description names its type and severity", async () => {
    await open([finding(1), finding(2, { kind: "security", severity: "low" })]);

    const row = within(main()).getByRole("button", {
      name: "Ouvrir Constat numéro 2",
    });

    expect(row.getAttribute("aria-describedby")).toBeTruthy();
    const text = (row.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    expect(text).toContain("faille");
    expect(text).toContain("basse");
  });
});
