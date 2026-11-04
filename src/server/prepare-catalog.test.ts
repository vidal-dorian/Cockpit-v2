import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listedTools, withProject } from "./test-mcp.ts";

// Slice 6.2 (decision 027 A, B, C): the files Cockpit ships to prepare a repo for Claude, in `catalog/`.
//
// Pinned where the decision leaves it open:
// - Layout of the catalogue: `catalog/agents/<name>.md`, `catalog/skills/<name>/SKILL.md` (as write-us already is) and `catalog/CLAUDE.md`.
// - The agents are the ones that develop Cockpit made independent of the project: they name nothing of Cockpit's own docs.
// - The prompts are in English, like the other prompts (CLAUDE.md of the project).
// - `/dev-us` names a Cockpit tool by its Claude Code name `mcp__cockpit__<tool>`, as /write-us does (catalog.test.ts).
// - The image must carry the catalogue (the Dockerfile copies the files the server runs).

const path = (relative: string) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative: string) => {
  expect(existsSync(path(relative)), `${relative} exists`).toBe(true);
  return readFileSync(path(relative), "utf8");
};
const frontMatter = (text: string) =>
  /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1] ?? "";

describe("decision 027 A: the agents of the catalogue", () => {
  it.each([
    { name: "test-writer", model: "sonnet" },
    { name: "developer", model: "sonnet" },
    { name: "reviewer", model: "opus" },
  ])(
    "given the catalogue, when the agent $name is read, then it has a front matter with that name, a description, tools and model: $model",
    ({ name, model }) => {
      const front = frontMatter(read(`catalog/agents/${name}.md`));

      expect(front, "a YAML front matter at the top").not.toBe("");
      expect(front).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, "m"));
      expect(front).toMatch(/^description:\s*\S/m);
      expect(front).toMatch(/^tools:\s*\S/m);
      expect(front).toMatch(new RegExp(`^model:\\s*${model}\\s*$`, "m"));
    },
  );

  it.each(["test-writer", "developer", "reviewer"])(
    "given the agent %s, when it is read, then it has a body and names nothing of Cockpit's own documents (it must work in any repo, decision 005)",
    (name) => {
      const text = read(`catalog/agents/${name}.md`);

      expect(text.replace(frontMatter(text), "").trim().length).toBeGreaterThan(
        200,
      );
      expect(text).toMatch(/CLAUDE\.md/);
      expect(text).not.toMatch(
        /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
      );
    },
  );
});

describe("decision 027 A, C: the skill /dev-us", () => {
  it("given the catalogue, when the skill dev-us is read, then it has a YAML front matter with name: dev-us and a description", () => {
    const front = frontMatter(read("catalog/skills/dev-us/SKILL.md"));

    expect(front, "a YAML front matter at the top").not.toBe("");
    expect(front).toMatch(/^name:\s*dev-us\s*$/m);
    expect(front).toMatch(/^description:\s*\S/m);
  });

  it("given the skill, when it is read, then it holds every step of decision 027 C: check the folder, the clean working tree and the default branch, read the story and refuse one that is not ready, branch with --branch, the three agents until ready, tests and lint, push and open the pull request that closes the issue, never merge", () => {
    const text = read("catalog/skills/dev-us/SKILL.md");

    // 1. the folder, the working tree, the default branch
    expect(text).toMatch(/working tree/i);
    expect(text).toMatch(/clean/i);
    expect(text).toMatch(/default branch/i);
    // 2. the story, and the refusal of a story that is not ready
    expect(text).toContain("mcp__cockpit__get_user_story");
    expect(text).toMatch(/\bready\b/);
    expect(text).toMatch(/not (in status )?`?ready`?|only .{0,40}`?ready`?/i);
    // 3. the branch
    expect(text).toContain("--branch");
    // 4. the three agents, in order, until the verdict is ready
    for (const agent of ["test-writer", "developer", "reviewer"])
      expect(text).toContain(agent);
    expect(text.indexOf("test-writer")).toBeLessThan(text.indexOf("developer"));
    expect(text.indexOf("developer")).toBeLessThan(text.indexOf("reviewer"));
    // 5. all the tests and the lint
    expect(text).toMatch(/\btests?\b/i);
    expect(text).toMatch(/\blint\b/i);
    // 6. push, pull request, Closes #<n>
    expect(text).toMatch(/push/i);
    expect(text).toMatch(/pull request/i);
    expect(text).toMatch(/Closes #/);
    // 7. never merge
    expect(text).toMatch(/never merge/i);
  });

  it("given the skill, when its Develop section is read, then it follows .claude/team.md when it exists and still lists test-writer, developer, reviewer in that order as the default", () => {
    const text = read("catalog/skills/dev-us/SKILL.md");

    expect(text).toContain(".claude/team.md");
    const develop = text.slice(text.indexOf(".claude/team.md"));
    expect(develop).toMatch(/default/i);
    expect(text.indexOf("test-writer")).toBeLessThan(text.indexOf("developer"));
    expect(text.indexOf("developer")).toBeLessThan(text.indexOf("reviewer"));
  });

  it("given the skill, when it names Cockpit tools, then it names get_user_story and every tool it names is one tools/list shows", async () => {
    const text = read("catalog/skills/dev-us/SKILL.md");
    const named = [
      ...new Set(
        [...text.matchAll(/mcp__cockpit__([a-z][a-z0-9_]*)/g)].map((m) => m[1]),
      ),
    ];
    const { app, alice } = await withProject();

    const listed = (await listedTools(app, alice.secret)).map((t) => t.name);

    expect(named).toContain("get_user_story");
    for (const name of named) expect(listed, name).toContain(name);
  });

  it("given the skill, when it is read, then it does not promise what comes with phase 7 (start_run)", () => {
    expect(read("catalog/skills/dev-us/SKILL.md")).not.toMatch(/start_run/);
  });
});

describe("decision 027 A: the starter CLAUDE.md", () => {
  it("given the catalogue, when catalog/CLAUDE.md is read, then it is short and says what to write in it: the commands, the layout and the conventions, and that it must be filled in", () => {
    const text = read("catalog/CLAUDE.md");

    expect(text.trim().length).toBeGreaterThan(100);
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
    expect(text).toMatch(/command/i);
    expect(text).toMatch(/layout|structure|organi[sz]ation/i);
    expect(text).toMatch(/convention/i);
    expect(text).toMatch(/fill/i);
  });
});

describe("decision 027 A: the image carries the catalogue", () => {
  it("given the Dockerfile, when it builds the image that runs the server, then it copies catalog/ next to src/server", () => {
    const dockerfile = read("Dockerfile");
    const runtime = dockerfile.slice(dockerfile.lastIndexOf("FROM "));

    expect(runtime).toMatch(/^COPY\s+catalog\s+catalog\s*$/m);
  });
});
