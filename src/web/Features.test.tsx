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
import { API_MODULE, WEB_MODULE } from "./test-conception.tsx";
import {
  FACTURER,
  type FakeFeature,
  RELANCER,
  stubFeatures,
} from "./test-features.tsx";
import { rules } from "./test-reprise.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R3 (decision 048 D to H and J; screen S43): the screen at /projets/:id/conception/fonctionnalites.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The server answers as pinned in src/server/features.test.ts (GET /api/projects/5/features), faked by src/web/test-features.tsx.
// - The nav « Vues de la conception » has three links in this order: « Modèle », « Règles · N » (« Règles » while unknown), « Fonctionnalités »; on the map, the takeover screen
//   and this screen alike; the one of the open screen has aria-current="page".
// - The h1 is « « Facturer » : 2 acteurs, 3 règles, 2 objets. » (singular at 1: « 1 acteur », « 1 règle », « 1 objet »; the objects are counted by distinct name, mapped or not); the sentence
//   « Un clic sur une règle ouvre l'écran de reprise. » is its muted second line, inside the h1.
// - The switch is two buttons « Graphe » and « Liste » with aria-pressed, « Graphe » pressed at first. jsdom cannot lay out React Flow: the graph is NOT tested beyond being the default
//   (and the footnote under it); the list is.
// - The list is four sections (role region, aria-label) « Acteurs », « Fonctionnalités », « Règles » and « Objets ». Features: one button per feature, named by its title.
//   Rules: one item per rule of the chosen feature holding its summary and « à trancher » or « voulue », with a link named by the summary. Objects: those of the chosen feature.
// - A rule of a story to_validate links to /projets/5/conception/regles?regle=<id>; any other status to /us/<storyId>. A mapped object links to /projets/5/conception?objet=<name>.
// - A feature click puts ?f=<ticket id> in the URL; ?f unknown or missing: the first feature.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const PATH = "/projets/5/conception/fonctionnalites";
const main = () => screen.getByRole("main");
const h1 = () => within(main()).getByRole("heading", { level: 1 });
const open = async (
  features: FakeFeature[] = [FACTURER, RELANCER],
  path = PATH,
  links: { from: string; to: string; kind: string }[] = [],
) => {
  const api = stubFeatures(features, links, {
    modules: [API_MODULE, WEB_MODULE],
  });
  renderAt(path);
  await waitFor(() => expect(h1().textContent).toMatch(/acteur|Pas encore/));
  return api;
};
const list = async (path = PATH, features?: FakeFeature[]) => {
  await open(features, path);
  fireEvent.click(screen.getByRole("button", { name: "Liste" }));
};
const region = (name: string) => within(main()).getByRole("region", { name });
const search = () => new URLSearchParams(window.location.search).get("f");

describe("decision 048 E: the chip « Fonctionnalités » of the Conception tab", () => {
  it("given 3 rules, when the map loads, then the nav holds the links « Modèle », « Règles · 3 », « Fonctionnalités » and « Constats » (decision 051 D) in that order, « Fonctionnalités » to /projets/5/conception/fonctionnalites", async () => {
    stubFeatures([FACTURER], [], { modules: [API_MODULE] }, rules(3));
    renderAt("/projets/5/conception");

    const nav = await screen.findByRole("navigation", {
      name: "Vues de la conception",
    });
    await within(nav).findByRole("link", { name: "Règles · 3" });

    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Modèle", "/projets/5/conception"],
      ["Règles · 3", "/projets/5/conception/regles"],
      ["Fonctionnalités", PATH],
      ["Constats", "/projets/5/conception/constats"],
    ]);
  });

  it("given the features screen, when it is open, then its chip has aria-current=page and the others have none", async () => {
    await open();

    const nav = screen.getByRole("navigation", {
      name: "Vues de la conception",
    });
    expect(
      within(nav)
        .getByRole("link", { name: "Fonctionnalités" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(nav)
        .getByRole("link", { name: "Modèle" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("given the map, when the chip « Fonctionnalités » is clicked, then the features screen opens", async () => {
    stubFeatures([FACTURER], [], { modules: [API_MODULE] });
    renderAt("/projets/5/conception");

    fireEvent.click(
      await screen.findByRole("link", { name: "Fonctionnalités" }),
    );

    await waitFor(() => expect(window.location.pathname).toBe(PATH));
    await waitFor(() => expect(h1().textContent).toContain("Facturer"));
  });
});

describe("decision 048 E: the chosen feature and the state sentence", () => {
  it("given two features and no ?f, when the screen opens, then the first one is chosen and the h1 says « « Facturer » : 2 acteurs, 3 règles, 2 objets. »", async () => {
    await open();

    // The state sentence is the h1: the title, then « Un clic… » as its muted second line (048 E, 045 D).
    expect(h1().textContent).toBe(
      "« Facturer » : 2 acteurs, 3 règles, 2 objets.Un clic sur une règle ouvre l'écran de reprise.",
    );
  });

  it("given ?f=12, when the screen opens, then the second feature is chosen, with singular words", async () => {
    await open(undefined, `${PATH}?f=12`);

    expect(h1().textContent).toMatch(
      /^« Relancer les impayés » : 1 acteur, 1 règle, 1 objet\./,
    );
  });

  it("given an unknown ?f, when the screen opens, then the first feature is chosen", async () => {
    await open(undefined, `${PATH}?f=999`);

    expect(h1().textContent).toContain("« Facturer »");
  });

  it("given the screen at its start, when it loads, then « Graphe » is pressed and « Liste » is not, and the footnote tells clear from grey", async () => {
    await open();

    expect(
      screen
        .getByRole("button", { name: "Graphe" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Liste" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(main().textContent).toContain(
      "En clair : ce qui touche « Facturer ». En gris : le reste de l'application.",
    );
  });

  it("given the graph, when « Liste » is clicked, then it is pressed and « Graphe » is not", async () => {
    await list();

    expect(
      screen
        .getByRole("button", { name: "Liste" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Graphe" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("decision 048 H: the four catalogues of the list", () => {
  it("given the list of « Facturer », when it shows, then the actors are Client and Comptable", async () => {
    await list();

    const items = within(region("Acteurs")).getAllByRole("listitem");

    expect(items.map((i) => i.textContent)).toEqual(["Client", "Comptable"]);
  });

  it("given the list, when it shows, then the features are one button each, in the order of the route", async () => {
    await list();

    expect(
      within(region("Fonctionnalités"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Facturer", "Relancer les impayés"]);
  });

  it("given a pending and a kept rule, when the list shows, then each rule says « à trancher » or « voulue »", async () => {
    await list();

    const items = within(region("Règles")).getAllByRole("listitem");

    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain(
      "Une facture garde le prix du jour.",
    );
    expect(items[0]?.textContent).toContain("à trancher");
    expect(items[0]?.textContent).not.toContain("voulue");
    expect(items[1]?.textContent).toContain(
      "Une facture payée ne change plus.",
    );
    expect(items[1]?.textContent).toContain("voulue");
  });

  it("given a feature, when its list shows, then the objects are Order and Ghost", async () => {
    await list();

    const text = region("Objets").textContent ?? "";

    expect(text).toContain("Order");
    expect(text).toContain("Ghost");
    expect(text).not.toContain("Session");
  });

  it("given the second feature, when its button is clicked, then ?f=12 is in the URL, the h1 follows and the rules are its own", async () => {
    await list();

    fireEvent.click(
      within(region("Fonctionnalités")).getByRole("button", {
        name: "Relancer les impayés",
      }),
    );

    await waitFor(() => expect(search()).toBe("12"));
    expect(h1().textContent).toContain("« Relancer les impayés »");
    expect(region("Règles").textContent).toContain(
      "Une relance part au bout de trente jours.",
    );
    expect(region("Règles").textContent).not.toContain("prix du jour");
  });
});

describe("decision 048 G: where a click leads", () => {
  it("given a rule of a story to_validate, when the list shows, then its link goes to the takeover screen on that rule", async () => {
    await list();

    const link = within(region("Règles")).getByRole("link", {
      name: /Une facture garde le prix du jour\./,
    });

    expect(link.getAttribute("href")).toBe(
      "/projets/5/conception/regles?regle=101",
    );
  });

  it("given a rule of a story that is ready, when the list shows, then its link goes to the page of the story", async () => {
    await list();

    const link = within(region("Règles")).getByRole("link", {
      name: /Une facture a un numéro unique\./,
    });

    expect(link.getAttribute("href")).toBe("/us/32");
  });

  it("given an object of the map, when the list shows, then it links to the tab « Modèle » on that object", async () => {
    await list();

    const link = within(region("Objets")).getByRole("link", { name: /Order/ });

    expect(link.getAttribute("href")).toBe("/projets/5/conception?objet=Order");
  });

  it("given an object absent from the map, when the list shows, then it is not a link, it says « non cartographié » with the sentence and « Relancer l'analyse »", async () => {
    await list();

    const objects = within(region("Objets"));

    expect(objects.queryByRole("link", { name: /Ghost/ })).toBeNull();
    expect(region("Objets").textContent).toContain("non cartographié");
    expect(region("Objets").textContent).toContain(
      "Cet objet n'est pas dans la carte du code. Relance l'analyse pour l'y ajouter.",
    );
    expect(
      objects.getAllByRole("button", { name: "Relancer l'analyse" }).length,
    ).toBeGreaterThan(0);
  });

  it("given an unmapped object, when « Relancer l'analyse » is clicked, then the window « Analyser avec Claude » opens", async () => {
    await list();

    fireEvent.click(
      within(region("Objets")).getAllByRole("button", {
        name: "Relancer l'analyse",
      })[0] as HTMLElement,
    );

    expect(
      await screen.findByRole("complementary", {
        name: "Analyser avec Claude",
      }),
    ).toBeDefined();
  });

  it("given an actor, when the list shows, then it is neither a link nor a button", async () => {
    await list();

    const actors = within(region("Acteurs"));

    expect(actors.queryAllByRole("link")).toEqual([]);
    expect(actors.queryAllByRole("button")).toEqual([]);
  });
});

describe("decision 048 J: no feature yet", () => {
  it("given no feature, when the screen opens, then it says « Pas encore de fonctionnalité reprise. Choisis-en une dans « Analyser avec Claude ». » and the button opens the window", async () => {
    await open([]);

    expect(main().textContent).toContain(
      "Pas encore de fonctionnalité reprise. Choisis-en une dans « Analyser avec Claude ».",
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

  it("given no feature, when the screen opens, then there is no switch and no export", async () => {
    await open([]);

    expect(screen.queryByRole("button", { name: "Liste" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Exporter en Markdown" }),
    ).toBeNull();
  });
});
