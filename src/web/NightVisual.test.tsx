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
  morningItem as item,
  local,
  morning,
  type NightOptions,
  story,
  stubNight,
} from "./test-night.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 083 E (and D4): the night, simpler and more visual. Pinned where the decision leaves room:
// - the morning block is the section named « Cette nuit… » at the top of /nuit, before « Au programme »; the home no longer has it;
// - the four boxes are elements whose text is the number then the word (« PR livrées », « Travail », « Critères prouvés », « Échecs »);
// - the stacked bar is a role="img" whose children carry the bg-* classes, one per issue that has stories;
// - an outcome group is named by its text (« PR ouvertes », « En pause : attend ta réponse », « En échec », « Sautées ou non lancées »), the last one in a <details>;
// - a line of a group is the <li> of the link « US 12 · … » (to /us/12), with its hours « 1 h 05 → 1 h 40 »;
// - the frise is a drawing: an aria-hidden element, hidden under md, around the boxes « ✓ US 45 »;
// - the programme: the rank of a row is the first text of its <li>; the progress is a role="progressbar" with aria-valuenow and aria-valuemax.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const block = async () => {
  const found = (
    await screen.findByRole("heading", { name: /Cette nuit/ })
  ).closest("section");
  if (!found) throw new Error("no <section> around « Cette nuit »");
  return within(found);
};
const blockElement = async () =>
  (await screen.findByRole("heading", { name: /Cette nuit/ })).closest(
    "section",
  ) as HTMLElement;
/** The element holding both a number and its word, found by the word. */
const stat = async (label: string) =>
  ((await block()).getByText(label).parentElement as HTMLElement).textContent;
const lineOf = async (storyId: number) =>
  (await block())
    .getByRole("link", { name: new RegExp(`^US ${storyId} ·`) })
    .closest("li") as HTMLElement;
const show = (
  items: ReturnType<typeof item>[],
  summary = {},
  o: NightOptions = {},
) => {
  stubNight({ ...o, home: { ...o.home, night: morning(items, summary) } });
  renderAt("/nuit");
};

describe("E1 and D4: where the morning is", () => {
  it("given a night to read, when /nuit is shown, then the block « Cette nuit » comes before « Au programme »", async () => {
    show([item(1, "pr")]);

    const heading = await screen.findByRole("heading", {
      name: /Cette nuit, Claude a livré 1 PR sur 1/,
    });
    const programme = await screen.findByRole("heading", {
      name: "Au programme",
    });
    expect(
      heading.compareDocumentPosition(programme) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("given a night to read, when the home is shown, then it has no block « Cette nuit » and no « Masquer »", async () => {
    stubNight({
      home: {
        night: morning([item(1, "pr")]),
        forYou: [
          {
            kind: "validate",
            storyId: 3,
            iWant: "valider la chose 3",
            project: { id: 5, name: "octocat/hello" },
          },
        ],
      },
    });
    renderAt("/");

    await screen.findAllByText(/valider la chose 3/);
    expect(
      screen.queryByRole("heading", { name: /Cette nuit, Claude/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Masquer" })).toBeNull();
    expect(screen.queryByText(/Frise de la nuit/)).toBeNull();
  });

  it("given no night to read, when /nuit is shown, then there is no block « Cette nuit »", async () => {
    stubNight({ ready: [story(1)] });
    renderAt("/nuit");

    await screen.findByRole("heading", { name: "Au programme" });
    expect(
      screen.queryByRole("heading", { name: /Cette nuit, Claude/ }),
    ).toBeNull();
  });

  it("given a night to read and no night planned, when /nuit is shown, then the link « Voir ce que Claude a fait cette nuit » is gone", async () => {
    show([item(1, "pr")], {}, { ready: [story(2)] });

    await screen.findByRole("heading", { name: "Au programme" });
    expect(
      screen.queryByRole("link", {
        name: "Voir ce que Claude a fait cette nuit",
      }),
    ).toBeNull();
  });

  it("given the block on /nuit, when « Masquer » is clicked, then the hide of the night is posted", async () => {
    const calls = stubNight({
      home: { night: morning([item(1, "pr")], { id: 7 }) },
    });
    renderAt("/nuit");

    fireEvent.click(await screen.findByRole("button", { name: "Masquer" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/api/nights/7/hide",
        body: undefined,
      }),
    );
  });
});

describe("E2: the night at a glance", () => {
  it("given a night with a question waiting, when /nuit is shown, then the title says the PR count and « 1 question t'attend »", async () => {
    const answer = {
      kind: "answer",
      questionId: 9,
      question: "Quel nom ?",
      suggestedAnswers: null,
      runId: 3,
      storyId: 1,
      iWant: "faire la chose 1",
      project: { id: 5, name: "octocat/hello" },
    };
    show(
      [item(1, "pr"), item(2, "paused")],
      {},
      { home: { forYou: [answer] } },
    );

    expect(
      await screen.findByRole("heading", {
        name: "☾ Cette nuit, Claude a livré 1 PR sur 2",
      }),
    ).toBeTruthy();
    expect((await block()).getByText("1 question t'attend")).toBeTruthy();
  });

  it("given a night, when /nuit is shown, then four boxes give the PR delivered, the work, the criteria proven and the failures", async () => {
    show([item(1, "pr"), item(2, "failed")], {
      delivered: 1,
      total: 2,
      workSeconds: 7800,
      criteriaProven: 21,
      failures: 3,
    });

    expect(await stat("PR livrées")).toContain("1/2");
    expect(await stat("Travail")).toContain("2 h 10");
    expect(await stat("Critères prouvés")).toContain("21");
    expect(await stat("Échecs")).toContain("3");
  });

  it("given a night where nothing ran and nothing failed, when /nuit is shown, then the boxes say 0 min and aucun", async () => {
    show([], { delivered: 0, total: 0, workSeconds: 0, failures: 0 });

    expect(await stat("Travail")).toContain("0 min");
    expect(await stat("Échecs")).toContain("aucun");
  });

  it("given the boxes, when /nuit is shown, then they sit in two columns under sm and four from sm, the number big and the word muted", async () => {
    show([item(1, "pr")]);

    await block();
    const label = (await block()).getByText("PR livrées");
    const grid = label.parentElement?.parentElement as HTMLElement;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("sm:grid-cols-4");
    expect(label.className).toContain("text-muted-foreground");
    expect(label.parentElement?.innerHTML).toContain("text-[22px]");
  });

  it("given 1 PR, 1 paused, 3 failed and 32 skipped, when /nuit is shown, then a stacked bar is named by the count and has one part per issue with its colour", async () => {
    const items = [
      item(1, "pr"),
      item(2, "paused"),
      item(3, "failed"),
      item(4, "ci_failed"),
      item(5, "ci_failed"),
      ...Array.from({ length: 30 }, (_, i) => item(10 + i, "skipped")),
      item(50, "not_started"),
      item(51, "not_started"),
    ];
    show(items);

    const bar = (await block()).getByRole("img", {
      name: "1 PR ouverte, 1 en pause, 3 en échec, 32 sautées ou non lancées",
    });
    for (const color of ["bg-done", "bg-you", "bg-border-strong", "bg-raised"])
      expect(bar.querySelector(`.${color}`)).not.toBeNull();
  });
});

describe("E3: the stories of the night, by outcome", () => {
  const items = [
    item(12, "pr", [local(9, 1, 5), local(9, 1, 40)]),
    item(13, "paused"),
    item(14, "failed"),
    item(15, "ci_failed"),
    item(16, "skipped"),
    item(17, "not_started"),
  ];

  it("given every outcome, when /nuit is shown, then each group has its name and its number, and a line is a link « US n · … » to the story", async () => {
    show(items);

    const text = (await blockElement()).textContent ?? "";
    await block();
    expect(text).toMatch(/PR ouvertes\s*1/);
    expect(text).toMatch(/En pause : attend ta réponse\s*1/);
    expect(text).toMatch(/En échec\s*2/);
    expect(text).toMatch(/Sautées ou non lancées\s*2/);
    const link = (await block()).getByRole("link", {
      name: /^US 12 · faire la chose 12/,
    });
    expect(link.getAttribute("href")).toBe("/us/12");
  });

  it("given a story that ran from 1 h 05 to 1 h 40, when /nuit is shown, then its line says « 1 h 05 → 1 h 40 »", async () => {
    show(items);

    expect((await lineOf(12)).textContent).toContain("1 h 05 → 1 h 40");
    expect((await lineOf(13)).textContent).not.toContain("→");
  });

  it("given a night with only PR and failures, when /nuit is shown, then the empty groups are not shown", async () => {
    show([item(1, "pr"), item(2, "failed")]);

    await block();
    const text = (await blockElement()).textContent ?? "";
    expect(text).toContain("PR ouvertes");
    expect(text).toContain("En échec");
    expect(text).not.toContain("En pause : attend ta réponse");
    expect(text).not.toContain("Sautées ou non lancées");
  });

  it("given the groups, when /nuit is shown, then the last one (sautées ou non lancées) is folded in a <details> and the others are not", async () => {
    show(items);

    await block();
    const details = (await blockElement()).querySelectorAll("details");
    expect(details).toHaveLength(1);
    const folded = details[0] as HTMLDetailsElement;
    expect(folded.open).toBe(false);
    expect(folded.textContent).toContain("Sautées ou non lancées");
    expect(folded.textContent).toContain("US 16");
    expect(folded.textContent).not.toContain("US 12");
  });
});

describe("E4: the frise is a drawing from md", () => {
  it("given a night, when /nuit is shown, then the frise is aria-hidden and hidden under md, and the list « Frise de la nuit » is gone", async () => {
    show([item(45, "pr", [local(8, 22), local(8, 23)])]);

    await block();
    const box = (await block()).getByText("✓ US 45");
    const drawing = box.closest("[aria-hidden='true']") as HTMLElement;
    expect(drawing).not.toBeNull();
    expect(drawing.className).toMatch(
      /max-md:hidden|hidden[^"]*md:(block|grid|flex)/,
    );
    expect(screen.queryByRole("list", { name: "Frise de la nuit" })).toBeNull();
  });
});

describe("E5: the evening, the button first", () => {
  const precedes = (a: HTMLElement, b: HTMLElement) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("given the evening, when /nuit is shown, then « ☾ Lancer la nuit » comes before the lists", async () => {
    stubNight({ ready: [story(1)], toValidate: [story(2)] });
    renderAt("/nuit");

    const launch = await screen.findByRole("button", {
      name: /☾ Lancer la nuit · 1 user story/,
    });
    expect(
      precedes(
        launch,
        await screen.findByRole("heading", { name: "Au programme" }),
      ),
    ).toBe(true);
    expect(
      precedes(
        launch,
        await screen.findByRole("heading", { name: "Pourrait s'ajouter" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["Annuler la nuit", "planned"],
    ["Arrêter la nuit", "running"],
  ])(
    "given a night %s, when /nuit is shown, then « %s » comes before the programme",
    async (name, status) => {
      stubNight({ night: { id: 1, status, items: [story(1)] } });
      renderAt("/nuit");

      const button = await screen.findByRole("button", { name });
      expect(
        precedes(
          button,
          await screen.findByRole("heading", { name: "Au programme" }),
        ),
      ).toBe(true);
    },
  );

  it("given no connected launcher, when /nuit is shown, then the reason links « Réglages » to /reglages/taches-cloud", async () => {
    stubNight({ connected: false, ready: [story(1)] });
    renderAt("/nuit");

    const button = await screen.findByRole("button", {
      name: /☾ Lancer la nuit/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const link = within(screen.getByRole("main")).getByRole("link", {
      name: "Réglages",
    });
    expect(link.getAttribute("href")).toBe("/reglages/taches-cloud");
    expect(screen.getByRole("main").textContent).toContain(
      "Connecte le lanceur dans les Réglages.",
    );
  });
});

describe("E6: the programme", () => {
  const rowOf = async (n: number) =>
    (await screen.findByText(`faire la chose ${n}`)).closest(
      "li",
    ) as HTMLElement;

  it("given the evening, when /nuit is shown, then each row starts with its rank and shows the repo without its owner", async () => {
    stubNight({ ready: [story(1), story(2)] });
    renderAt("/nuit");

    const first = await rowOf(1);
    const second = await rowOf(2);
    expect(first.textContent).toMatch(/^1/);
    expect(second.textContent).toMatch(/^2/);
    expect(first.textContent).toContain("hello");
    expect(first.textContent).not.toContain("octocat/hello");
  });

  it("given the evening, when /nuit is shown, then the buttons ↑ ↓ ✕ are 44 px under md", async () => {
    stubNight({ ready: [story(1), story(2)] });
    renderAt("/nuit");

    const row = await rowOf(1);
    for (const name of ["Monter", "Descendre", "Retirer"])
      expect(within(row).getByRole("button", { name }).className).toMatch(
        /max-md:size-(11|\[44px\])/,
      );
  });

  const running = {
    id: 1,
    status: "running",
    items: [story(1, "pr"), story(2, "failed"), story(3), story(4), story(5)],
  };

  it("given a running night with 2 stories done of 5, when /nuit is shown, then « 2 sur 5 finies » and a progress bar say so", async () => {
    stubNight({ night: running });
    renderAt("/nuit");

    expect(await screen.findByText("2 sur 5 finies")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
  });

  it("given a running night, when /nuit is shown, then the first story without outcome is « En cours », the next ones « À venir » and the others say their outcome", async () => {
    stubNight({ night: running });
    renderAt("/nuit");

    expect((await rowOf(3)).textContent).toContain("En cours");
    expect((await rowOf(4)).textContent).toContain("À venir");
    expect((await rowOf(5)).textContent).toContain("À venir");
    expect((await rowOf(4)).textContent).not.toContain("En cours");
    expect((await rowOf(1)).textContent).toContain("PR ouverte");
    expect((await rowOf(1)).textContent).not.toContain("En cours");
  });

  it("given a planned night or the evening, when /nuit is shown, then there is no progress bar", async () => {
    stubNight({ night: { id: 1, status: "planned", items: [story(1)] } });
    renderAt("/nuit");

    await screen.findByRole("button", { name: "Annuler la nuit" });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("E7: the rules", () => {
  it("given /nuit, when it is shown, then « Les règles de la nuit » is folded in a <details>, closed by default", async () => {
    stubNight({ ready: [story(1)] });
    renderAt("/nuit");

    const heading = await screen.findByText("Les règles de la nuit");
    const details = heading.closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
  });
});
