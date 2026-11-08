import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogStates } from "./catalog-update.ts";
import { withProject } from "./test-mcp.ts";

// Slice R5 (decision 051 J, K): the three agents of the findings, one more skill part, and the catalogue that grows to 12 files.
//
// Pinned where the decision leaves it open (the developer follows these):
// - Three files `catalog/agents/bug-hunter.md` (model sonnet), `security-reviewer.md` (opus) and `architect.md` (opus), going to `.claude/agents/<name>.md`;
//   front matter name, description, tools (which name mcp__cockpit__submit_findings and mcp__cockpit__list_findings) and model. Like the other agents they name nothing of
//   Cockpit's own documents and their prompts are in English.
// - Their bodies: the bug-hunter writes the text of a bug as Given / When / Then, the security-reviewer names OWASP and never writes a secret (only where it is), the architect
//   speaks of the architecture and of the stack; all read the known findings with list_findings before filing, cite what they file and fix and send again on a refusal.
// - The skill `analyser` names mcp__cockpit__submit_findings, mcp__cockpit__list_findings, the three agents and the arguments `bugs`, `securite` and `architecture`.
// - « Préparer pour Claude » writes them with the others: the plan has 12 files (it had 9), the three are `create` with the text of the catalogue; catalogStates lists 11 files
//   (CLAUDE.md apart) and `catalog/history.json` has the 11 keys, each holding the SHA-256 of the current text.

afterEach(() => {
  vi.unstubAllGlobals();
});

const root = (relative: string) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative: string) => {
  expect(existsSync(root(relative)), `${relative} exists`).toBe(true);
  return readFileSync(root(relative), "utf8");
};
const frontMatter = (text: string) =>
  /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1] ?? "";
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const REPO = "user1000/app";

const AGENTS = [
  { name: "bug-hunter", model: "sonnet" },
  { name: "security-reviewer", model: "opus" },
  { name: "architect", model: "opus" },
];
const NEW_PATHS = AGENTS.map((a) => `.claude/agents/${a.name}.md`);
const SKILL = ".claude/skills/analyser/SKILL.md";

describe("decision 051 K: the agents of the findings", () => {
  it.each(AGENTS)(
    "given the catalogue, when the agent $name is read, then it has a front matter with that name, a description, tools naming submit_findings and list_findings, and model: $model",
    ({ name, model }) => {
      const front = frontMatter(read(`catalog/agents/${name}.md`));

      expect(front, "a YAML front matter at the top").not.toBe("");
      expect(front).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, "m"));
      expect(front).toMatch(/^description:\s*\S/m);
      expect(front).toMatch(/^tools:\s*.*mcp__cockpit__submit_findings/m);
      expect(front).toMatch(/^tools:\s*.*mcp__cockpit__list_findings/m);
      expect(front).toMatch(new RegExp(`^model:\\s*${model}\\s*$`, "m"));
    },
  );

  it.each(AGENTS)(
    "given the agent $name, when its body is read, then it reads the known findings, cites the code at the commit of HEAD, fixes and sends again on a refusal, and names nothing of Cockpit's own documents",
    ({ name }) => {
      const text = read(`catalog/agents/${name}.md`);

      expect(text.replace(frontMatter(text), "").trim().length).toBeGreaterThan(
        200,
      );
      expect(text).toContain("submit_findings");
      expect(text).toContain("list_findings");
      expect(text).toMatch(/\bHEAD\b/);
      expect(text).toMatch(/citation|cite/i);
      expect(text).toMatch(/refus|refused/i);
      expect(text).not.toMatch(
        /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
      );
    },
  );

  it("given the three agents, when their bodies are read, then each follows the template of its kind", () => {
    const hunter = read("catalog/agents/bug-hunter.md");
    const reviewer = read("catalog/agents/security-reviewer.md");
    const architect = read("catalog/agents/architect.md");

    expect(hunter).toMatch(/given/i);
    expect(hunter).toMatch(/\bwhen\b/i);
    expect(hunter).toMatch(/\bthen\b/i);
    expect(reviewer).toMatch(/OWASP/);
    expect(reviewer).toMatch(/secret/i);
    expect(architect).toMatch(/architecture/i);
    expect(architect).toMatch(/stack/i);
  });

  it("given the skill analyser, when it is read, then it names the findings tools, the three agents and the arguments bugs, securite and architecture, and still the map and the rules", () => {
    const text = read("catalog/skills/analyser/SKILL.md");

    expect(text).toContain("mcp__cockpit__submit_findings");
    expect(text).toContain("mcp__cockpit__list_findings");
    for (const { name } of AGENTS) expect(text).toContain(name);
    for (const word of ["bugs", "securite", "architecture"])
      expect(text).toMatch(new RegExp(`\\b${word}\\b`));
    expect(text).toContain("mcp__cockpit__submit_code_map");
    expect(text).toContain("rules-analyst");
    expect(text).not.toMatch(
      /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
    );
  });
});

describe("decision 051 K: « Préparer pour Claude » and « Mettre à jour » carry them", () => {
  // Counts changed by decision 052 K (slice R6): upgrade-advisor makes 13 files in the plan, 12 states, 12 history keys.
  it("given a repo with nothing of the catalogue, when the plan is read, then it has 13 files and the three agents are create with the text of the catalogue", async () => {
    const ctx = await withProject({
      gitRepos: { [REPO]: { files: { "README.md": "# app\n" } } },
    });

    const res = await ctx.app.request(
      `/api/projects/${ctx.projectId}/prepare`,
      {
        method: "POST",
        headers: { cookie: ctx.alice.cookie },
      },
    );
    const { plan } = (await res.json()) as {
      plan: { files: { path: string; status: string; content: string }[] };
    };

    expect(plan.files).toHaveLength(13);
    for (const { name } of AGENTS)
      expect(
        plan.files.find((f) => f.path === `.claude/agents/${name}.md`),
      ).toEqual({
        path: `.claude/agents/${name}.md`,
        status: "create",
        content: read(`catalog/agents/${name}.md`),
      });
  });

  it("given a prepared repo that lacks the three agents, when the states are computed, then 12 files are listed and the three are absent", () => {
    const files: Record<string, string> = {
      ".claude/skills/dev-us/SKILL.md": read("catalog/skills/dev-us/SKILL.md"),
    };

    const result = catalogStates({ files });

    expect(result).toHaveLength(12);
    for (const path of NEW_PATHS)
      expect(result?.find((f) => f.path === path)?.state).toBe("absent");
  });

  it("given the catalogue, when history.json is read, then it has 12 keys, the three agents included, each holding the SHA-256 of the current text", () => {
    const history = JSON.parse(read("catalog/history.json")) as Record<
      string,
      string[]
    >;

    expect(Object.keys(history)).toHaveLength(12);
    for (const { name } of AGENTS)
      expect(history[`.claude/agents/${name}.md`]).toContain(
        sha256(read(`catalog/agents/${name}.md`)),
      );
    expect(history[SKILL]).toContain(
      sha256(read("catalog/skills/analyser/SKILL.md")),
    );
  });
});
