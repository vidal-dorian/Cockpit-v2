import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice R4 (decision 050 A, B, C, G): the catalogue texts describe the freeze mode, and catalog/history.json holds their new versions (decision 049 B).

const read = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
    "utf8",
  );
const SKILL = read("skills/dev-us/SKILL.md");
const TEST_WRITER = read("agents/test-writer.md");
const REVIEWER = read("agents/reviewer.md");

describe("decision 050 A, B: the skill dev-us", () => {
  it("given the skill, when it is read, then it reads the kind and names the takeover mode", () => {
    expect(SKILL).toMatch(/`kind`/);
    expect(SKILL).toContain("takeover");
  });

  it("given the skill, when it is read, then a takeover story skips the developer step", () => {
    expect(SKILL).toMatch(/takeover[\s\S]*skip[\s\S]*developer/i);
  });

  it("given the skill, when it is read, then the tests must pass without changing app code", () => {
    expect(SKILL).toMatch(/without (changing|touching|modifying) (any )?app/i);
  });

  it("given the skill, when it is read, then a rule whose test fails stays out of the PR and is reported failed", () => {
    expect(SKILL).toMatch(
      /not (in|into) the (PR|pull request)|out of the (PR|pull request)/i,
    );
    expect(SKILL).toMatch(
      /report_criterion[\s\S]*failed|failed[\s\S]*report_criterion/i,
    );
  });
});

describe("decision 050 A, B: the test-writer", () => {
  it("given the agent, when it is read, then it describes the freeze mode: takeover, one test per rule, passing without changing app code", () => {
    expect(TEST_WRITER).toContain("takeover");
    expect(TEST_WRITER).toMatch(/one test per (rule|criterion)/i);
    expect(TEST_WRITER).toMatch(
      /without (changing|touching|modifying) (any )?app/i,
    );
  });

  it("given the agent, when it is read, then a failing rule's test is left out of the PR and reported failed", () => {
    expect(TEST_WRITER).toMatch(
      /not (in|into) the (PR|pull request)|out of the (PR|pull request)|leave[\s\S]*out/i,
    );
    expect(TEST_WRITER).toMatch(/failed/);
  });
});

describe("decision 050 A, C: the reviewer", () => {
  it("given the agent, when it is read, then for a takeover story it checks that the PR only touches tests", () => {
    expect(REVIEWER).toContain("takeover");
    expect(REVIEWER).toMatch(/only (touch|modif|chang)\w* tests|only tests/i);
  });
});

describe("decision 050 G: catalog/history.json", () => {
  const history = JSON.parse(read("history.json")) as Record<string, string[]>;
  const sha256 = (text: string) =>
    createHash("sha256").update(text, "utf8").digest("hex");

  // Before slice R4: 14 versions of dev-us, 1 of the test-writer, 1 of the reviewer.
  it.each([
    [".claude/skills/dev-us/SKILL.md", SKILL, 14],
    [".claude/agents/test-writer.md", TEST_WRITER, 1],
    [".claude/agents/reviewer.md", REVIEWER, 1],
  ])(
    "given the file %s changed for the freeze mode, when the history is read, then it holds a new version, the last being the current text",
    (path, text, before) => {
      const versions = history[path] ?? [];
      expect(versions.length).toBeGreaterThan(before);
      expect(versions.at(-1)).toBe(sha256(text));
    },
  );
});
