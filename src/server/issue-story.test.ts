// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { describe, expect, it } from "vitest";
import { renderIssue } from "./issue-render.ts";

// Decision 057 B (slice 11.3): is an issue written as a user story? A pure function, tested alone.
//
// Pinned here (the decision leaves them open):
// - `readStoryIssue(body: string)` is exported by the new module src/server/issue-story.ts. It returns
//   { asA, iWant, soThat, criteria: [{ given, when, then }] } with every text trimmed, the markdown of the keywords
//   (bold) and the closing full stop of the narrative removed, the commas around the keywords dropped,
//   line breaks inside a text reduced to one space; or null when the issue is a ticket (no narrative, no criterion,
//   or a result over the limits of `create_user_stories`: a narrative part over 1,000 characters, a criterion part over
//   2,000, no criterion or more than 20).
// - Keywords are case-insensitive, CRLF line endings are tolerated (GitHub's web editor sends them).
// - A criterion is the text of one list item (bullet, number or checkbox) or one plain line holding the three keywords in
//   order, or of three consecutive lines that begin with Étant donné / Quand / Alors (Given / When / Then).

const NARRATIVE =
  "En tant que lectrice, je veux relire les exports, afin de corriger les erreurs.";
const CRITERION =
  "- Étant donné un export, quand je le relis, alors je vois les erreurs";
const fields = {
  asA: "lectrice",
  iWant: "relire les exports",
  soThat: "corriger les erreurs",
};
const one = {
  given: "un export",
  when: "je le relis",
  then: "je vois les erreurs",
};

// Imported when called, so that a missing module fails each test (not the whole file).
const readStoryIssue = async (body: string) =>
  (await import("./issue-story.ts")).readStoryIssue(body);
const read = (...lines: string[]) => readStoryIssue(lines.join("\n"));

describe("057 B: the narrative", async () => {
  it.each([
    ["French with commas", NARRATIVE],
    [
      "French without commas",
      "En tant que lectrice je veux relire les exports afin de corriger les erreurs",
    ],
    [
      "French in capitals",
      "EN TANT QUE lectrice, JE VEUX relire les exports, AFIN DE corriger les erreurs.",
    ],
    [
      "French in bold",
      "**En tant que** lectrice, **je veux** relire les exports, **afin de** corriger les erreurs.",
    ],
    ["French behind a dash bullet", `- ${NARRATIVE}`],
    ["French behind a star bullet", `* ${NARRATIVE}`],
    [
      "French with « afin de » on the next line",
      "En tant que lectrice, je veux relire les exports,\nafin de corriger les erreurs.",
    ],
    [
      "French on three lines",
      "En tant que lectrice,\nje veux relire les exports,\nafin de corriger les erreurs.",
    ],
    [
      "English",
      "As a lectrice, I want relire les exports, so that corriger les erreurs.",
    ],
    [
      "English with « as an »",
      "As an lectrice, I want relire les exports, so that corriger les erreurs.",
    ],
    [
      "English in lowercase and bold",
      "**as a** lectrice, **i want** relire les exports, **so that** corriger les erreurs",
    ],
    [
      "English with « so that » on the next line",
      "As a lectrice, I want relire les exports,\nso that corriger les erreurs",
    ],
  ])(
    "given a %s narrative and one criterion, when it is read, then the issue is a story with the three parts",
    async (_name, narrative) => {
      expect(
        await read("Contexte de l'issue.", "", narrative, "", CRITERION),
      ).toEqual({
        ...fields,
        criteria: [one],
      });
    },
  );

  it("given the narrative text is surrounded by other paragraphs, when it is read, then only the narrative is taken", async () => {
    expect(
      await read(
        "## Description",
        "",
        "Du texte avant.",
        "",
        NARRATIVE,
        "",
        "Du texte après.",
        "",
        CRITERION,
      ),
    ).toEqual({
      ...fields,
      criteria: [one],
    });
  });

  it("given a body with Windows line endings, when it is read, then the issue is a story", async () => {
    expect(
      await readStoryIssue([NARRATIVE, "", CRITERION].join("\r\n")),
    ).toEqual({
      ...fields,
      criteria: [one],
    });
  });

  it("given a narrative of 1,000 characters in « je veux », when it is read, then it is a story; with 1,001 it is not", async () => {
    const wants = (n: number) =>
      `En tant que lectrice, je veux ${"x".repeat(n)}, afin de corriger.`;
    expect(await read(wants(1_000), CRITERION)).not.toBeNull();
    expect(await read(wants(1_001), CRITERION)).toBeNull();
  });
});

describe("057 B: the criteria", async () => {
  const withCriteria = (...lines: string[]) => read(NARRATIVE, "", ...lines);

  it.each([
    [
      "a bullet",
      "- Étant donné un export, quand je le relis, alors je vois les erreurs",
    ],
    [
      "a star bullet",
      "* Étant donné un export, quand je le relis, alors je vois les erreurs.",
    ],
    [
      "an unchecked box",
      "- [ ] Étant donné un export, quand je le relis, alors je vois les erreurs",
    ],
    [
      "a checked box",
      "- [x] Étant donné un export, quand je le relis, alors je vois les erreurs",
    ],
    [
      "a numbered item",
      "1. Étant donné un export, quand je le relis, alors je vois les erreurs",
    ],
    [
      "a bold box (the Cockpit shape)",
      "- [ ] **Étant donné** un export **quand** je le relis **alors** je vois les erreurs",
    ],
    [
      "a plain line",
      "Étant donné un export, quand je le relis, alors je vois les erreurs.",
    ],
    [
      "capitals",
      "- ÉTANT DONNÉ un export, QUAND je le relis, ALORS je vois les erreurs",
    ],
    [
      "English",
      "- Given un export, when je le relis, then je vois les erreurs",
    ],
    [
      "English in bold, capitalised",
      "- **Given** un export, **When** je le relis, **Then** je vois les erreurs",
    ],
    [
      "English in a box",
      "- [ ] Given un export when je le relis then je vois les erreurs",
    ],
  ])(
    "given a criterion written as %s, when the issue is read, then it gives the three parts",
    async (_name, line) => {
      expect(await withCriteria(line)).toEqual({ ...fields, criteria: [one] });
    },
  );

  it.each([
    [
      "French plain lines",
      [
        "Étant donné un export",
        "Quand je le relis",
        "Alors je vois les erreurs",
      ],
    ],
    [
      "English plain lines",
      ["Given un export", "When je le relis", "Then je vois les erreurs"],
    ],
    [
      "bold lines",
      [
        "**Étant donné** un export",
        "**Quand** je le relis",
        "**Alors** je vois les erreurs",
      ],
    ],
  ])(
    "given a criterion on three consecutive lines (%s), when the issue is read, then it gives one criterion",
    async (_name, lines) => {
      expect(await withCriteria(...lines)).toEqual({
        ...fields,
        criteria: [one],
      });
    },
  );

  it("given one-line and three-line criteria mixed, when the issue is read, then they come in the order of the text", async () => {
    const result = await withCriteria(
      "- Étant donné a1, quand b1, alors c1",
      "",
      "Étant donné a2",
      "Quand b2",
      "Alors c2",
      "",
      "- [ ] Given a3, when b3, then c3",
    );
    expect(result?.criteria).toEqual([
      { given: "a1", when: "b1", then: "c1" },
      { given: "a2", when: "b2", then: "c2" },
      { given: "a3", when: "b3", then: "c3" },
    ]);
  });

  it("given other lines around the criteria (a title, a note, a list item that is not a criterion), when the issue is read, then they are not criteria", async () => {
    const result = await withCriteria(
      "## Critères d'acceptation",
      "",
      "- une simple puce",
      "- Étant donné a, quand b, alors c",
      "",
      "Une remarque.",
    );
    expect(result?.criteria).toEqual([{ given: "a", when: "b", then: "c" }]);
  });

  it("given 20 criteria, when the issue is read, then it is a story; with 21 it is a ticket", async () => {
    const list = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `- Étant donné a${i}, quand b${i}, alors c${i}`,
      );
    expect((await withCriteria(...list(20)))?.criteria).toHaveLength(20);
    expect(await withCriteria(...list(21))).toBeNull();
  });

  it("given a criterion part of 2,000 characters, when the issue is read, then it is a story; with 2,001 it is a ticket", async () => {
    const given = (n: number) =>
      `- Étant donné ${"x".repeat(n)}, quand b, alors c`;
    expect(await withCriteria(given(2_000))).not.toBeNull();
    expect(await withCriteria(given(2_001))).toBeNull();
  });
});

describe("057 B: the template of Cockpit (decision 020 B)", async () => {
  it("given the body Cockpit renders for a story, when it is read, then the same story comes back, whatever its notes and dependencies", async () => {
    const { body } = renderIssue({
      id: 42,
      asA: "lectrice attentive",
      iWant: "relire les exports",
      soThat: "corriger les erreurs",
      notesMd: "Une **note** importante\n\n- avec une liste",
      status: "in_progress",
      criteria: [
        {
          given: "un export",
          when: "je le relis",
          then: "je vois les erreurs",
        },
        { given: "un autre", when: "je clique", then: "tout change" },
      ],
      dependsOn: [{ id: 7, issueNumber: 12 }],
    });

    expect(await readStoryIssue(body)).toEqual({
      asA: "lectrice attentive",
      iWant: "relire les exports",
      soThat: "corriger les erreurs",
      criteria: [
        {
          given: "un export",
          when: "je le relis",
          then: "je vois les erreurs",
        },
        { given: "un autre", when: "je clique", then: "tout change" },
      ],
    });
  });
});

describe("057 B: what is not a story", async () => {
  it.each([
    ["an empty body", ""],
    [
      "a plain bug report",
      "Le bouton Enregistrer ne répond pas sur Safari.\n\n1. Ouvrir la page\n2. Cliquer",
    ],
    ["a narrative without criterion", NARRATIVE],
    ["a criterion without narrative", CRITERION],
    [
      "a narrative missing its benefit",
      `En tant que lectrice, je veux relire les exports.\n\n${CRITERION}`,
    ],
    [
      "a criterion missing its result",
      `${NARRATIVE}\n\n- Étant donné un export, quand je le relis`,
    ],
    [
      "a criterion whose keywords are out of order",
      `${NARRATIVE}\n\n- Quand je le relis, étant donné un export, alors je vois`,
    ],
  ])(
    "given %s, when it is read, then the issue is a ticket (null)",
    async (_name, body) => {
      expect(await readStoryIssue(body)).toBeNull();
    },
  );
});

// Review of 11.3 (B1): a body is third-party text of up to 65,536 characters; reading it must never take long, whatever the separators between the keywords
// (a regex with nested or adjacent whitespace quantifiers backtracks quadratically on such text). Each case must answer (a story or null) in under 200 ms.
describe("057 B: adversarial bodies stay fast", () => {
  const N = 65_000;
  const SEPARATORS = [
    ["space", " "],
    ["tab", "\t"],
    ["no-break space", "\u00a0"],
    ["vertical tab", "\v"],
    ["form feed", "\f"],
    ["line separator U+2028", "\u2028"],
    ["ideographic space", "\u3000"],
  ] as const;
  const bodies = (sep: string) => [
    `En tant que x${sep.repeat(N)}je veux`,
    `En tant que${sep.repeat(N)}x`,
    `As a x${sep.repeat(N)}I want`,
    `Given a${sep.repeat(N)}when`,
    `En tant que a, je veux b, afin de c.\n\n- Étant donné a${sep.repeat(N)}quand`,
    `- [x]${sep.repeat(N)}Étant donné a`,
  ];

  it.each(SEPARATORS)(
    "given 65,000 %s between keywords, when it is read, then each body is answered in under 200 ms",
    async (_name, sep) => {
      for (const body of bodies(sep)) {
        const start = performance.now();
        await readStoryIssue(body);
        expect(performance.now() - start, body.slice(0, 20)).toBeLessThan(200);
      }
    },
  );

  it("given repeated keywords and lines (« En tant que » 5,000 times, « Given a when » 5,000 times), when it is read, then it is answered in under 200 ms", async () => {
    for (const body of [
      "En tant que ".repeat(5_000),
      "Given a when ".repeat(5_000),
      "En tant que a je veux ".repeat(2_900),
      "- [x] ".repeat(10_000),
    ]) {
      const start = performance.now();
      await readStoryIssue(body);
      expect(performance.now() - start).toBeLessThan(200);
    }
  });
});
