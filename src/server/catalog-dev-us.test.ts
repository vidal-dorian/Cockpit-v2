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
