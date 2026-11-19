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
import { API_MODULE } from "./test-conception.tsx";
import { FACTURER, stubFeatures } from "./test-features.tsx";
import { finding, stubFindings } from "./test-findings.tsx";
import { rule, stubReprise } from "./test-reprise.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 084 C and D (slice S09, audit findings 45 and 49 to 52): the ticket made from a finding or a rule is linked, the panel of an object lists the rules that touch it,
// `?objet=` opens the panel of the object whatever the view it comes from, the analysis can be launched from Constats and the window ticks the step that was asked for.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const inMain = async () => within(await screen.findByRole("main"));
const inPanel = () => within(panel());
const box = (ui: ReturnType<typeof within>, name: string) =>
  ui.getByRole("checkbox", { name }) as HTMLInputElement;
const analyseWindow = () =>
  screen.findByRole("complementary", { name: "Analyser avec Claude" });
const openFinding = async (title: string) => {
  renderAt("/projets/5/conception/constats");
  fireEvent.click(
    await screen.findByRole("button", { name: `Ouvrir ${title}` }),
  );
};

describe("decision 084 C: the ticket made from a finding or a rule is linked", () => {
  it("given a finding open, when « En faire un ticket » succeeds, then the screen says « Ticket créé » with « Ouvrir le ticket » to /tickets/:id", async () => {
    stubFindings([finding(1, { title: "Hash faible" })]);
    await openFinding("Hash faible");

    fireEvent.click(
      inPanel().getByRole("button", { name: "En faire un ticket" }),
    );

    const link = await screen.findByRole("link", { name: "Ouvrir le ticket" });
    expect(link.getAttribute("href")).toBe("/tickets/901");
    expect(document.body.textContent).toContain("Ticket créé");
  });

  it("given a finding already in a ticket, when the filter « En ticket » is pressed, then it is listed and its panel links « Ticket #n »", async () => {
    stubFindings([
      finding(2, {
        title: "Déjà en ticket",
        status: "ticketed",
        ticketId: 902,
      }),
      finding(3, { title: "À trancher" }),
    ]);
    renderAt("/projets/5/conception/constats");

    fireEvent.click(await screen.findByRole("button", { name: "En ticket" }));
    fireEvent.click(
      await (await inMain()).findByRole("button", {
        name: "Ouvrir Déjà en ticket",
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Ouvrir À trancher" }),
    ).toBeNull();
    const link = await inPanel().findByRole("link", { name: "Ticket #902" });
    expect(link.getAttribute("href")).toBe("/tickets/902");
  });

  it("given a rule open, when « C'est un bug » succeeds, then the notice links « Ouvrir le ticket » to /tickets/:id", async () => {
    stubReprise([rule(1), rule(2)]);
    renderAt("/projets/5/conception/regles?regle=1");
    await waitFor(() =>
      expect(panel().textContent).toMatch(/Règle \d+ sur \d+/),
    );

    fireEvent.click(inPanel().getByRole("button", { name: "C'est un bug" }));

    const link = await screen.findByRole("link", { name: "Ouvrir le ticket" });
    expect(link.getAttribute("href")).toBe("/tickets/900");
  });
});

describe("decision 084 C: the panel of an object and ?objet=", () => {
  const modules = { modules: [API_MODULE] };

  it("given an object touched by 2 rules, when its panel opens, then « Les règles qui le touchent · 2 » lists them linked like the features screen", async () => {
    stubFeatures([FACTURER], [], modules);
    renderAt("/projets/5/conception?objet=Order");

    const ui = within(
      await screen.findByRole("complementary", { name: "Objet Order" }),
    );

    await ui.findByText("Les règles qui le touchent · 2");
    expect(
      ui
        .getByRole("link", { name: /Une facture garde le prix du jour\./ })
        .getAttribute("href"),
    ).toBe("/projets/5/conception/regles?regle=101");
    expect(
      ui
        .getByRole("link", { name: /Une facture payée ne change plus\./ })
        .getAttribute("href"),
    ).toBe("/projets/5/conception/regles?regle=102");
    expect(ui.queryByText(/Une facture a un numéro unique\./)).toBeNull();
  });

  it("given the features screen, when the chip of an object is clicked, then the panel of that object opens", async () => {
    stubFeatures([FACTURER], [], modules);
    renderAt("/projets/5/conception/fonctionnalites");

    const chip = (
      await (await inMain()).findAllByRole("link", { name: /Order/ })
    ).find((a) => a.getAttribute("href")?.endsWith("?objet=Order"));
    if (!chip) throw new Error("no link to the object Order");
    fireEvent.click(chip);

    expect(
      await screen.findByRole("complementary", { name: "Objet Order" }),
    ).toBeDefined();
  });

  it("given the takeover screen, when the chip of an object of a rule is clicked, then the panel of that object opens", async () => {
    stubReprise(
      [rule(1, { objects: [{ name: "Order", inMap: true }] })],
      modules,
    );
    renderAt("/projets/5/conception/regles?regle=1");
    await waitFor(() =>
      expect(panel().textContent).toMatch(/Règle \d+ sur \d+/),
    );

    fireEvent.click(inPanel().getByRole("link", { name: "Order" }));

    expect(
      await screen.findByRole("complementary", { name: "Objet Order" }),
    ).toBeDefined();
  });
});

describe("decision 084 D: the analysis from Constats and the step ticked", () => {
  it("given Constats, when « Analyser avec Claude » is clicked, then the window opens with Bugs, Sécurité and Architecture ticked and Carte not", async () => {
    stubFindings([finding(1)], { modules: [API_MODULE] });
    renderAt("/projets/5/conception/constats");

    fireEvent.click(
      await (await inMain()).findByRole("button", {
        name: "Analyser avec Claude",
      }),
    );

    const ui = within(await analyseWindow());
    expect(box(ui, "Bugs").checked).toBe(true);
    expect(box(ui, "Sécurité").checked).toBe(true);
    expect(box(ui, "Architecture et stack").checked).toBe(true);
    expect(box(ui, "Carte").checked).toBe(false);
  });

  it("given no finding at all, when Constats opens, then its empty state has « Analyser avec Claude », which opens the window", async () => {
    stubFindings([], { modules: [API_MODULE] });
    renderAt("/projets/5/conception/constats");

    const empty = (
      await (await inMain()).findByText(/Rien à trancher/)
    ).closest("p") as HTMLElement;
    fireEvent.click(
      within(empty.parentElement as HTMLElement).getByRole("button", {
        name: "Analyser avec Claude",
      }),
    );

    expect(await analyseWindow()).toBeDefined();
  });

  it("given an architecture finding on code no rule protects, when « Reprendre la fonctionnalité » is clicked, then the window opens with Règles ticked and Carte not", async () => {
    stubFindings(
      [
        finding(1, {
          title: "Couplage",
          kind: "architecture",
          unprotected: true,
        }),
      ],
      { modules: [API_MODULE] },
    );
    await openFinding("Couplage");

    fireEvent.click(
      await inPanel().findByRole("button", {
        name: "Reprendre la fonctionnalité",
      }),
    );

    const ui = within(await analyseWindow());
    expect(box(ui, "Règles").checked).toBe(true);
    expect(box(ui, "Carte").checked).toBe(false);
  });

  it("given no rule yet, when « Analyser avec Claude » is clicked on the takeover screen, then Règles is ticked and Carte is not", async () => {
    stubReprise([], { modules: [API_MODULE] });
    renderAt("/projets/5/conception/regles");

    fireEvent.click(
      await (await inMain()).findByRole("button", {
        name: "Analyser avec Claude",
      }),
    );

    const ui = within(await analyseWindow());
    expect(box(ui, "Règles").checked).toBe(true);
    expect(box(ui, "Carte").checked).toBe(false);
  });
});
