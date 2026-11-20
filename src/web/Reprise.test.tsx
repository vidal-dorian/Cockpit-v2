// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_MODULE } from "./test-conception.tsx";
import {
  type FakeRule,
  FILE,
  rule,
  rules,
  stubReprise,
} from "./test-reprise.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R2 (decision 047 E, I, J; screen S42): the takeover screen at /projets/:id/conception/regles.
//
// Pinned where the decisions leave it open (the developer follows these):
// - The server answers as pinned in src/web/test-reprise.tsx (GET /api/projects/5/rules, the decisions at /api/criteria/:id/...).
// - The Conception tab shows two chips, links named « Modèle » (to /projets/5/conception) and « Règles · N » (to /projets/5/conception/regles), on the map and on the
//   takeover screen alike; the one of the screen has aria-current="page" there.
// - The state sentence is the h1: « 34 règles trouvées. 12 validées, 22 à relire. » (« 1 règle trouvée » for one). The right panel (aside[data-panel]) holds « Règle 13 sur 34 »,
//   the buttons « Précédente » and « Suivante » (disabled at the ends), the summary as a heading, the reasoning, the box « Ce que Claude n'a pas pu trancher » only with a doubt,
//   « Étant donné », « Quand » and « Alors » with their texts, « Une fois validée » and the buttons « Valider la règle », « Corriger le texte », « C'est un bug ».
// - The open rule is in the URL: ?regle=<id>, which « Précédente », « Suivante », « Plus tard » and the keys keep up to date.
// - « Valider la règle » sends POST /api/criteria/:id/keep, moves to the next rule and shows a button « Annuler » for 8 seconds (POST .../unkeep, back on that rule).
// - « Corriger le texte » (key M) makes four fields editable, labelled « La règle », « Étant donné », « Quand », « Alors », with « Enregistrer » (PATCH { summary, given, when, then }) and « Annuler ».
// - « C'est un bug » (key B) sends POST /api/criteria/:id/bug, with no confirmation, and the rule leaves the screen.
// - Keys (not in a field, not with Ctrl, Alt or Meta): V validate, M correct, B bug, P later (next, nothing changes), J next, K previous.
// - Sources: one role="tab" per source when the rule has several (named by its path), none for one; the code header has the path in a <code>, « lignes 40–58 » (« ligne 40 » for
//   one, with an en dash) and « vérifié sur GitHub »; the lines are the CodeView of src/web/CodeView.test.tsx (rows with data-line, data-cited).
// - An object of the rule is a chip: a link to the tab « Modèle » (href under /projets/5/conception, with the object's name) when it is in the map; otherwise a grey chip
//   « non cartographié ». « Relancer l'analyse » (panel and banner) opens the window « Analyser avec Claude ».

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const inPanel = () => within(panel());
const open = async (
  list: FakeRule[],
  path = "/projets/5/conception/regles",
  options: Parameters<typeof stubReprise>[1] = {},
) => {
  const api = stubReprise(list, options);
  renderAt(path);
  await waitFor(() => expect(panel().textContent).toMatch(/Règle \d+ sur \d+/));
  return api;
};
const click = (name: string | RegExp) =>
  fireEvent.click(inPanel().getByRole("button", { name }));
const heading = () => inPanel().getAllByRole("heading")[0]?.textContent;
const search = () => new URLSearchParams(window.location.search).get("regle");
const key = (k: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key: k });

describe("decision 047 I: the chips of the Conception tab", () => {
  it("given 3 rules, when the Conception tab loads, then the chips « Modèle » and « Règles · 3 » are links to the map and to the takeover screen", async () => {
    stubReprise(rules(3), { modules: [API_MODULE] });
    renderAt("/projets/5/conception");

    const rulesChip = await screen.findByRole("link", { name: "Règles · 3" });
    const mapChip = within(main()).getByRole("link", { name: "Modèle" });

    expect(rulesChip.getAttribute("href")).toBe("/projets/5/conception/regles");
    expect(mapChip.getAttribute("href")).toBe("/projets/5/conception");
  });

  it("given no rule, when the Conception tab loads, then the chip says « Règles · 0 »", async () => {
    stubReprise([], { modules: [API_MODULE] });
    renderAt("/projets/5/conception");

    expect(
      await screen.findByRole("link", { name: "Règles · 0" }),
    ).toBeDefined();
  });

  it("given the takeover screen, when it loads, then both chips are there and « Règles · 34 » is the current one", async () => {
    await open(rules(34, 12));

    const chip = within(main()).getByRole("link", { name: "Règles · 34" });
    expect(chip.getAttribute("aria-current")).toBe("page");
    expect(
      within(main())
        .getByRole("link", { name: "Modèle" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("given the takeover screen, when « Modèle » is clicked, then the map of the code is shown again", async () => {
    await open(rules(3), "/projets/5/conception/regles", {
      modules: [API_MODULE],
    });

    fireEvent.click(within(main()).getByRole("link", { name: "Modèle" }));

    await waitFor(() =>
      expect(window.location.pathname).toBe("/projets/5/conception"),
    );
    await waitFor(() => expect(main().textContent).toContain("Serveur"));
  });
});

describe("decision 047 I: the state sentence and the open rule", () => {
  it("given 34 rules of which 12 are validated, when the screen opens, then the sentence says so and the panel is on the first pending rule: « Règle 13 sur 34 »", async () => {
    await open(rules(34, 12));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "34 règles trouvées. 12 validées, 22 à relire.",
    );
    expect(panel().textContent).toContain("Règle 13 sur 34");
    expect(heading()).toBe("Règle numéro 13.");
  });

  it("given the rule 3 of 34, when /conception/regles?regle=3 loads, then that rule is open: « Règle 3 sur 34 »", async () => {
    await open(rules(34, 12), "/projets/5/conception/regles?regle=3");

    expect(panel().textContent).toContain("Règle 3 sur 34");
    expect(heading()).toBe("Règle numéro 3.");
  });

  it("given one rule only, when the screen opens, then the sentence is singular", async () => {
    await open(rules(1));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "1 règle trouvée. 0 validée, 1 à relire.",
    );
  });

  it("given the rule 13, when « Suivante » is clicked, then the rule 14 is open and the URL says ?regle=14; « Précédente » goes back", async () => {
    await open(rules(34, 12));

    click("Suivante");

    expect(panel().textContent).toContain("Règle 14 sur 34");
    expect(search()).toBe("14");
    click("Précédente");
    expect(panel().textContent).toContain("Règle 13 sur 34");
    expect(search()).toBe("13");
  });

  it("given the first rule, when it is open, then « Précédente » is disabled; given the last, « Suivante » is", async () => {
    await open(rules(3), "/projets/5/conception/regles?regle=1");
    expect(
      (
        inPanel().getByRole("button", {
          name: "Précédente",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    click("Suivante");
    click("Suivante");

    expect(
      (inPanel().getByRole("button", { name: "Suivante" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("decision 047 I: the panel of a rule", () => {
  it("given a rule, when it is open, then the panel shows the summary as heading, the reasoning, the three parts and the sentence on the test that freezes it", async () => {
    await open([rule(1)]);

    const text = panel().textContent ?? "";
    expect(heading()).toBe("Règle numéro 1.");
    expect(text).toContain("Raisonnement de la règle 1.");
    for (const label of ["Étant donné", "Quand", "Alors"])
      expect(text).toContain(label);
    expect(text).toContain("un état 1");
    expect(text).toContain("une action 1");
    expect(text).toContain("un résultat 1");
    expect(text).toContain("Une fois validée");
    expect(text).toContain("Claude écrit un test qui la fige");
    expect(
      inPanel().getByRole("button", { name: /Valider la règle/ }),
    ).toBeDefined();
    expect(
      inPanel().getByRole("button", { name: "Corriger le texte" }),
    ).toBeDefined();
    expect(
      inPanel().getByRole("button", { name: "C'est un bug" }),
    ).toBeDefined();
  });

  it("given a rule with a doubt, when it is open, then the box « Ce que Claude n'a pas pu trancher » shows it", async () => {
    await open([rule(1, { doubt: "Les 10 % de marge sont écrits en dur." })]);

    expect(panel().textContent).toContain("Ce que Claude n'a pas pu trancher");
    expect(panel().textContent).toContain(
      "Les 10 % de marge sont écrits en dur.",
    );
  });

  it("given a rule with no doubt, when it is open, then the box is not there", async () => {
    await open([rule(1)]);

    expect(panel().textContent).not.toContain(
      "Ce que Claude n'a pas pu trancher",
    );
  });
});

describe("decision 047 J: the objects of a rule", () => {
  const objects = [
    { name: "Order", inMap: true },
    { name: "Ghost", inMap: false },
  ];

  it("given an object of the map, when the rule is open, then it is a link to the tab « Modèle » and is not said unmapped", async () => {
    await open([rule(1, { objects: [{ name: "Order", inMap: true }] })]);

    const link = inPanel().getByRole("link", { name: /Order/ });

    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/projets/5/conception")).toBe(true);
    expect(href).not.toContain("/regles");
    expect(href).toContain("Order");
    expect(panel().textContent).not.toContain("non cartographié");
    expect(panel().textContent).not.toContain(
      "Cet objet n'est pas dans la carte du code",
    );
  });

  it("given an object absent from the map, when the rule is open, then its chip says « non cartographié » with the sentence and the link « Relancer l'analyse »", async () => {
    await open([rule(1, { objects })]);

    expect(panel().textContent).toContain("Ghost");
    expect(panel().textContent).toContain("non cartographié");
    expect(panel().textContent).toContain(
      "Cet objet n'est pas dans la carte du code. Relance l'analyse pour l'y ajouter.",
    );
    expect(
      inPanel().getAllByRole("link", { name: "Relancer l'analyse" }).length +
        inPanel().queryAllByRole("button", { name: "Relancer l'analyse" })
          .length,
    ).toBeGreaterThan(0);
  });

  it("given an unmapped object, when « Relancer l'analyse » of the panel is clicked, then the window « Analyser avec Claude » opens", async () => {
    await open([rule(1, { objects })]);

    fireEvent.click(
      inPanel().queryByRole("button", { name: "Relancer l'analyse" }) ??
        inPanel().getByRole("link", { name: "Relancer l'analyse" }),
    );

    expect(
      await screen.findByRole("complementary", {
        name: "Analyser avec Claude",
      }),
    ).toBeDefined();
  });

  it("given 2 rules that cite objects absent from the map and one that does not, when the screen opens, then the banner says « 2 règles citent des objets absents de la carte. Relance l'analyse pour qu'elle les montre. » with a button", async () => {
    await open([
      rule(1, { objects }),
      rule(2, {
        objects: [
          { name: "Other", inMap: false },
          { name: "Third", inMap: false },
        ],
      }),
      rule(3, { objects: [{ name: "Order", inMap: true }] }),
    ]);

    expect(main().textContent).toContain(
      "2 règles citent des objets absents de la carte. Relance l'analyse pour qu'elle les montre.",
    );
    fireEvent.click(
      within(main()).getAllByRole("button", {
        name: "Relancer l'analyse",
      })[0] as HTMLElement,
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Analyser avec Claude",
      }),
    ).toBeDefined();
  });

  it("given rules whose objects are all in the map, when the screen opens, then there is no banner", async () => {
    await open([
      rule(1, { objects: [{ name: "Order", inMap: true }] }),
      rule(2),
    ]);

    expect(main().textContent).not.toContain("absents de la carte");
  });
});

describe("decision 047 G, I: the sources and the code", () => {
  it("given a rule with one source, when it is open, then the header says the file in mono, the lines and « vérifié sur GitHub », and there is no tab", async () => {
    await open([rule(1)]);

    await waitFor(() => expect(main().textContent).toContain(`${FILE}:40`));
    const header = within(main()).getByText(FILE, { selector: "code" });
    expect(header).toBeDefined();
    expect(main().textContent).toContain("lignes 40–58");
    expect(main().textContent).toContain("vérifié sur GitHub");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("given a rule that cites the lines 40 to 58, when the code is read, then it is asked at the commit of the source and shows 37 to 61 with exactly the lines 40 to 58 cited", async () => {
    const api = await open([rule(1)]);

    await waitFor(() =>
      expect(main().querySelectorAll("[data-line]").length).toBeGreaterThan(0),
    );
    const read = api.codeReads()[0];
    expect(Object.fromEntries(new URLSearchParams(read?.search))).toEqual({
      sha: "a1b2c3d".padEnd(40, "0"),
      path: FILE,
      start: "40",
      end: "58",
    });
    const rows = [...main().querySelectorAll<HTMLElement>("[data-line]")];
    expect(rows.map((r) => r.dataset.line)).toEqual(
      Array.from({ length: 25 }, (_, i) => String(37 + i)),
    );
    expect(
      rows
        .filter((r) => r.hasAttribute("data-cited"))
        .map((r) => r.dataset.line),
    ).toEqual(Array.from({ length: 19 }, (_, i) => String(40 + i)));
  });

  it("given a source of one line, when the rule is open, then the header says « ligne 12 »", async () => {
    await open([
      rule(1, {
        sources: [
          { path: FILE, startLine: 12, endLine: 12, commitSha: "a".repeat(40) },
        ],
      }),
    ]);

    await waitFor(() => expect(main().textContent).toContain("ligne 12"));
    expect(main().textContent).not.toContain("lignes 12");
  });

  it("given a rule with two sources, when it is open, then there is one tab per source named by its path, the first is selected, and a click on the second shows its code", async () => {
    const second = {
      path: "src/Entity/Facture.php",
      startLine: 5,
      endLine: 9,
      commitSha: "b".repeat(40),
    };
    const api = await open([
      rule(1, {
        sources: [rule(1).sources[0] as FakeRule["sources"][number], second],
      }),
    ]);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining(FILE),
      expect.stringContaining("src/Entity/Facture.php"),
    ]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
    fireEvent.click(tabs[1] as HTMLElement);

    await waitFor(() =>
      expect(main().textContent).toContain("src/Entity/Facture.php:5"),
    );
    expect(main().textContent).toContain("lignes 5–9");
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected")),
    ).toEqual(["false", "true"]);
    expect(
      api.codeReads().map((c) => new URLSearchParams(c.search).get("sha")),
    ).toContain("b".repeat(40));
  });

  it("given the code cannot be read, when the rule is open, then the screen says so and the rule is still judgeable", async () => {
    stubReprise([rule(1)]);
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          new URL(raw, "http://localhost").pathname === "/api/projects/5/code"
        )
          return Response.json(
            { error: "github_unavailable" },
            { status: 502 },
          );
        return inner(input, init);
      }),
    );
    renderAt("/projets/5/conception/regles");

    await waitFor(() =>
      expect(main().textContent).toMatch(/Le code n'a pas pu être lu/),
    );
    expect(
      (
        inPanel().getByRole("button", {
          name: /Valider la règle/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe("decision 047 E: « Valider la règle »", () => {
  it("given the rule 13 pending, when « Valider la règle » is clicked, then POST keep, the rule 14 is open and the sentence counts 13 validées", async () => {
    const api = await open(rules(34, 12));

    click(/Valider la règle/);

    await waitFor(() =>
      expect(panel().textContent).toContain("Règle 14 sur 34"),
    );
    expect(api.writes()).toEqual(["POST /api/criteria/13/keep"]);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "13 validées, 21 à relire.",
      ),
    );
  });

  it("given a rule just validated, when « Annuler » is clicked within 8 seconds, then POST unkeep and the rule is back, pending", async () => {
    const api = await open(rules(34, 12));
    click(/Valider la règle/);

    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));

    await waitFor(() =>
      expect(api.writes()).toEqual([
        "POST /api/criteria/13/keep",
        "POST /api/criteria/13/unkeep",
      ]),
    );
    await waitFor(() =>
      expect(panel().textContent).toContain("Règle 13 sur 34"),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "12 validées, 22 à relire.",
      ),
    );
  });

  it("given a rule just validated, when 8 seconds pass, then « Annuler » is gone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await open(rules(34, 12));
    click(/Valider la règle/);
    await screen.findByRole("button", { name: "Annuler" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });
});

describe("decision 047 E: « Corriger le texte »", () => {
  it("given a rule, when « Corriger le texte » is clicked, then four fields hold the text; saving sends the new text, keeps the rule pending and shows the new text", async () => {
    const api = await open(
      [rule(1), rule(2)],
      "/projets/5/conception/regles?regle=1",
    );

    click("Corriger le texte");
    const field = (label: string) =>
      inPanel().getByLabelText(label) as HTMLInputElement;
    expect(field("La règle").value).toBe("Règle numéro 1.");
    expect(field("Étant donné").value).toBe("un état 1");
    expect(field("Quand").value).toBe("une action 1");
    expect(field("Alors").value).toBe("un résultat 1");
    fireEvent.change(field("La règle"), {
      target: { value: "Règle corrigée." },
    });
    fireEvent.change(field("Alors"), {
      target: { value: "un autre résultat" },
    });
    click("Enregistrer");

    await waitFor(() =>
      expect(api.writes()).toEqual(["PATCH /api/criteria/1"]),
    );
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      summary: "Règle corrigée.",
      given: "un état 1",
      when: "une action 1",
      then: "un autre résultat",
    });
    await waitFor(() => expect(heading()).toBe("Règle corrigée."));
    expect(panel().textContent).toContain("un autre résultat");
    expect(inPanel().queryByLabelText("La règle")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "0 validée, 2 à relire.",
    );
  });

  it("given the form open, when « Annuler » is clicked, then nothing is sent and the text is unchanged", async () => {
    const api = await open([rule(1)]);
    click("Corriger le texte");
    fireEvent.change(inPanel().getByLabelText("La règle"), {
      target: { value: "autre" },
    });

    click("Annuler");

    expect(inPanel().queryByLabelText("La règle")).toBeNull();
    expect(heading()).toBe("Règle numéro 1.");
    expect(api.writes()).toEqual([]);
  });
});

describe("decision 047 E: « C'est un bug »", () => {
  it("given a rule, when « C'est un bug » is clicked, then POST bug, the rule leaves the screen, the next one opens and the sentence counts one rule less", async () => {
    const api = await open(rules(3), "/projets/5/conception/regles?regle=2");

    click("C'est un bug");

    await waitFor(() =>
      expect(api.writes()).toEqual(["POST /api/criteria/2/bug"]),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "2 règles trouvées.",
      ),
    );
    expect(panel().textContent).toContain("sur 2");
    expect(panel().textContent).not.toContain("Règle numéro 2.");
    expect(main().textContent).not.toContain("Règle numéro 2.");
  });
});

describe("decision 047 E: the keys", () => {
  it("given a rule, when V is pressed, then the rule is validated", async () => {
    const api = await open(rules(3));

    key("v");

    await waitFor(() =>
      expect(api.writes()).toEqual(["POST /api/criteria/1/keep"]),
    );
  });

  it("given a rule, when M is pressed, then the text becomes editable", async () => {
    await open(rules(3));

    key("m");

    expect(await inPanel().findByLabelText("La règle")).toBeDefined();
  });

  it("given a rule, when B is pressed, then it is a bug", async () => {
    const api = await open(rules(3));

    key("b");

    await waitFor(() =>
      expect(api.writes()).toEqual(["POST /api/criteria/1/bug"]),
    );
  });

  it("given the rule 1, when P is pressed, then the rule 2 is open and nothing was sent", async () => {
    const api = await open(rules(3));

    key("p");

    await waitFor(() => expect(panel().textContent).toContain("Règle 2 sur 3"));
    expect(api.writes()).toEqual([]);
  });

  it("given the single-key shortcuts turned off, when M, B or P is pressed, then nothing opens, nothing is sent and the rule stays", async () => {
    localStorage.setItem("cockpit-single-key-shortcuts-off", "1");
    const api = await open(rules(3));

    key("m");
    key("b");
    key("p");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(api.writes()).toEqual([]);
    expect(panel().textContent).toContain("Règle 1 sur 3");
    localStorage.clear();
  });

  it("given the rule 1, when J is pressed, then the next rule is open; when K is pressed, then the previous one", async () => {
    await open(rules(3));

    key("j");
    await waitFor(() => expect(panel().textContent).toContain("Règle 2 sur 3"));
    key("k");

    await waitFor(() => expect(panel().textContent).toContain("Règle 1 sur 3"));
  });

  it("given a field of the correction form, when V is typed in it, then nothing is validated", async () => {
    const api = await open(rules(3));
    key("m");
    const field = await inPanel().findByLabelText("La règle");

    key("v", field);
    key("b", field);

    expect(api.writes()).toEqual([]);
  });

  it("given Ctrl held, when V is pressed, then nothing is validated (the browser's own shortcut)", async () => {
    const api = await open(rules(3));

    fireEvent.keyDown(document.body, { key: "v", ctrlKey: true });

    expect(api.writes()).toEqual([]);
  });
});

describe("decision 047 I: no rule yet", () => {
  it("given no rule, when the screen opens, then it says « Pas encore de règle… » with « Analyser avec Claude », which opens the window", async () => {
    stubReprise([]);
    renderAt("/projets/5/conception/regles");

    await waitFor(() =>
      expect(main().textContent).toContain(
        "Pas encore de règle. Choisis une fonctionnalité à reprendre et Claude en tire les règles.",
      ),
    );
    fireEvent.click(
      within(main()).getByRole("button", { name: "Analyser avec Claude" }),
    );

    expect(
      await screen.findByRole("complementary", {
        name: "Analyser avec Claude",
      }),
    ).toBeDefined();
  });
});
