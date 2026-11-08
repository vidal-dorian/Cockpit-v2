import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice 14.1 (decision 053 G): /dev-us takes `--launch <id>` and passes it to start_run as `launch_id`.

const SKILL = fileURLToPath(
  new URL("../../catalog/skills/dev-us/SKILL.md", import.meta.url),
);

describe("criterion 7: catalog/skills/dev-us/SKILL.md", () => {
  it("given the skill dev-us, when it is read, then the message syntax has --launch <id>", () => {
    expect(readFileSync(SKILL, "utf8")).toMatch(/--launch <id>/);
  });

  it("given the skill dev-us, when its Start the run section is read, then it tells to pass the --launch value as it is to start_run in `launch_id`", () => {
    const text = readFileSync(SKILL, "utf8");
    const start = text.slice(
      text.indexOf("## Start the run"),
      text.indexOf("## Develop"),
    );
    expect(start).toMatch(/--launch/);
    expect(start).toMatch(/`launch_id`/);
    expect(start).toMatch(/start_run/);
  });
});
