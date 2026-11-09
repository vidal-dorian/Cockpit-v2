// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_MODULE,
  SHA_API,
  stubConception,
  WEB_MODULE,
} from "./test-conception.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R1 (decision 043 I, J, K; the order of the tabs is the one of decision 045 H, which wins over 043 I): the tab « Conception » at /projets/:id/conception.
//
// Pinned where the decisions leave it open (the developer follows these):
// - The server answers GET /api/projects/5/code-map as in src/server/code-map-routes.test.ts: { modules: [{ path, name, kind, commitSha, createdAt, commitsSince, data }] },
//   `data` = { manifest, runtimes, objects, links } with snake_case citations; and GET /api/projects/5/code?sha=&path=&start=&end= answers { firstLine, lines }.
// - The tabs of the project are links in <nav aria-label="Sections du projet">, in the order Kanban, Tickets, Conception, Santé, Agents, Réglages; the open one has aria-current="page".
// - One tab per module: role="tab", in a tablist, its name holding the module's name and its kind code (« Serveur api »); the first (by path) is selected (aria-selected) at first.
// - The runtimes line is « node 20 · hono 4.6 » (name, a space, version; joined by « · »). The header is « Analysé au commit a1b2c3d · 12 commits depuis » (7 characters of the
//   commit; « 1 commit depuis » for one; no « depuis » part when commitsSince is null), with a button « Relancer l'analyse ».
// - The switch is two buttons « Graphe » and « Liste » with aria-pressed; « Graphe » is pressed at first. jsdom cannot lay out React Flow: the graph itself (the eight first fields of a card,
//   then « + 4 champs », the links named with their cardinality, dagre) is NOT tested here; the list is.
// - In the list, an object is a button whose name starts with the object's name, followed by its kind and ALL its fields (« id uuid »); the links are list items
//   holding the two names, the kind code and the cardinality (« Order references User 0..1 »).
// - A click on an object opens the right Panel (aside[data-panel]) with the name, the kind, every field, « Défini dans api/src/db.ts, lignes 18 à 24 » (the path in a <code>),
//   the lines read from the route of H, and a link « Voir sur GitHub » to https://github.com/octocat/hello/blob/<commit>/<path>#L18-L24.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const loaded = (text: string) =>
  waitFor(() => expect(main().textContent).toContain(text));
const open = async (modules = [API_MODULE, WEB_MODULE]) => {
  const api = stubConception({ modules });
  renderAt("/projets/5/conception");
  await loaded("Serveur");
  return api;
};
const showList = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Liste" }));
};

describe("decision 045 H and 043 I: the tab Conception", () => {
  it("given a project, when /projets/5/conception loads, then the tabs are Kanban, Tickets, Conception, Santé, Agents, CI / CD (067 A), Historique (053 I), Réglages in that order, and Conception is the open one", async () => {
    stubConception();
    renderAt("/projets/5/conception");

    const nav = await screen.findByRole("navigation", {
      name: "Sections du projet",
    });
    await waitFor(() =>
      expect(within(nav).getAllByRole("link")).toHaveLength(8),
    );
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent ?? "")).toEqual([
      expect.stringMatching(/^Kanban/),
      expect.stringMatching(/^Tickets/),
      expect.stringMatching(/^Conception/),
      expect.stringMatching(/^Santé/),
      expect.stringMatching(/^Agents/),
      expect.stringMatching(/^CI \/ CD/),
      expect.stringMatching(/^Historique/),
      expect.stringMatching(/^Réglages/),
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/projets/5",
      "/projets/5/tickets",
      "/projets/5/conception",
      "/projets/5/sante",
      "/projets/5/agents",
      "/projets/5/ci",
      "/projets/5/historique",
      "/projets/5/reglages",
    ]);
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("decision 043 K: no map yet", () => {
  it("given a project with no map, when the tab loads, then it says « Pas encore de carte. Claude lit le repo et dessine le modèle de chaque sous-projet. » and offers « Analyser avec Claude » as the main button", async () => {
    stubConception();
    renderAt("/projets/5/conception");

    await loaded(
      "Pas encore de carte. Claude lit le repo et dessine le modèle de chaque sous-projet.",
    );
    expect(
      screen.getByRole("button", { name: "Analyser avec Claude" }),
    ).toBeDefined();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Relancer l'analyse" }),
    ).toBeNull();
  });
});

describe("decision 043 I: one tab per module", () => {
  it("given an API and a web module, when the tab loads, then there is a tab per module with its name and kind, the first selected, and its runtimes line", async () => {
    await open();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.textContent).toContain("Serveur");
    expect(tabs[0]?.textContent).toContain("api");
    expect(tabs[1]?.textContent).toContain("Application");
    expect(tabs[1]?.textContent).toContain("web");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
    expect(main().textContent).toContain("node 20 · hono 4.6");
    expect(main().textContent).not.toContain("react 18.3");
  });

  it("given the first module, when the tab loads, then the header says « Analysé au commit a1b2c3d · 12 commits depuis » and « Relancer l'analyse » is offered", async () => {
    await open();

    expect(main().textContent).toContain(
      "Analysé au commit a1b2c3d · 12 commits depuis",
    );
    expect(
      screen.getByRole("button", { name: "Relancer l'analyse" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Analyser avec Claude" }),
    ).toBeNull();
  });

  it("given two modules at two commits, when the second tab is clicked, then its runtimes and its own commit header are shown", async () => {
    await open();

    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);

    await loaded("node 20 · react 18.3");
    expect(main().textContent).toContain(
      `Analysé au commit ${"b".repeat(7)} · 1 commit depuis`,
    );
    expect(main().textContent).not.toContain("a1b2c3d");
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected")),
    ).toEqual(["false", "true"]);
  });

  it("given a commit GitHub cannot compare (commitsSince null), when the tab loads, then the header names the commit and says nothing of the commits since", async () => {
    await open([{ ...API_MODULE, commitsSince: null }]);

    expect(main().textContent).toContain("Analysé au commit a1b2c3d");
    expect(main().textContent).not.toMatch(/commits? depuis/);
  });
});

describe("decision 043 J: the switch Graphe / Liste and the list", () => {
  it("given a map, when the tab loads, then « Graphe » is pressed and « Liste » is not; a click on « Liste » swaps them", async () => {
    await open();

    const graph = screen.getByRole("button", { name: "Graphe" });
    const list = screen.getByRole("button", { name: "Liste" });
    expect(graph.getAttribute("aria-pressed")).toBe("true");
    expect(list.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(list);

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

  it("given the list view, when it is shown, then each object is a button with its name, its kind and ALL its fields (not only eight), and the links name both ends, the kind and the cardinality", async () => {
    await open();
    await showList();

    const user = await screen.findByRole("button", { name: /^User/ });
    expect(user.textContent).toContain("table");
    expect(user.textContent).toContain("id uuid");
    expect(user.textContent).toContain("email text");
    expect(user.textContent).toContain("col10 text");
    expect(
      screen.getByRole("button", { name: /^Order/ }).textContent,
    ).toContain("total integer");
    expect(
      screen.getByRole("button", { name: /^Invoice/ }).textContent,
    ).toContain("type");
    const items = within(main())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(
      items.some(
        (t) =>
          /Order/.test(t) &&
          /references/.test(t) &&
          /User/.test(t) &&
          /0\.\.1/.test(t),
      ),
    ).toBe(true);
    expect(
      items.some(
        (t) => /Invoice/.test(t) && /contains/.test(t) && /Order/.test(t),
      ),
    ).toBe(true);
  });

  it("given the second module, when the list is shown, then it lists the objects of that module only", async () => {
    await open();
    await showList();

    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);

    expect(
      await screen.findByRole("button", { name: /^Session/ }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /^User/ })).toBeNull();
  });
});

describe("decision 043 I: a click on an object opens its panel", () => {
  it("given the list, when User is clicked, then the right Panel shows its name, every field, where it is defined and the code read from the route of H around the cited lines", async () => {
    const api = await open();
    await showList();

    fireEvent.click(await screen.findByRole("button", { name: /^User/ }));

    await waitFor(() => expect(panel().textContent).toContain("CODE-LINE-15"));
    const text = panel().textContent ?? "";
    expect(text).toContain("User");
    expect(text).toContain("table");
    for (const field of ["id", "email", "col3", "col10"])
      expect(text).toContain(field);
    expect(text).toContain("Défini dans api/src/db.ts, lignes 18 à 24");
    expect(panel().querySelector("code")?.textContent).toBe("api/src/db.ts");
    expect(text).toContain("CODE-LINE-27");
    const read = api.calls.filter((c) => c.path === "/api/projects/5/code");
    expect(read).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(read[0]?.search))).toEqual({
      sha: SHA_API,
      path: "api/src/db.ts",
      start: "18",
      end: "24",
    });
  });

  it("given the panel of User, when it is open, then « Voir sur GitHub » is a link to the file at the commit, on the cited lines", async () => {
    await open();
    await showList();

    fireEvent.click(await screen.findByRole("button", { name: /^User/ }));

    const link = await within(await waitFor(panel)).findByRole("link", {
      name: /Voir sur GitHub/,
    });
    expect(link.getAttribute("href")).toBe(
      `https://github.com/octocat/hello/blob/${SHA_API}/api/src/db.ts#L18-L24`,
    );
  });

  it("given the panel of User, when Order is clicked, then the panel shows Order (its own lines are read), not User", async () => {
    const api = await open();
    await showList();
    fireEvent.click(await screen.findByRole("button", { name: /^User/ }));
    await waitFor(() =>
      expect(panel().textContent).toContain(
        "Défini dans api/src/db.ts, lignes 18 à 24",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Order/ }));

    await waitFor(() => expect(panel().textContent).toContain("lignes 5 à 9"));
    expect(panel().textContent).toContain("total");
    expect(panel().textContent).not.toContain("col10");
    expect(
      api.calls
        .filter((c) => c.path === "/api/projects/5/code")
        .map((c) => new URLSearchParams(c.search).get("start")),
    ).toContain("5");
  });

  it("given the code route failing, when an object is clicked, then the panel still shows its fields, where it is defined and « Voir sur GitHub »", async () => {
    stubConception({
      modules: [API_MODULE],
      code: { status: 502, body: { error: "github_unavailable" } },
    });
    renderAt("/projets/5/conception");
    await loaded("Serveur");
    await showList();

    fireEvent.click(await screen.findByRole("button", { name: /^User/ }));

    await waitFor(() =>
      expect(panel().textContent).toContain(
        "Défini dans api/src/db.ts, lignes 18 à 24",
      ),
    );
    expect(panel().textContent).toContain("col10");
    expect(
      within(panel()).getByRole("link", { name: /Voir sur GitHub/ }),
    ).toBeDefined();
  });
});
