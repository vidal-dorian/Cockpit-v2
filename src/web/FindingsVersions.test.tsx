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
import { type FakeRuntime, runtime } from "./test-conception.tsx";
import { type FakeFinding, finding, stubFindings } from "./test-findings.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R6 (decision 052 J; screen S44): the end of life of the runtimes on the screen of the findings. The server answers GET /api/projects/5/versions as pinned in
// src/server/versions.test.ts (and src/web/test-conception.tsx: `runtime(name, version, state, eolFrom)`, the module Serveur, the line api/package.json:2 at the commit of the map).
//
// Pinned where the decision leaves it open (the developer follows these):
// - A runtime whose state is `eol` or `soon` is a row of the list « Les autres constats », after the findings, in the order the server gave them (never sorted among them); `ok` and `unknown`
//   runtimes are not shown. One row per runtime of the answer. The section « Les autres constats » exists as soon as there is such a row, even with no finding.
// - The row is a button « Ouvrir <title> », the title being « <nom> <version> n'est plus maintenu » (eol) or « <nom> <version> ne sera plus maintenu en <mois année> » (soon, the month in full:
//   « avril 2027 »). Under the title: « version · fin de vie depuis nov. 2022 · endoflife.date » (eol) or « version · fin de vie en avr. 2027 · endoflife.date » (soon), the month abbreviated as
//   Intl does in French. At the right, the severity as a word: « haute » for eol, « moyenne » for soon.
// - It is not a finding: it is not counted in the sentence of the h1 nor in « Constats · N », it is never the first card, it has no element with a class containing « you- » (the red) and the
//   page has no red when nothing else is to decide. It shows under « Tous » and « Versions », and under no other filter.
// - Its panel (aside[data-panel]) has the title as first heading, the runtime (« node 18 »), the sub-project (the name of the module, « Serveur »), the end of life date in full (« 30 avril 2025 »,
//   « Fin de vie »), the line of the manifest as CodeView (read at the commit of the map: sha, path, start, end), « Fermer » and the button « Demander un plan à Claude » which opens the window
//   « Analyser avec Claude » (aside named so) with the box « Versions » checked. No decision button (it is no finding), no field of reason.
// - The versions are read once the screen opens; if the read fails (502) the rows are simply absent and the findings are shown as before.

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
const main = () => screen.getByRole("main");
const inPanel = () => within(panel());
const NODE18 = runtime("node", "18", "eol", "2025-04-30");
const PHP74 = runtime("php", "7.4", "eol", "2022-11-28");
const NODE20 = runtime("node", "20", "soon", "2027-04-30");
const OK = runtime("hono", "4.6", "ok", null);
const UNKNOWN = runtime("react", "18.3", "unknown", null);
const open = async (list: FakeFinding[], versions: FakeRuntime[] | "fail") => {
  const api = stubFindings(list, { versions });
  renderAt(PATH);
  await screen.findByRole("link", { name: /^Constats · \d+$/ });
  return api;
};
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";
const filter = (name: string) =>
  within(screen.getByRole("group", { name: GROUP })).getByRole("button", {
    name,
  });
const others = () =>
  screen.getByText("Les autres constats").closest("section") as HTMLElement;
const rowOf = async (title: string) =>
  (
    await within(main()).findByRole("button", { name: `Ouvrir ${title}` })
  ).closest("li") as HTMLElement;
const shown = (title: string) =>
  within(main()).queryByRole("button", { name: `Ouvrir ${title}` }) !== null;

describe("decision 052 J: the rows of the end of life", () => {
  it("given a runtime in end of life since 2025, when the screen opens, then the row says « node 18 n'est plus maintenu », the subtitle with the date and the source, and « haute »", async () => {
    await open([finding(1)], [NODE18]);

    const row = await rowOf("node 18 n'est plus maintenu");

    expect(row.textContent).toContain(
      "version · fin de vie depuis avr. 2025 · endoflife.date",
    );
    expect(row.textContent).toContain("haute");
  });

  it("given php 7.4 in end of life since November 2022, when the screen opens, then the subtitle says « fin de vie depuis nov. 2022 »", async () => {
    await open([finding(1)], [PHP74]);

    const row = await rowOf("php 7.4 n'est plus maintenu");

    expect(row.textContent).toContain(
      "version · fin de vie depuis nov. 2022 · endoflife.date",
    );
  });

  it("given a runtime that will end in April 2027, when the screen opens, then the title says « ne sera plus maintenu en avril 2027 », the subtitle « fin de vie en avr. 2027 » and « moyenne »", async () => {
    await open([finding(1)], [NODE20]);

    const row = await rowOf("node 20 ne sera plus maintenu en avril 2027");

    expect(row.textContent).toContain(
      "version · fin de vie en avr. 2027 · endoflife.date",
    );
    expect(row.textContent).toContain("moyenne");
  });

  it("given runtimes ok and unknown next to one in end of life, when the screen opens, then only the last one has a row", async () => {
    await open([finding(1)], [OK, UNKNOWN, NODE18]);

    await rowOf("node 18 n'est plus maintenu");
    expect(shown("hono 4.6 n'est plus maintenu")).toBe(false);
    expect(screen.queryByText(/react 18\.3/)).toBeNull();
    expect(screen.queryByText(/hono 4\.6/)).toBeNull();
  });

  it("given findings and two runtimes, when the list is read, then the rows come after the findings, in the order of the server, whatever their severity", async () => {
    await open(
      [
        finding(1, { severity: "low", title: "Un petit bug" }),
        finding(2, { severity: "critical" }),
      ],
      [NODE20, NODE18],
    );
    await rowOf("node 18 n'est plus maintenu");

    const order = within(others())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(order).toHaveLength(3);
    expect(order[0]).toContain("Un petit bug");
    expect(order[1]).toContain("node 20 ne sera plus maintenu");
    expect(order[2]).toContain("node 18 n'est plus maintenu");
  });

  it("given a runtime in end of life and no finding, when the screen opens, then the row is shown without a first card, the sentence counts no finding and there is no red", async () => {
    await open([], [NODE18]);

    await rowOf("node 18 n'est plus maintenu");
    expect(screen.queryByText("1 · À corriger d'abord")).toBeNull();
    expect(h1()).toContain("Aucun constat à trancher sur hello.");
    expect(
      within(main()).getByRole("link", { name: "Constats · 0" }),
    ).toBeDefined();
    expect(main().querySelectorAll('[class*="you-"]').length).toBe(0);
  });

  it("given one finding and a runtime in end of life, when the screen opens, then the sentence and the chip count the finding only, and the first card is the finding", async () => {
    await open([finding(1, { severity: "low" })], [NODE18, NODE20]);
    await rowOf("node 18 n'est plus maintenu");

    expect(h1()).toContain("1 constat sur hello.");
    expect(
      within(main()).getByRole("link", { name: "Constats · 1" }),
    ).toBeDefined();
    const card = screen
      .getByText("1 · À corriger d'abord")
      .closest("section") as HTMLElement;
    expect(card.textContent).toContain("Constat numéro 1");
    expect(card.textContent).not.toContain("node 18");
    expect(others().querySelectorAll('[class*="you-"]').length).toBe(0);
  });

  it("given a runtime in end of life, when the filter « Versions » is clicked, then the row is shown and the findings are not; under « Tous » both are", async () => {
    await open([finding(1)], [NODE18]);
    await rowOf("node 18 n'est plus maintenu");

    fireEvent.click(filter("Versions"));
    expect(shown("node 18 n'est plus maintenu")).toBe(true);
    expect(shown("Constat numéro 1")).toBe(false);

    fireEvent.click(filter("Tous"));
    expect(shown("node 18 n'est plus maintenu")).toBe(true);
    expect(shown("Constat numéro 1")).toBe(true);
  });

  it.each(["Bugs", "Failles", "Architecture", "Stack", "Rejetés"])(
    "given a runtime in end of life, when the filter %s is clicked, then the row is not shown",
    async (name) => {
      await open([finding(1)], [NODE18]);
      await rowOf("node 18 n'est plus maintenu");

      fireEvent.click(filter(name));

      expect(shown("node 18 n'est plus maintenu")).toBe(false);
    },
  );

  it("given the read of the versions failing, when the screen opens, then the findings are shown as before and no row of end of life", async () => {
    const api = await open([finding(1)], "fail");

    await waitFor(() =>
      expect(api.paths()).toContain("GET /api/projects/5/versions"),
    );
    expect(shown("Constat numéro 1")).toBe(true);
    expect(screen.queryByText(/n'est plus maintenu/)).toBeNull();
  });
});

describe("decision 052 J: the panel of a runtime in end of life", () => {
  it("given a row, when it is clicked, then the panel gives the title, the runtime, the sub-project, the date, the line of the manifest and the button « Demander un plan à Claude », and no decision", async () => {
    const api = await open([finding(1)], [NODE18]);
    const row = await rowOf("node 18 n'est plus maintenu");

    fireEvent.click(within(row).getByRole("button"));

    expect(inPanel().getAllByRole("heading")[0]?.textContent).toBe(
      "node 18 n'est plus maintenu",
    );
    const text = panel().textContent ?? "";
    expect(text).toContain("node 18");
    expect(text).toContain("Serveur");
    expect(text).toContain("Fin de vie");
    expect(text).toContain("30 avril 2025");
    await waitFor(() => expect(api.codeReads().length).toBeGreaterThan(0));
    expect(
      Object.fromEntries(new URLSearchParams(api.codeReads()[0]?.search)),
    ).toEqual({
      sha: "a1b2c3d".padEnd(40, "0"),
      path: "api/package.json",
      start: "2",
      end: "2",
    });
    await waitFor(() =>
      expect(panel().textContent).toContain("api/package.json"),
    );
    expect(panel().textContent).toContain("ligne 2");
    expect(
      inPanel().getByRole("button", { name: "Demander un plan à Claude" }),
    ).toBeDefined();
    expect(inPanel().getByRole("button", { name: "Fermer" })).toBeDefined();
    for (const name of ["En faire un ticket", "Rejeter", "Plus tard"])
      expect(inPanel().queryByRole("button", { name }), name).toBeNull();
    expect(inPanel().queryByText(/Raison du rejet/)).toBeNull();
  });

  it("given a runtime that will end, when its panel is open, then it says the date to come", async () => {
    await open([], [NODE20]);
    const row = await rowOf("node 20 ne sera plus maintenu en avril 2027");

    fireEvent.click(within(row).getByRole("button"));

    expect(panel().textContent).toContain("30 avril 2027");
  });

  it("given the panel of a runtime, when « Demander un plan à Claude » is clicked, then the window « Analyser avec Claude » opens with the box « Versions » checked", async () => {
    window.localStorage.setItem("cockpit.clone.5", "/home/dorian/code/hello");
    await open([], [NODE18]);
    const row = await rowOf("node 18 n'est plus maintenu");
    fireEvent.click(within(row).getByRole("button"));

    fireEvent.click(
      inPanel().getByRole("button", { name: "Demander un plan à Claude" }),
    );

    const window_ = await screen.findByRole("complementary", {
      name: "Analyser avec Claude",
    });
    expect(
      (
        within(window_).getByRole("checkbox", {
          name: "Versions",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
});
