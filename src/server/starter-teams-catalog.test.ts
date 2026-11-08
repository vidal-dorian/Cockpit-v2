import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readTeam } from "../web/team-file.ts";
import { catalogStates } from "./catalog-update.ts";
import { parseTeam } from "./team.ts";
import {
  agentCatalog,
  fromCatalog,
  LEVEL_IDS,
  LEVELS,
  teamCatalog,
  teamWritten,
} from "./test-starter-teams.ts";

// Slice 11.6 (decision 063 A, B, C): the four starter teams and the two agents the catalogue gains.
// The format of the team files, the models and what is written to a repo are pinned in test-starter-teams.ts.

const exists = (relative: string) =>
  existsSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)));
const frontMatter = (text: string) =>
  /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1] ?? "";
const GENERIC =
  /cockpit|docs\/decisions|docs\/decoupage|docs\/ecrans|decisions? 0\d\d|slice/i;

describe("decision 063 A, B: catalog/teams/<level>.md", () => {
  it.each(LEVEL_IDS)(
    "given the catalogue, when the team %s is read, then it is a team.md that parseTeam reads with exactly the agents of decision 063 A, in order",
    (level) => {
      expect(exists(`catalog/teams/${level}.md`), "the file exists").toBe(true);

      expect(parseTeam(teamCatalog(level))).toEqual(
        LEVELS[level].map((s) => s.agent),
      );
    },
  );

  it.each(LEVEL_IDS)(
    "given the team %s, when the model of each step is read, then it is the one of decision 063 A",
    (level) => {
      const text = teamCatalog(level);
      const found = [
        ...text.matchAll(/^ {2}- agent: (\S+)\r?\n {4}model: (\S+)\s*$/gm),
      ].map((m) => ({ agent: m[1], model: m[2] }));

      expect(found).toEqual(
        LEVELS[level].map(({ agent, model }) => ({ agent, model })),
      );
    },
  );

  it.each(LEVEL_IDS)(
    "given the team %s, when it is written to a repo (model lines removed), then the team editor reads it, with the loops of decision 063 A and a condition on each loop",
    (level) => {
      const read = readTeam(teamWritten(level));

      expect(read, "readable by the editor of decision 031 G").not.toBeNull();
      expect(read?.steps.map((s) => [s.agent, s.loopTo])).toEqual(
        LEVELS[level].map((s) => [s.agent, s.loopTo ?? null]),
      );
      for (const step of read?.steps ?? []) {
        expect(step.does.length, `${step.agent} does`).toBeGreaterThan(0);
        if (step.loopTo) expect(step.until).toMatch(/ready/);
      }
      expect(teamWritten(level)).not.toMatch(/^ {4}model:/m);
    },
  );

  it("given Éco, when its steps are read, then it has no reviewer and no loop", () => {
    expect(parseTeam(teamCatalog("eco"))).not.toContain("reviewer");
    expect(teamCatalog("eco")).not.toMatch(/loop_to/);
  });
});

describe("decision 063 C: doc-writer and doc-reviewer in the catalogue", () => {
  it.each(["doc-writer", "doc-reviewer"])(
    "given the catalogue, when the agent %s is read, then it has a front matter (name, description, tools, model: sonnet), a body, and names nothing of Cockpit",
    (name) => {
      expect(exists(`catalog/agents/${name}.md`), "the file exists").toBe(true);
      const text = agentCatalog(name);
      const front = frontMatter(text);

      expect(front).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, "m"));
      expect(front).toMatch(/^description:\s*\S/m);
      expect(front).toMatch(/^tools:\s*\S/m);
      expect(front).toMatch(/^model:\s*sonnet\s*$/m);
      expect(
        text.replace(/^---[\s\S]*?\n---\r?\n/, "").trim().length,
      ).toBeGreaterThan(200);
      expect(text).toMatch(/CLAUDE\.md/);
      expect(text).not.toMatch(GENERIC);
    },
  );
});

describe("decision 063 C: the security-reviewer has a step mode", () => {
  it("given the agent, when it is read, then it describes the step mode (the diff of the story, a verdict like the reviewer) besides its analysis mode (findings)", () => {
    const text = agentCatalog("security-reviewer");

    expect(text).toMatch(/\bstep\b/i);
    expect(text).toMatch(/verdict/i);
    expect(text).toMatch(/\bready\b/);
    expect(text).toMatch(/diff/i);
    // The analysis mode stays.
    expect(text).toContain("mcp__cockpit__submit_findings");
    expect(text).toMatch(/^tools:.*mcp__cockpit__submit_findings/m);
  });

  it("given the skill /dev-us, when it is read, then it says the security-reviewer can be a step of the team and that the doc steps exist", () => {
    const text = fromCatalog("skills/dev-us/SKILL.md");

    expect(text).toContain("security-reviewer");
    expect(text).toMatch(/security-reviewer[\s\S]{0,300}(verdict|ready)/i);
    expect(text).toMatch(/doc-writer|doc-reviewer/);
  });
});

describe("decision 063 C: doc-writer and doc-reviewer in the states of the catalogue", () => {
  // Pinned: they are files of the catalogue (updatable when present), but a repo that has not got them is not offered them (a Standard project never wrote them):
  // `catalogStates` lists them only when the repo has them, never as absent.
  const prepared = {
    ".claude/skills/dev-us/SKILL.md": fromCatalog("skills/dev-us/SKILL.md"),
  };

  it("given a prepared repo without doc-writer and doc-reviewer, when the states are computed, then they are not listed", () => {
    const paths = catalogStates({ files: prepared })?.map((f) => f.path);

    expect(paths).toHaveLength(12);
    expect(paths).not.toContain(".claude/agents/doc-writer.md");
    expect(paths).not.toContain(".claude/agents/doc-reviewer.md");
  });

  it("given a repo that has the current doc-writer, when the states are computed, then it is listed as current", () => {
    const result = catalogStates({
      files: {
        ...prepared,
        ".claude/agents/doc-writer.md": agentCatalog("doc-writer"),
      },
    });

    expect(
      result?.find((f) => f.path === ".claude/agents/doc-writer.md")?.state,
    ).toBe("current");
  });
});
