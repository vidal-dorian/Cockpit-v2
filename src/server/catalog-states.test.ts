import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogStates } from "./catalog-update.ts";

// Slice C1 (decision 049 B, C, D): the state of each catalogue file in a repo, and `catalog/history.json`.
//
// Pinned where the decision leaves it open (the developer follows these):
// - `src/server/catalog-update.ts` exports `catalogStates({ files, recorded?, history? })`, a pure function:
//   `files` maps each repo path of the catalogue (`.claude/agents/developer.md`...) to the text in the repo, or null when absent (a missing key is absent too);
//   `recorded` maps a path to the SHA-256 Cockpit kept for it (decision 049 A, table `catalog_writes`), default {};
//   `history` maps a path to the SHA-256 of its past versions (decision 049 B, `catalog/history.json`), default: the content of that file.
//   It answers null for a repo that is not prepared (no `.claude/skills/dev-us/SKILL.md` in `files`), else one `{ path, state }` per file of the
//   catalogue except CLAUDE.md (eight today), whatever the order, with state `"current" | "old" | "modified" | "absent"`.

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const fromCatalog = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
    "utf8",
  );
/** Each file of the catalogue except CLAUDE.md, by repo path (decision 027 B). */
const CATALOG: Record<string, string> = {
  ".claude/agents/test-writer.md": fromCatalog("agents/test-writer.md"),
  ".claude/agents/developer.md": fromCatalog("agents/developer.md"),
  ".claude/agents/reviewer.md": fromCatalog("agents/reviewer.md"),
  ".claude/skills/dev-us/SKILL.md": fromCatalog("skills/dev-us/SKILL.md"),
  ".claude/skills/write-us/SKILL.md": fromCatalog("skills/write-us/SKILL.md"),
  ".claude/agents/cartographer.md": fromCatalog("agents/cartographer.md"),
  ".claude/skills/analyser/SKILL.md": fromCatalog("skills/analyser/SKILL.md"),
  ".claude/agents/rules-analyst.md": fromCatalog("agents/rules-analyst.md"),
  ".claude/agents/bug-hunter.md": fromCatalog("agents/bug-hunter.md"),
  ".claude/agents/security-reviewer.md": fromCatalog(
    "agents/security-reviewer.md",
  ),
  ".claude/agents/architect.md": fromCatalog("agents/architect.md"),
  // Slice R6 (decision 052 K): the thirteenth file with CLAUDE.md, the twelfth without.
  ".claude/agents/upgrade-advisor.md": fromCatalog("agents/upgrade-advisor.md"),
};
const PATHS = Object.keys(CATALOG).sort();
const DEV = ".claude/agents/developer.md";
const DEV_US = ".claude/skills/dev-us/SKILL.md";

const stateOf = (
  result: ReturnType<typeof catalogStates>,
  path: string,
): string | undefined => result?.find((f) => f.path === path)?.state;

describe("decision 049 D: the state of each file", () => {
  it("given a repo with the eight files at their current version, when the states are computed, then all are current", () => {
    const result = catalogStates({ files: { ...CATALOG } });

    expect(result?.map((f) => f.path).sort()).toEqual(PATHS);
    expect(result?.every((f) => f.state === "current")).toBe(true);
  });

  it("given a repo that has no dev-us skill, when the states are computed, then it is not prepared: null, not eight absent files", () => {
    const { [DEV_US]: _skill, ...others } = CATALOG;

    expect(catalogStates({ files: others })).toBeNull();
    expect(catalogStates({ files: { ...others, [DEV_US]: null } })).toBeNull();
    expect(catalogStates({ files: { "README.md": "# app\n" } })).toBeNull();
  });

  it("given a prepared repo without the developer agent, when the states are computed, then it is absent and the others stay current", () => {
    const { [DEV]: _dev, ...others } = CATALOG;

    const result = catalogStates({ files: others });

    expect(stateOf(result, DEV)).toBe("absent");
    expect(stateOf(result, ".claude/agents/reviewer.md")).toBe("current");
  });

  it("given a copy whose SHA-256 Cockpit recorded when it wrote it, when the states are computed, then it is old", () => {
    const text = "the developer of long ago\n";

    const result = catalogStates({
      files: { ...CATALOG, [DEV]: text },
      recorded: { [DEV]: sha256(text) },
      history: {},
    });

    expect(stateOf(result, DEV)).toBe("old");
  });

  it("given a copy equal to a past version listed in the history and no recorded hash (a repo prepared before C1), when the states are computed, then it is old", () => {
    const text = "an older developer\n";

    const result = catalogStates({
      files: { ...CATALOG, [DEV]: text },
      history: { [DEV]: [sha256("another"), sha256(text)] },
    });

    expect(stateOf(result, DEV)).toBe("old");
  });

  it("given a copy that is neither current, recorded nor in the history, when the states are computed, then it is modified", () => {
    const result = catalogStates({
      files: { ...CATALOG, [DEV]: "my own developer\n" },
      recorded: { [DEV]: sha256("what Cockpit wrote") },
      history: { [DEV]: [sha256("a past version")] },
    });

    expect(stateOf(result, DEV)).toBe("modified");
  });

  it("given an old copy edited by hand afterwards (the agent editor, decision 030), when the states are computed, then it is modified, not old", () => {
    const written = "the developer of long ago\n";

    const result = catalogStates({
      files: { ...CATALOG, [DEV]: `${written}one line more\n` },
      recorded: { [DEV]: sha256(written) },
      history: {},
    });

    expect(stateOf(result, DEV)).toBe("modified");
  });

  it("given a current copy while a different hash was recorded, when the states are computed, then it is current (the text decides)", () => {
    const result = catalogStates({
      files: { ...CATALOG },
      recorded: { [DEV]: sha256("something else") },
      history: {},
    });

    expect(stateOf(result, DEV)).toBe("current");
  });

  it("given a CLAUDE.md in the repo, when the states are computed, then it is never listed (decision 049 C)", () => {
    const result = catalogStates({
      files: { ...CATALOG, "CLAUDE.md": "# mine\n" },
    });

    expect(result?.some((f) => f.path.endsWith("CLAUDE.md"))).toBe(false);
  });
});
