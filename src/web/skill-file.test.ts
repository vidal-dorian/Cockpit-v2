import { describe, expect, it } from "vitest";
import { parseSkill, writeSkill } from "./agent-file.ts";

// Slice 12.1 (decision 065 F): the reader and the writer of a SKILL.md, in `agent-file.ts`.

describe("parseSkill and writeSkill", () => {
  it("given a skill written by writeSkill, when it is read, then the fields come back and the blank line is not in the body", () => {
    const fields = {
      description: "Lints",
      tools: "Read, Grep",
      body: "Do it\n",
    };

    const text = writeSkill("lint", fields);

    expect(text).toBe(
      "---\nname: lint\ndescription: Lints\nallowed-tools: Read, Grep\n---\n\nDo it\n",
    );
    expect(parseSkill(text)).toEqual(fields);
  });

  it("given no tools, when it is written, then there is no allowed-tools line", () => {
    expect(writeSkill("a", { description: "d", tools: "", body: "b" })).toBe(
      "---\nname: a\ndescription: d\n---\n\nb",
    );
  });

  it("given a text without header, when it is read, then null", () => {
    expect(parseSkill("no header\n")).toBeNull();
  });
});

describe("writeSkill quoting (review of slice 12.1)", () => {
  it("given a description with a colon, when it is written and read back, then it is a quoted string and comes back as typed", () => {
    const fields = {
      description: "Analyse : trouve les bugs",
      tools: "",
      body: "b",
    };

    const text = writeSkill("a", fields);

    expect(text).toContain('description: "Analyse : trouve les bugs"');
    expect(parseSkill(text)).toEqual(fields);
  });
});
