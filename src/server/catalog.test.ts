import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listedTools, withProject } from "./test-mcp.ts";

// Slice 4.3 (decision 017 M): the first file of the Cockpit catalogue, the skill /write-us. A skill that names a
// tool the server does not have would send Claude into a dead end, so every tool it names must be listed.
//
// Convention pinned: the skill names a Cockpit tool by its Claude Code name, `mcp__cockpit__<tool>` (server
// "cockpit"), the way an `allowed-tools` line or a sentence of the skill writes it.

const SKILL = fileURLToPath(
  new URL("../../catalog/skills/write-us/SKILL.md", import.meta.url),
);

describe("criterion 18: catalog/skills/write-us/SKILL.md", () => {
  it("given the catalogue, when the skill write-us is read, then it has a YAML front matter with name: write-us and a description", () => {
    expect(existsSync(SKILL), "catalog/skills/write-us/SKILL.md exists").toBe(
      true,
    );

    const text = readFileSync(SKILL, "utf8");

    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1] ?? "";
    expect(front, "a YAML front matter at the top").not.toBe("");
    expect(front).toMatch(/^name:\s*write-us\s*$/m);
    expect(front).toMatch(/^description:\s*\S/m);
  });

  it("given the skill, when it names Cockpit tools, then it names list_tickets_needing_us and create_user_stories and every tool it names is one tools/list shows", async () => {
    expect(existsSync(SKILL), "catalog/skills/write-us/SKILL.md exists").toBe(
      true,
    );
    const text = readFileSync(SKILL, "utf8");
    const named = [
      ...new Set(
        [...text.matchAll(/mcp__cockpit__([a-z][a-z0-9_]*)/g)].map((m) => m[1]),
      ),
    ];
    const { app, alice } = await withProject();

    const listed = (await listedTools(app, alice.secret)).map((t) => t.name);

    expect(named).toContain("list_tickets_needing_us");
    expect(named).toContain("create_user_stories");
    for (const name of named) expect(listed, name).toContain(name);
  });

  it("given the skill, when it explains how to write a very large ticket and how to size a story, then it mentions more_to_come, vertical slices and the pull request (decision 017 N, O)", () => {
    const text = readFileSync(SKILL, "utf8");

    expect(text).toContain("more_to_come");
    expect(text).toMatch(/vertical/i);
    expect(text).toMatch(/pull request/i);
  });

  it("given the skill, when it explains the calls of a very large ticket, then it mentions stories_written and says to send one call at a time, waiting for its answer (decision 017 N)", () => {
    const text = readFileSync(SKILL, "utf8");

    expect(text).toContain("stories_written");
    expect(text).toMatch(/one (call )?at a time|wait for (its|the) answer/i);
  });
});
