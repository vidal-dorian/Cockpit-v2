import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice 14.6 (decision 044 E): /dev-us documents --night. Pinned: a `## ` section whose heading names the night.

const SKILL = fileURLToPath(
  new URL("../../catalog/skills/dev-us/SKILL.md", import.meta.url),
);

describe("criterion 12: catalog/skills/dev-us/SKILL.md, --night", () => {
  it("given the skill dev-us, when its night section is read, then it names --night and tells to ask_user, push what is done, finish_run with the outcome paused, and stop", () => {
    const text = readFileSync(SKILL, "utf8");
    const heading = text.search(/^## .*night/im);
    expect(heading, "a section whose heading names the night").toBeGreaterThan(
      -1,
    );
    const rest = text.slice(heading + 3);
    const section = rest.slice(
      0,
      rest.search(/^## /m) === -1 ? undefined : rest.search(/^## /m),
    );

    expect(section).toContain("--night");
    expect(section).toContain("ask_user");
    expect(section).toMatch(/push/i);
    expect(section).toContain("finish_run");
    expect(section).toContain("paused");
    expect(section).toMatch(/stop/i);
  });
});
