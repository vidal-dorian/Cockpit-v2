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
