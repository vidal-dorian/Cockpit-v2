// @vitest-environment jsdom
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
import { redClasses, stubJournal } from "./test-journal.tsx";

// Decision 062 F and G (slice 11.5): « Ce qui a été livré », the second chip of the Historique tab (S17).
//
// Pinned choices (the decision leaves them open):
// - The two chips are links (not buttons, not <li>) in <main>, « Journal » to /projets/5/historique and « Ce qui a été livré » to /projets/5/historique/livre;
//   the open one has aria-current="page". « Journal » is the default: /projets/5/historique shows the journal as before (its own chips Tout, Toi… are buttons).
//   On /livre the journal is not shown and GET /api/history is not called.
// - The page reads GET /api/projects/5/changelog, answering the contract of src/server/test-changelog.ts:
//   { groups: [{ kind: "unreleased" | "release" | "day", name, date, entries: [{ number, title, fix, storyId }] }], branches: [{ storyId, branch, prNumber }] }.
// - The state sentence is the h1 « Ce que hello a livré. », the text « Une ligne par PR, écrite à partir de son titre. » is under it. A GET that fails shows « Impossible de lire ce qui a été livré. ».
// - A group is an <h2> followed by its lines: « Pas encore publiée » (kind unreleased), « Version <name> · <date> » (release, date as « 6 novembre »),
//   « Aujourd'hui », « Hier » or « 6 novembre » (day). Groups come in the order of the response.
// - A line is an <li>: an icon (an element whose text is exactly ⇄, or ✕ for a fix, class text-muted-foreground), the title (« Corrigé : <title> » for a fix),
//   the link « PR #51 » to https://github.com/octocat/hello/pull/51 and, when storyId is not null, the link « US 40 » (the story id) to /us/40, written « PR #51 · US 40 » in the text of the line.
// - Empty groups: « Rien de livré pour l'instant. » (and no branches section).
// - Branches: an <h2> « Branches à nettoyer · après le merge », one <li> per branch with its name, « PR #51 mergée · plus utilisée » and the button « Supprimer la branche »
//   (a secondary button: classes of `button` in ui.ts, bg-raised and border-border-strong, no bg-primary, nothing red). The section is absent when branches is empty.
// - The button opens the confirmation in the line: « Supprimer la branche us/40-x ? Rien ne sera perdu : elle est déjà mergée. » with the buttons « Oui, supprimer » and « Annuler » (nothing is sent before « Oui, supprimer »).
//   « Oui, supprimer » sends POST /api/stories/40/branch/delete (no body); 204 makes the line disappear (the section too when it was the last one).
// Review additions: the changelog answers `repo` ("octocat/hello"), the PR links are built from it (so never `undefined` while GET /api/projects is pending); a group of kind "older" is
//   « Versions plus anciennes »; the chips are in <nav aria-label="Vues de l'historique">; no « Supprimer la branche » on an archived project (the line stays); two release groups with the same name both render.
// - A refusal 409 { error } or 502 stays in the line, in a role="alert" element, with these sentences:
//   pr_not_merged « La PR de cette US n'est pas mergée. », branch_gone « La branche n'existe plus sur GitHub. », branch_protected « Cette branche est protégée : elle ne peut pas être supprimée d'ici. »,
//   branch_has_new_commits « La branche a des commits que la PR mergée n'a pas : rien n'est supprimé. », branch_has_open_pr « Une PR ouverte part de cette branche. »,
//   project_archived « Ce projet est archivé. », 502 github_unavailable « GitHub ne répond pas : vérifie sur GitHub si la branche a été supprimée. » (review: the request may have reached GitHub).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Entry = {
  number: number;
  title: string;
  fix: boolean;
  storyId: number | null;
};
type Group = {
  kind: string;
  name: string | null;
  date: string | null;
  entries: Entry[];
};
type Branch = { storyId: number; branch: string; prNumber: number };
type Changelog = { repo: string; groups: Group[]; branches: Branch[] };

const line = (
  number: number,
  title: string,
  over: Partial<Entry> = {},
): Entry => ({ number, title, fix: false, storyId: null, ...over });

const SHIPPED: Changelog = {
  repo: "octocat/hello",
  groups: [
    {
      kind: "unreleased",
      name: null,
      date: null,
      entries: [line(53, "Montre le changelog")],
    },
    {
      kind: "release",
      name: "1.9.0",
      date: "2026-11-06T12:00:00Z",
      entries: [
        line(51, "Supprime les branches mergées", { storyId: 40 }),
        line(50, "Les chips ne perdent plus le focus", { fix: true }),
      ],
    },
  ],
  branches: [{ storyId: 40, branch: "us/40-x", prNumber: 51 }],
};

/** The journal stub of slice 11.1, with the two new routes in front of it. `deleteAnswer` is what the POST answers. */
function stubDelivered(
  answer: () => Response | Changelog = () => SHIPPED,
  deleteAnswer: () => Response = () => new Response(null, { status: 204 }),
  options: { archived?: boolean; projectsGate?: Promise<void> } = {},
) {
  const journal = stubJournal();
  const base = globalThis.fetch;
  const sent: { method: string; path: string; body: unknown }[] = [];
  let deleted = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, "http://localhost");
      if (url.pathname === "/api/projects" && options.projectsGate) {
        await options.projectsGate;
      }
      if (url.pathname === "/api/projects" && options.archived) {
        const res = await base(input, init);
        const body = (await res.json()) as { projects: { id: number }[] };
        return Response.json({
          projects: body.projects.map((p) => ({ ...p, archived: true })),
        });
      }
      if (url.pathname === "/api/projects/5/changelog") {
        const found = answer();
        if (found instanceof Response) return found;
        return Response.json(deleted ? { ...found, branches: [] } : found);
      }
      if (url.pathname === "/api/stories/40/branch/delete") {
        sent.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          body: init?.body ?? null,
        });
        const res = deleteAnswer();
        if (res.status === 204) deleted = true;
        return res;
      }
      return base(input, init);
    }),
  );
  return { sent, journal };
}

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

const main = () => screen.getByRole("main");
const delivered = async () => {
  renderAt("/projets/5/historique/livre");
  await screen.findByRole(
    "heading",
    { level: 1, name: /a livré/ },
    { timeout: 1500 },
  );
};
const heading = (text: string | RegExp) =>
  within(main()).findByRole("heading", { level: 2, name: text });
const lineOf = async (text: string) => {
  const found = await within(main()).findByText(text, { exact: false });
  return found.closest("li") as HTMLElement;
};
const branchLine = async () => lineOf("us/40-x");
const ask = async () => {
  const row = await branchLine();
  fireEvent.click(
    within(row).getByRole("button", { name: "Supprimer la branche" }),
  );
  return row;
};

describe("F: the two chips of the Historique tab", () => {
  it("given /projets/5/historique, when it loads, then the chips Journal (current) and Ce qui a été livré are links, and the journal is shown", async () => {
    stubDelivered();
    renderAt("/projets/5/historique");
    await screen.findByRole("main");

    const journal = await within(main()).findByRole("link", {
      name: "Journal",
    });
    const livre = within(main()).getByRole("link", {
      name: "Ce qui a été livré",
    });

    expect(journal.getAttribute("aria-current")).toBe("page");
    expect(journal.getAttribute("href")).toBe("/projets/5/historique");
    expect(livre.getAttribute("aria-current")).toBeNull();
    expect(livre.getAttribute("href")).toBe("/projets/5/historique/livre");
    expect(
      await within(main()).findByRole("button", { name: "Refus et erreurs" }),
    ).toBeDefined();
  });

  it("given the journal, when « Ce qui a été livré » is clicked, then the address is /projets/5/historique/livre and the changelog shows", async () => {
    stubDelivered();
    renderAt("/projets/5/historique");
    await screen.findByRole("main");

    fireEvent.click(
      await within(main()).findByRole("link", { name: "Ce qui a été livré" }),
    );

    await heading("Pas encore publiée");
    expect(window.location.pathname).toBe("/projets/5/historique/livre");
  });

  it("given /projets/5/historique/livre, when it loads, then « Ce qui a été livré » is the current chip and the journal is neither shown nor read", async () => {
    const { journal } = stubDelivered();
    await delivered();

    const livre = within(main()).getByRole("link", {
      name: "Ce qui a été livré",
    });
    expect(livre.getAttribute("aria-current")).toBe("page");
    expect(
      within(main())
        .getByRole("link", { name: "Journal" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      within(main()).queryByRole("button", { name: "Refus et erreurs" }),
    ).toBeNull();
    expect(journal.requests).toEqual([]);
  });
});

describe("F: the state sentence and the groups", () => {
  it("given the changelog, when it loads, then the sentence reads « Ce que hello a livré. » with « Une ligne par PR, écrite à partir de son titre. »", async () => {
    stubDelivered();
    await delivered();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Ce que hello a livré.",
    );
    expect(
      screen.getByText("Une ligne par PR, écrite à partir de son titre."),
    ).toBeDefined();
  });

  it("given an unreleased group and a release, when it loads, then « Pas encore publiée » comes first, then « Version 1.9.0 · 6 novembre »", async () => {
    stubDelivered();
    await delivered();

    await heading("Pas encore publiée");
    await heading("Version 1.9.0 · 6 novembre");
    const titles = [...main().querySelectorAll("h2")].map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual([
      "Pas encore publiée",
      "Version 1.9.0 · 6 novembre",
    ]);
  });

  it("given day groups, when it loads, then today is « Aujourd'hui », yesterday « Hier » and an older day « 6 novembre »", async () => {
    const day = (ago: number) =>
      new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    stubDelivered(() => ({
      repo: "octocat/hello",
      groups: [
        { kind: "day", name: null, date: day(0), entries: [line(3, "c")] },
        { kind: "day", name: null, date: day(1), entries: [line(2, "b")] },
        {
          kind: "day",
          name: null,
          date: "2026-11-06",
          entries: [line(1, "a")],
        },
      ],
      branches: [],
    }));
    await delivered();

    await heading("6 novembre");
    expect(
      [...main().querySelectorAll("h2")].map((h) => h.textContent),
    ).toEqual(["Aujourd'hui", "Hier", "6 novembre"]);
  });

  it("given a line of a story and a fix, when it loads, then ⇄ and the link PR #51 · US 40 are on the first, ✕ and « Corrigé : … » on the second", async () => {
    stubDelivered();
    await delivered();

    const feature = await lineOf("Supprime les branches mergées");
    expect(within(feature).getByText("⇄")).toBeDefined();
    expect(feature.textContent).toContain("PR #51 · US 40");
    expect(
      within(feature)
        .getByRole("link", { name: "PR #51" })
        .getAttribute("href"),
    ).toBe("https://github.com/octocat/hello/pull/51");
    expect(
      within(feature).getByRole("link", { name: "US 40" }).getAttribute("href"),
    ).toBe("/us/40");

    const fix = await lineOf("Corrigé : Les chips ne perdent plus le focus");
    expect(within(fix).getByText("✕")).toBeDefined();
    expect(within(fix).queryByText("⇄")).toBeNull();
    expect(within(fix).getByRole("link", { name: "PR #50" })).toBeDefined();
    expect(within(fix).queryByRole("link", { name: /^US/ })).toBeNull();
  });

  it("given no merged PR, when it loads, then « Rien de livré pour l'instant. » and no section of branches", async () => {
    stubDelivered(() => ({ repo: "octocat/hello", groups: [], branches: [] }));
    await delivered();

    expect(
      await within(main()).findByText("Rien de livré pour l'instant."),
    ).toBeDefined();
    expect(within(main()).queryByText(/Branches à nettoyer/)).toBeNull();
  });

  it("given GitHub failing (502), when it loads, then « Impossible de lire ce qui a été livré. »", async () => {
    stubDelivered(() =>
      Response.json({ error: "github_unavailable" }, { status: 502 }),
    );
    renderAt("/projets/5/historique/livre");
    await screen.findByRole("main");

    expect(
      await within(main()).findByText("Impossible de lire ce qui a été livré."),
    ).toBeDefined();
  });
});

describe("F: the branches to clean", () => {
  it("given a branch to clean, when it loads, then the section lists us/40-x with « PR #51 mergée · plus utilisée » and the button « Supprimer la branche »", async () => {
    stubDelivered();
    await delivered();

    await heading("Branches à nettoyer · après le merge");
    const row = await branchLine();
    expect(row.textContent).toContain("PR #51 mergée · plus utilisée");
    expect(
      within(row).getByRole("button", { name: "Supprimer la branche" }),
    ).toBeDefined();
  });

  it("given no branch to clean, when it loads, then the section is absent", async () => {
    stubDelivered(() => ({ ...SHIPPED, branches: [] }));
    await delivered();

    await heading("Pas encore publiée");
    expect(within(main()).queryByText(/Branches à nettoyer/)).toBeNull();
  });

  it("given the button clicked, when the line asks, then the confirmation names the branch, nothing is sent, and « Annuler » closes it", async () => {
    const { sent } = stubDelivered();
    await delivered();

    const row = await ask();

    expect(row.textContent).toContain(
      "Supprimer la branche us/40-x ? Rien ne sera perdu : elle est déjà mergée.",
    );
    expect(sent).toEqual([]);
    fireEvent.click(within(row).getByRole("button", { name: "Annuler" }));
    expect(
      within(row).getByRole("button", { name: "Supprimer la branche" }),
    ).toBeDefined();
    expect(sent).toEqual([]);
  });

  it("given the confirmation, when « Oui, supprimer » is clicked, then POST /api/stories/40/branch/delete and the line and the section disappear", async () => {
    const { sent } = stubDelivered();
    await delivered();
    const row = await ask();

    fireEvent.click(
      within(row).getByRole("button", { name: "Oui, supprimer" }),
    );

    await waitFor(() =>
      expect(within(main()).queryByText(/us\/40-x/)).toBeNull(),
    );
    expect(sent).toEqual([
      { method: "POST", path: "/api/stories/40/branch/delete", body: null },
    ]);
    expect(within(main()).queryByText(/Branches à nettoyer/)).toBeNull();
  });

  it.each([
    [409, "pr_not_merged", "La PR de cette US n'est pas mergée."],
    [409, "branch_gone", "La branche n'existe plus sur GitHub."],
    [
      409,
      "branch_protected",
      "Cette branche est protégée : elle ne peut pas être supprimée d'ici.",
    ],
    [
      409,
      "branch_has_new_commits",
      "La branche a des commits que la PR mergée n'a pas : rien n'est supprimé.",
    ],
    [409, "branch_has_open_pr", "Une PR ouverte part de cette branche."],
    [409, "project_archived", "Ce projet est archivé."],
    [
      502,
      "github_unavailable",
      // Review: the request may have reached GitHub before it failed.
      "GitHub ne répond pas : vérifie sur GitHub si la branche a été supprimée.",
    ],
  ])(
    "given the server refusing with %s %s, when the deletion is confirmed, then the line stays and says « %s »",
    async (status, code, sentence) => {
      stubDelivered(
        () => SHIPPED,
        () => Response.json({ error: code }, { status }),
      );
      await delivered();
      const row = await ask();

      fireEvent.click(
        within(row).getByRole("button", { name: "Oui, supprimer" }),
      );

      const alert = await within(row).findByRole("alert");
      expect(alert.textContent).toContain(sentence);
      expect(row.textContent).toContain("us/40-x");
    },
  );
});

describe("G: no red on the changelog", () => {
  it("given the changelog with a fix and a branch, when it is shown and the deletion asked, then nothing is red, the icons are grey and the button is a secondary one", async () => {
    stubDelivered();
    await delivered();
    const feature = await lineOf("Supprime les branches mergées");
    const fix = await lineOf("Corrigé : Les chips ne perdent plus le focus");

    for (const icon of [
      within(feature).getByText("⇄"),
      within(fix).getByText("✕"),
    ])
      expect(icon.className).toContain("text-muted-foreground");
    const row = await branchLine();
    const button = within(row).getByRole("button", {
      name: "Supprimer la branche",
    });
    expect(button.className).toContain("bg-raised");
    expect(button.className).toContain("border-border-strong");
    expect(button.className).not.toContain("bg-primary");
    fireEvent.click(button);
    fireEvent.click(
      within(row).getByRole("button", { name: "Oui, supprimer" }),
    );

    expect(redClasses(main())).toEqual([]);
  });
});

describe("review: more cases of the changelog page", () => {
  it("given the chips, when /historique and /historique/livre load, then both are in a navigation « Vues de l'historique »", async () => {
    stubDelivered();
    for (const path of [
      "/projets/5/historique",
      "/projets/5/historique/livre",
    ]) {
      renderAt(path);
      await screen.findByRole("main");
      const nav = await within(main()).findByRole("navigation", {
        name: "Vues de l'historique",
      });
      expect(
        within(nav)
          .getAllByRole("link")
          .map((l) => l.textContent),
      ).toEqual(["Journal", "Ce qui a été livré"]);
      cleanup();
    }
  });

  it("given an archived project, when the changelog loads, then the branch is listed without the button « Supprimer la branche »", async () => {
    stubDelivered(() => SHIPPED, undefined, { archived: true });
    await delivered();

    const row = await branchLine();
    expect(row.textContent).toContain("PR #51 mergée · plus utilisée");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("given the projects still loading, when the lines show, then the PR links come from the repo of the changelog and none contains undefined", async () => {
    let open!: () => void;
    const projectsGate = new Promise<void>((r) => {
      open = r;
    });
    stubDelivered(() => SHIPPED, undefined, { projectsGate });
    renderAt("/projets/5/historique/livre");
    await screen.findByRole("main", {}, { timeout: 1500 });

    const feature = await lineOf("Supprime les branches mergées");
    try {
      expect(
        within(feature)
          .getByRole("link", { name: "PR #51" })
          .getAttribute("href"),
      ).toBe("https://github.com/octocat/hello/pull/51");
      for (const a of main().querySelectorAll("a"))
        expect(a.getAttribute("href")).not.toContain("undefined");
    } finally {
      open();
    }
  });

  it("given a group of kind older, when it loads, then its heading is « Versions plus anciennes », after the releases", async () => {
    stubDelivered(() => ({
      ...SHIPPED,
      groups: [
        ...SHIPPED.groups,
        {
          kind: "older",
          name: null,
          date: null,
          entries: [line(1, "Très ancien")],
        },
      ],
    }));
    await delivered();

    await heading("Versions plus anciennes");
    expect(
      [...main().querySelectorAll("h2")].map((h) => h.textContent).slice(0, 3),
    ).toEqual([
      "Pas encore publiée",
      "Version 1.9.0 · 6 novembre",
      "Versions plus anciennes",
    ]);
  });

  it("given two releases with the same name, when it loads, then both groups render and React complains of no duplicate key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const same = (n: number): Group => ({
      kind: "release",
      name: "1.9.0",
      date: "2026-11-06T12:00:00Z",
      entries: [line(n, `Titre ${n}`)],
    });
    stubDelivered(() => ({
      repo: "octocat/hello",
      groups: [same(2), same(1)],
      branches: [],
    }));
    await delivered();

    await within(main()).findByText("Titre 1");
    expect(
      [...main().querySelectorAll("h2")].map((h) => h.textContent),
    ).toEqual(["Version 1.9.0 · 6 novembre", "Version 1.9.0 · 6 novembre"]);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    error.mockRestore();
  });
});
