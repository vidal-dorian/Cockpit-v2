// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { describe, expect, it } from "vitest";
import { parseIssue, renderIssue } from "./issue-render.ts";

// Decision 025 G (slice 5.2): reading an issue body back with the template of `renderIssue`.
// Pinned here (the decision leaves them open):
// - `parseIssue(body: string)` is exported by src/server/issue-render.ts. It returns
//   { asA, iWant, soThat, notesMd, criteria: [{ given, when, then }] }, or null when the body does not follow the template
//   (a part is missing or does not read back, or the body was cut by Cockpit: it holds « (tronqué »).
//   The status line, the dependencies, the footer and the marker are not read (a human may change them freely).
// - `parseIssue(renderIssue(story).body)` gives back the fields of the story, whatever its status:
//   the zero-width space that keeps a mention quiet and the `&lt;!--` that keeps a comment shut are undone.
//   Criteria are one line each (the render turns their newlines into spaces, which cannot be undone).
// - A body without a « ## Notes » section has empty notes.

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

const fieldsOf = ({ asA, iWant, soThat, notesMd, criteria }: Input) => ({
  asA,
  iWant,
  soThat,
  notesMd,
  criteria,
});
const bodyOf = (over: Partial<Input> = {}) => renderIssue(story(over)).body;

describe("criterion G: parseIssue is the inverse of renderIssue", () => {
  it.each([
    ["a story with notes and two criteria", {}],
    ["a story without notes", { notesMd: "" }],
    [
      "a story with many criteria",
      {
        criteria: Array.from({ length: 12 }, (_, i) => ({
          given: `g${i}`,
          when: `w${i}`,
          then: `t${i}`,
        })),
      },
    ],
    [
      "notes of several paragraphs, a list, a title and a code block",
      {
        notesMd:
          "Premier paragraphe.\n\n## Un titre\n\n- un\n- deux\n\n```ts\nconst a = 1;\n```\n\nDernier paragraphe.",
      },
    ],
    [
      "mentions in the narrative, the notes and the criteria (zero-width space)",
      {
        asA: "lectrice, comme @octocat",
        iWant: "prévenir @bob",
        soThat: "que @alice-and-co sache",
        notesMd: "Voir @octocat.\n\nEt aussi (@bob) et a@b.fr",
        criteria: [
          {
            given: "@bob existe",
            when: "il lit @alice",
            then: "@octocat voit",
          },
        ],
      },
    ],
    [
      "a comment opener in the notes and a criterion (escaped)",
      {
        notesMd: "Avant <!-- cache --> après",
        criteria: [{ given: "a <!-- b", when: "c", then: "d" }],
      },
    ],
    [
      "commas and full stops in the narrative",
      {
        asA: "lectrice, attentive et pressée",
        iWant: "relire, vite. Puis relire encore",
        soThat: "corriger les erreurs, toutes",
      },
    ],
    [
      "dependencies (a section that is not read)",
      {
        dependsOn: [
          { id: 3, issueNumber: 12 },
          { id: 4, issueNumber: null },
        ],
      },
    ],
  ] as [string, Partial<Input>][])(
    "given %s, when it is rendered and read back, then the fields are the ones of the story",
    (_name, over) => {
      const input = story(over);

      expect(parseIssue(renderIssue(input).body)).toEqual(fieldsOf(input));
    },
  );

  it.each(["ready", "in_progress", "in_review", "done", "abandoned"] as const)(
    "given a %s story, when it is rendered and read back, then the fields are the same whatever the status line",
    (status) => {
      const input = story({ status });

      expect(parseIssue(renderIssue(input).body)).toEqual(fieldsOf(input));
    },
  );

  it("given a body whose status line, dependencies and footer were changed by hand, when it is read, then the fields are still read", () => {
    const body = bodyOf({ dependsOn: [{ id: 3, issueNumber: 12 }] })
      .replace(/\*\*Statut\*\* : prête/, "**Statut** : n'importe quoi")
      .replace("- Dépend de #12", "- Dépend de rien")
      .replace(/Géré par Cockpit[^\n]*/, "Plus de pied de page");

    expect(parseIssue(body)).toEqual(fieldsOf(story()));
  });
});

describe("criterion G: what a person can change on GitHub is read", () => {
  it("given the narrative sentence was rewritten, when it is read, then the three parts are the new ones", () => {
    const body = bodyOf().replace(
      /^En tant que .*$/m,
      "En tant que cheffe de projet, je veux voir l'avancement, afin de décider vite.",
    );

    expect(parseIssue(body)).toMatchObject({
      asA: "cheffe de projet",
      iWant: "voir l'avancement",
      soThat: "décider vite",
    });
  });

  it("given a criterion was reworded and another one added, when it is read, then the criteria are the new list in order", () => {
    const body = bodyOf()
      .replace("**alors** alors-beta", "**alors** alors-modifié")
      .replace(
        /(- \[ \] \*\*Étant donné\*\* donné-beta[^\n]*)/,
        "$1\n- [ ] **Étant donné** donné-gamma **quand** quand-gamma **alors** alors-gamma",
      );

    expect(parseIssue(body)?.criteria).toEqual([
      { given: "donné-alpha", when: "quand-alpha", then: "alors-alpha" },
      { given: "donné-beta", when: "quand-beta", then: "alors-modifié" },
      { given: "donné-gamma", when: "quand-gamma", then: "alors-gamma" },
    ]);
  });

  it("given a ticked checkbox, when it is read, then the criterion is read all the same", () => {
    const body = bodyOf().replace(
      "- [ ] **Étant donné** donné-alpha",
      "- [x] **Étant donné** donné-alpha",
    );

    expect(parseIssue(body)?.criteria[0]).toEqual({
      given: "donné-alpha",
      when: "quand-alpha",
      then: "alors-alpha",
    });
  });

  it("given the notes were rewritten, when it is read, then notesMd is the new text", () => {
    const body = bodyOf().replace(
      "Une **note** importante",
      "Des notes\n\nsur deux paragraphes",
    );

    expect(parseIssue(body)?.notesMd).toBe("Des notes\n\nsur deux paragraphes");
  });

  it("given notes were added to a body that had none, when it is read, then notesMd is that text", () => {
    const body = bodyOf({ notesMd: "" }).replace(
      "## Critères d'acceptation",
      "## Notes\n\nNotes ajoutées\n\n## Critères d'acceptation",
    );

    expect(parseIssue(body)?.notesMd).toBe("Notes ajoutées");
  });

  it("given the notes section was deleted, when it is read, then the notes are empty", () => {
    const body = bodyOf().replace(/## Notes\n\n[^\n]*\n\n/, "");

    expect(parseIssue(body)?.notesMd).toBe("");
  });
});

describe("criterion G: a body that no longer follows the template is not read", () => {
  it.each([
    ["an empty body", () => ""],
    [
      "a text that has nothing to do with it",
      () => "Bonjour, ceci est un bug.",
    ],
    [
      "the narrative sentence is missing",
      () => bodyOf().replace(/^En tant que .*\n\n/m, ""),
    ],
    [
      "the narrative sentence lost its « afin de »",
      () => bodyOf().replace(", afin de corriger les erreurs", ""),
    ],
    [
      "a part of the narrative is empty",
      () => bodyOf().replace("je veux relire les exports", "je veux "),
    ],
    [
      "the criteria section is missing",
      () => bodyOf().replace(/## Critères d'acceptation\n\n(- [^\n]*\n?)+/, ""),
    ],
    [
      "the criteria section holds no criterion",
      () =>
        bodyOf().replace(/(## Critères d'acceptation\n\n)(- [^\n]*\n?)+/, "$1"),
    ],
    [
      "a criterion line lost its « alors »",
      () => bodyOf().replace("**alors** alors-beta", "**donc** alors-beta"),
    ],
    [
      "a criterion line is cut",
      () =>
        bodyOf().replace(
          "**quand** quand-beta **alors** alors-beta",
          "**quand** quand-beta",
        ),
    ],
    [
      "a part of a criterion is empty",
      () => bodyOf().replace("**quand** quand-alpha", "**quand** "),
    ],
    [
      "a criterion line was turned into something else",
      () =>
        bodyOf().replace(
          "- [ ] **Étant donné** donné-beta",
          "Une phrase libre : donné-beta",
        ),
    ],
  ])("given %s, when it is read, then it is null", (_name, make) => {
    expect(parseIssue(make())).toBeNull();
  });

  it("given a body that Cockpit cut because the notes were too long, when it is read, then it is null even though the rest reads", () => {
    const { body } = renderIssue(story({ notesMd: "n".repeat(70_000) }));
    expect(body).toContain("(tronqué");

    expect(parseIssue(body)).toBeNull();
  });

  it("given a body that Cockpit cut inside the criteria, when it is read, then it is null", () => {
    const criteria = Array.from({ length: 20 }, (_, i) => ({
      given: `g${i}-${"g".repeat(1_900)}`,
      when: `w${i}-${"w".repeat(1_900)}`,
      then: `t${i}-${"t".repeat(1_900)}`,
    }));
    const { body } = renderIssue(story({ criteria }));
    expect(body).toContain("(tronqué");

    expect(parseIssue(body)).toBeNull();
  });
});
