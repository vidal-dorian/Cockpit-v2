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
