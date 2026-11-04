import { describe, expect, it } from "vitest";
import { parseTeam } from "./team.ts";

// Decision 028 (slice E1): .claude/team.md, a Markdown file with a YAML front matter listing the steps.
const file = (front: string) => `---\n${front}\n---\n\n# Our team\n`;

describe("parseTeam", () => {
  it("given a valid team with loop_to and until lines, when it is parsed, then the agent names come back in file order", () => {
    const text = file(
      [
        "steps:",
        "  - agent: test-writer",
        "    does: writes the tests",
        "  - agent: developer",
        "    does: implements",
        "  - agent: reviewer",
        "    does: reviews",
        "    loop_to: developer",
        "    until: ready",
      ].join("\n"),
    );

    expect(parseTeam(text)).toEqual(["test-writer", "developer", "reviewer"]);
  });

  it("given a team of one agent with digits and dashes in its name, when it is parsed, then that name comes back", () => {
    expect(parseTeam(file("steps:\n  - agent: doc-writer2"))).toEqual([
      "doc-writer2",
    ]);
  });

  it.each([
    ["no front matter", "# Team\n\nsteps:\n  - agent: developer\n"],
    ["an empty file", ""],
    ["no steps key", file("name: team")],
    ["zero steps", file("steps:")],
    ["a step without agent", file("steps:\n  - does: something")],
    [
      "a name with a capital and a space",
      file("steps:\n  - agent: Doc Writer"),
    ],
    ["a name starting with a dash", file("steps:\n  - agent: -dev")],
    ["an empty name", file("steps:\n  - agent:")],
    [
      "one bad step among good ones",
      file("steps:\n  - agent: developer\n  - does: nothing"),
    ],
  ])("given %s, when it is parsed, then null", (_name, text) => {
    expect(parseTeam(text)).toBeNull();
  });
});
