// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Story #51 (one name per notion), criterion 2: the glossary fixes the name of each notion and the screens follow it.

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("story 51, criterion 2: one name per notion", () => {
  it("given the docs, when I open docs/glossaire.md, then it fixes the names of the notions in dispute", () => {
    const glossary = read("docs/glossaire.md");
    for (const term of [
      "Règles du code",
      "Ticket",
      "Journal",
      "Historique",
      "Lanceur",
    ])
      expect(glossary).toContain(term);
  });

  it("given the decisions, when I look for the glossary, then a decision records the choices", () => {
    const files = readdirSync(join(root, "docs/decisions")).filter((f) =>
      /^(09[3-9]|1\d\d)-/.test(f),
    );
    expect(
      files.some((f) => read(`docs/decisions/${f}`).includes("glossaire.md")),
    ).toBe(true);
  });

  it("given the screens, when I read their text, then no screen calls the rules of Conception « écran de reprise »", () => {
    const offenders = readdirSync(join(root, "src/web"))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.|^test-/.test(f))
      .filter((f) => /écran de reprise/i.test(read(`src/web/${f}`)));
    expect(offenders).toEqual([]);
  });
});
