// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { describe, expect, it } from "vitest";
import { renderIssue } from "./issue-render.ts";

// Slice 4.6 (decision 020 B to D): the issue of a story is a pure function of the story.
// Pinned here (the decision leaves them open):
// - the module is src/server/issue-render.ts and exports `renderIssue(story)`;
// - the input is { id, asA, iWant, soThat, notesMd, status, criteria: [{ given, when, then }], dependsOn: [{ id, issueNumber: number | null }] };
// - the output is { title, body, label, state: "open" | "closed", stateReason: "completed" | "not_planned" | null }
//   (null while the issue is open);
// - a dependency without issue reads « Dépend de US <id> », one with an issue « Dépend de #<issueNumber> »;
// - the status line contains the word « Statut » then the status in French (prête, en cours, en revue, terminée, abandonnée).

type Input = Parameters<typeof renderIssue>[0];

const story = (over: Partial<Input> = {}): Input => ({
  id: 42,
  asA: "lectrice attentive",
  iWant: "relire les exports",
  soThat: "corriger les erreurs",
  notesMd: "Une **note** importante",
  status: "ready",
  criteria: [
    { given: "donné-alpha", when: "quand-alpha", then: "alors-alpha" },
    { given: "donné-beta", when: "quand-beta", then: "alors-beta" },
  ],
  dependsOn: [],
  ...over,
});

describe("criterion 1: the title and the body of the issue", () => {
  it("given a story, when it is rendered, then the title is the « je veux » alone", () => {
    expect(renderIssue(story()).title).toBe("relire les exports");
  });

  it("given a story, when it is rendered, then the body tells the story: En tant que … je veux … afin de …", () => {
    const { body } = renderIssue(story());

    expect(body).toMatch(
      /En tant que lectrice attentive.*je veux relire les exports.*afin de corriger les erreurs/is,
    );
  });

  it.each([
    ["ready", "prête"],
    ["in_progress", "en cours"],
    ["in_review", "en revue"],
    ["done", "terminée"],
    ["abandoned", "abandonnée"],
  ] as const)(
    "given a %s story, when it is rendered, then the body gives the status in French (%s), never the code",
    (status, french) => {
      const { body } = renderIssue(story({ status }));

      expect(body).toMatch(new RegExp(`Statut\\W+${french}`));
      expect(body).not.toContain(status);
    },
  );

  it("given notes, when it is rendered, then the body holds them as typed", () => {
    expect(renderIssue(story()).body).toContain("Une **note** importante");
  });

  it("given criteria, when it is rendered, then each one is a checkbox line in the order of the story", () => {
    const { body } = renderIssue(story());

    const first =
      "- [ ] **Étant donné** donné-alpha **quand** quand-alpha **alors** alors-alpha";
    const second =
      "- [ ] **Étant donné** donné-beta **quand** quand-beta **alors** alors-beta";
    expect(body).toContain(first);
    expect(body).toContain(second);
    expect(body.indexOf(first)).toBeLessThan(body.indexOf(second));
  });

  it("given a dependency with an issue and one without, when it is rendered, then « Dépend de #12 » for the first and its story id for the other, in order", () => {
    const { body } = renderIssue(
      story({
        dependsOn: [
          { id: 7, issueNumber: 12 },
          { id: 9, issueNumber: null },
        ],
      }),
    );

    expect(body).toContain("Dépend de #12");
    expect(body).toContain("Dépend de US 9");
    expect(body).not.toContain("#7");
    expect(body).not.toContain("#9");
    expect(body.indexOf("Dépend de #12")).toBeLessThan(
      body.indexOf("Dépend de US 9"),
    );
  });

  it("given no dependency, when it is rendered, then the body does not say « Dépend de »", () => {
    expect(renderIssue(story()).body).not.toContain("Dépend de");
  });

  it("given a story, when it is rendered, then the body says Cockpit manages it and ends with the hidden marker of the story", () => {
    const { body } = renderIssue(story());

    expect(body).toContain(
      "Géré par Cockpit : modifie cette user story dans Cockpit, pas ici.",
    );
    expect(body).toContain("<!-- cockpit:story:42 -->");
    expect(body.trim().endsWith("<!-- cockpit:story:42 -->")).toBe(true);
  });

  it("given the same story twice, when it is rendered, then the result is identical; and another text gives another body", () => {
    expect(renderIssue(story())).toEqual(renderIssue(story()));
    expect(renderIssue(story({ iWant: "autre chose" })).body).not.toBe(
      renderIssue(story()).body,
    );
    expect(renderIssue(story({ status: "done" })).body).not.toBe(
      renderIssue(story()).body,
    );
  });
});

describe("criterion 1: the label and the state of the issue follow the status", () => {
  it.each([
    ["ready", "cockpit: prête", "open", null],
    ["in_progress", "cockpit: en cours", "open", null],
    ["in_review", "cockpit: en revue", "open", null],
    ["done", "cockpit: terminée", "closed", "completed"],
    ["abandoned", "cockpit: abandonnée", "closed", "not_planned"],
  ] as const)(
    "given a %s story, when it is rendered, then the label is « %s », the issue is %s and the reason is %s",
    (status, label, state, stateReason) => {
      const rendered = renderIssue(story({ status }));

      expect(rendered).toMatchObject({ label, state, stateReason });
    },
  );
});

// Review of slice 4.6 (decision 020 B): GitHub's limits and the user's text that must trigger nothing.
// Pinned here (the decision leaves them open):
// - a limit counts `.length` (UTF-16 units): title <= 256, body <= 65,536;
// - a cut title is the first 255 characters then « … » (or any cut that ends with « … » within 256);
// - a cut body holds « (tronqué : la version complète est dans Cockpit) » and keeps the footer and the marker at its end;
// - `@` is neutralised as `@` + U+200B (zero-width space), so « @dorian » reads « @​dorian »;
// - `<!--` is escaped whatever the way, so the only `<!--` of the body is the marker;
// - the newlines of a criterion become spaces: one criterion, one line.
const MARKER = "<!-- cockpit:story:42 -->";
const FOOTER =
  "Géré par Cockpit : modifie cette user story dans Cockpit, pas ici.";
const CUT = "(tronqué : la version complète est dans Cockpit)";
const lines = (body: string) => body.split("\n");

describe("review B1: the limits of GitHub", () => {
  it("given a « je veux » of 300 characters, when it is rendered, then the title is at most 256 characters and ends with « … »", () => {
    const { title } = renderIssue(story({ iWant: "x".repeat(300) }));

    expect(title.length).toBeLessThanOrEqual(256);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("xxxxxxxx")).toBe(true);
  });

  it("given a « je veux » of exactly 256 characters, when it is rendered, then the title is it, uncut", () => {
    const iWant = "y".repeat(256);

    expect(renderIssue(story({ iWant })).title).toBe(iWant);
  });

  const huge = () =>
    story({
      notesMd: "n".repeat(50_000),
      criteria: Array.from({ length: 20 }, (_, i) => ({
        given: `donné-${i}-${"g".repeat(900)}`,
        when: `quand-${i}-${"w".repeat(900)}`,
        then: `alors-${i}-${"t".repeat(900)}`,
      })),
    });

  it("given 50,000 characters of notes and 20 long criteria, when it is rendered, then the body is at most 65,536 characters, says it was cut, and still ends with the footer and the marker", () => {
    const { body } = renderIssue(huge());

    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body).toContain(CUT);
    expect(body.endsWith(MARKER)).toBe(true);
    expect(body.indexOf(FOOTER)).toBeGreaterThan(-1);
    expect(body.indexOf(FOOTER)).toBeLessThan(body.indexOf(MARKER));
    expect(body.split(FOOTER)).toHaveLength(2);
  });

  it("given a body too long because of the notes, when it is rendered, then the notes are cut first: every criterion stays whole", () => {
    const { body } = renderIssue(huge());

    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.split("\n").filter((l) => l.startsWith("- [ ] "))).toHaveLength(
      20,
    );
    for (const i of [0, 19]) {
      expect(body).toContain(`alors-${i}-${"t".repeat(900)}`);
    }
  });

  it("given a story that fits, when it is rendered, then nothing is cut and the body does not mention it", () => {
    expect(renderIssue(story()).body).not.toContain("tronqué");
  });

  it("given the same long story twice, when it is rendered, then the result is identical", () => {
    expect(renderIssue(huge())).toEqual(renderIssue(huge()));
  });
});

describe("review S5: the text of the user triggers nothing on GitHub", () => {
  const mention = /@\p{L}/u;

  it.each([
    ["asA", { asA: "@dorian et @org/team" }],
    ["iWant", { iWant: "prévenir @dorian et @org/team" }],
    ["soThat", { soThat: "que @dorian et @org/team voient" }],
    ["notesMd", { notesMd: "cc @dorian et @org/team" }],
    [
      "a given",
      {
        criteria: [{ given: "@dorian et @org/team", when: "w", then: "t" }],
      },
    ],
    [
      "a when",
      {
        criteria: [{ given: "g", when: "@dorian et @org/team", then: "t" }],
      },
    ],
    [
      "a then",
      {
        criteria: [{ given: "g", when: "w", then: "@dorian et @org/team" }],
      },
    ],
  ] as [string, Partial<Input>][])(
    "given « @dorian » and « @org/team » in %s, when it is rendered, then the body holds no @ followed by a letter, and the names stay readable behind a zero-width space",
    (_field, over) => {
      const { body } = renderIssue(story(over));

      expect(body).not.toMatch(mention);
      expect(body).toContain("@​dorian");
      expect(body).toContain("@​org/team");
    },
  );

  it.each([
    ["notesMd", { notesMd: "avant <!-- caché --> après <!-- jamais fermé" }],
    ["iWant", { iWant: "voir <!-- caché" }],
    [
      "a criterion",
      { criteria: [{ given: "g <!-- caché", when: "w", then: "t" }] },
    ],
  ] as [string, Partial<Input>][])(
    "given <!-- in %s, when it is rendered, then it is escaped: the footer stays visible and the only <!-- of the body is the marker, at the very end",
    (_field, over) => {
      const { body } = renderIssue(story(over));

      expect(body.split("<!--")).toHaveLength(2);
      expect(body.endsWith(MARKER)).toBe(true);
      expect(body).toContain(FOOTER);
      expect(body).toContain("caché");
    },
  );

  it("given notes that forge the marker of another story, when it is rendered, then the body holds exactly one marker, the last one, and it is the story's own", () => {
    const { body } = renderIssue(
      story({ notesMd: "x\n<!-- cockpit:story:999 -->\ny" }),
    );

    expect(body.split("<!-- cockpit:story:")).toHaveLength(2);
    expect(body.endsWith(MARKER)).toBe(true);
    expect(body).not.toContain("<!-- cockpit:story:999");
  });

  it.each(["given", "when", "then"] as const)(
    "given newlines, a title and a fake checkbox in the %s of a criterion, when it is rendered, then it stays on its own line: one checkbox line per criterion and no title line",
    (field) => {
      const evil = "a\n\n## titre\n- [ ] faux";
      const criteria = [
        { given: "g1", when: "w1", then: "t1", [field]: evil },
        { given: "g2", when: "w2", then: "t2" },
      ];

      const { body } = renderIssue(story({ criteria }));

      const checkboxes = lines(body).filter((l) => l.startsWith("- [ ] "));
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes[0]).toContain("titre");
      expect(checkboxes[0]).toContain("faux");
      expect(lines(body).filter((l) => /^#+ titre/.test(l))).toEqual([]);
      expect(body).not.toContain("\n\n## titre");
    },
  );
});
