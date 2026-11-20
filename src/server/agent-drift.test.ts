import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentDrift } from "./agent-drift.ts";

// Story #61: `.claude/agents/` must not drift from `catalog/agents/` in silence.
// Pinned: `agentDrift(repoDir, catalogDir)` answers the names of the agents present in both
// folders whose files differ once the repo-specific sections are removed from the repo file.
// A repo-specific section is wrapped in `<!-- repo-specific -->` ... `<!-- /repo-specific -->`.

function folders(
  repo: Record<string, string>,
  catalog: Record<string, string>,
) {
  const root = mkdtempSync(join(tmpdir(), "agent-drift-"));
  const out: [string, string] = [join(root, "repo"), join(root, "catalog")];
  for (const [dir, files] of [
    [out[0], repo],
    [out[1], catalog],
  ] as const) {
    mkdirSync(dir);
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(dir, name), text);
  }
  return out;
}

describe("agent drift", () => {
  it("given an agent in both folders, when the files differ outside the repo-specific sections, then it is reported", () => {
    const [repo, catalog] = folders(
      { "a.md": "one\ntwo\n", "b.md": "same\n" },
      { "a.md": "one\nthree\n", "b.md": "same\n" },
    );
    expect(agentDrift(repo, catalog)).toEqual(["a.md"]);
  });

  it("given an agent in both folders, when only a declared repo-specific section differs, then it is not reported", () => {
    const [repo, catalog] = folders(
      {
        "a.md":
          "one\n<!-- repo-specific -->\nextra\n<!-- /repo-specific -->\ntwo\n",
      },
      { "a.md": "one\ntwo\n" },
    );
    expect(agentDrift(repo, catalog)).toEqual([]);
  });

  it("given the current repo and catalog agents (reviewer, test-writer, doc-writer, doc-reviewer), when compared, then each is aligned or declared and nothing drifts", () => {
    expect(agentDrift(".claude/agents", "catalog/agents")).toEqual([]);
  });
});
