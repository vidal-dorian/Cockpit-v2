import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice 7.1 (decision 033 K): /dev-us reports its run to Cockpit.

const SKILL = fileURLToPath(
  new URL("../../catalog/skills/dev-us/SKILL.md", import.meta.url),
);

describe("criterion 11: catalog/skills/dev-us/SKILL.md", () => {
  it.each(["start_run", "report_step", "finish_run"])(
    "given the skill dev-us, when it is read, then it names the tool %s",
    (tool) => {
      expect(readFileSync(SKILL, "utf8")).toContain(tool);
    },
  );
});

describe("criterion 13 (slice 7.2, decision 034 I): the extra prompt", () => {
  it("given the skill dev-us, when it is read, then it tells to pass the extra prompt to start_run as `comment`", () => {
    const text = readFileSync(SKILL, "utf8");
    const start = text.slice(
      text.indexOf("## Start the run"),
      text.indexOf("## Develop"),
    );
    expect(start).toMatch(/`comment`/);
    expect(start).toMatch(/extra prompt/);
  });
});

describe("criterion 11 (slice 7.3, decision 035 H): criteria and pull request", () => {
  it.each(["report_criterion", "link_pull_request"])(
    "given the skill dev-us, when it is read, then it names the tool %s in its Finish section, before finish_run",
    (tool) => {
      const text = readFileSync(SKILL, "utf8");
      const finish = text.slice(
        text.indexOf("## Finish"),
        text.indexOf("## Never"),
      );
      expect(finish).toContain(tool);
      expect(finish.indexOf(tool)).toBeLessThan(finish.indexOf("finish_run"));
    },
  );
});

describe("criterion 9 (slice 7.4, decision 036 I): the questions", () => {
  it.each(["ask_user", "get_answer"])(
    "given the skill dev-us, when it is read, then it names the tool %s",
    (tool) => {
      expect(readFileSync(SKILL, "utf8")).toContain(tool);
    },
  );

  it.each([/30 seconds/i, /5 minutes/i])(
    "given the skill dev-us, when it is read, then it states the waits (%s)",
    (wait) => {
      expect(readFileSync(SKILL, "utf8")).toMatch(wait);
    },
  );
});
