import { expect, it } from "vitest";
import { refusedLine } from "./team-file.ts";

const file = (...lines: string[]) => `---\nsteps:\n${lines.join("\n")}\n---\n`;

it.each([
  ["a key before steps", `---\nname: dev\nsteps:\n---\n`, "name: dev"],
  [
    "until without loop_to",
    file("  - agent: dev", '    does: "x"', '    until: "x"'),
    '    until: "x"',
  ],
  [
    "a duplicate agent",
    file("  - agent: dev", "  - agent: dev"),
    "  - agent: dev",
  ],
  [
    "a loop to no earlier step",
    file("  - agent: dev", "    loop_to: reviewer", '    until: "x"'),
    "    loop_to: reviewer",
  ],
  [
    "an opening line with a trailing space",
    "--- \nsteps:\n  - agent: developer\n---\n",
    "--- ",
  ],
  [
    "a closing line with a trailing space",
    "---\nsteps:\n  - agent: developer\n--- \nBody\n",
    "--- ",
  ],
])("names the line of %s", (_n, text, line) => {
  expect(refusedLine(text)).toBe(line);
});
