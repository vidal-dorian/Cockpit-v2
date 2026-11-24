import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogStates } from "./catalog-update.ts";
import { withProject } from "./test-mcp.ts";

// Slice R6 (decision 052 K): the agent `upgrade-advisor`, the word `versions` of `/analyser`, and the catalogue that grows to 13 files (12 without CLAUDE.md).
//
// Pinned where the decision leaves it open (the developer follows these):
// - The file is `catalog/agents/upgrade-advisor.md`, going to `.claude/agents/upgrade-advisor.md`: a front matter with name: upgrade-advisor, a description, tools naming
//   mcp__cockpit__submit_findings and mcp__cockpit__list_findings, and model: sonnet (decision 051 L: the user may change it).
// - Its body (English, like the other agents) starts from the runtimes and the dependencies of the repo and from the findings already known (`list_findings`, the GitHub alerts included), says it files
//   findings of kind `upgrade` with `submit_findings`, names the template of the decision 007 (from which version to which, the end of life date, the known breaking changes, the effort), cites
//   the line of the manifest (the repo at the commit of HEAD) and sends again on a refusal; it names nothing of Cockpit's own documents.
// - The skill analyser names upgrade-advisor and the argument `versions`, besides what it already names.
// - The counts that change are adjusted in catalog-findings.test.ts, catalog-rules.test.ts and prepare.test.ts (13 files in the plan), catalog-states.test.ts and catalog-findings.test.ts (12
//   states), catalog-findings.test.ts (12 keys in catalog/history.json): this file pins the new file itself and what the others cannot say alone.

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
const AGENT = "catalog/agents/upgrade-advisor.md";
const PATH = ".claude/agents/upgrade-advisor.md";

describe("decision 052 K: the agent upgrade-advisor", () => {
  it("given the catalogue, when the agent is read, then it has a front matter with name, a description, no tools allowlist but Edit and Write denied, and model: sonnet", () => {
    const front = frontMatter(read(AGENT));

    expect(front, "a YAML front matter at the top").not.toBe("");
    expect(front).toMatch(/^name:\s*upgrade-advisor\s*$/m);
    expect(front).toMatch(/^description:\s*\S/m);
    // Cockpit may be the `cockpit` server or a claude.ai connector named otherwise: no allowlist, only the writing tools denied.
    expect(front).not.toMatch(/^tools:/m);
    expect(front).toMatch(/^disallowedTools:.*\bEdit\b.*\bWrite\b/m);
    expect(front).toMatch(/^model:\s*sonnet\s*$/m);
  });

  it("given the agent, when its body is read, then it starts from the runtimes and the known findings, files upgrade findings with the template of 007, cites the manifest and sends again on a refusal", () => {
    const text = read(AGENT);

    expect(text.replace(frontMatter(text), "").trim().length).toBeGreaterThan(
      200,
    );
    expect(text).toContain("submit_findings");
    expect(text).toContain("list_findings");
    expect(text).toMatch(/\bupgrade\b/);
    expect(text).toMatch(/runtime/i);
    expect(text).toMatch(/dependenc/i);
    expect(text).toMatch(/end[- ]of[- ]life|EOL/i);
    expect(text).toMatch(/breaking/i);
    expect(text).toMatch(/effort/i);
    expect(text).toMatch(/from .* to /i);
    expect(text).toMatch(/GitHub/);
    expect(text).toMatch(/manifest/i);
    expect(text).toMatch(/\bHEAD\b/);
    expect(text).toMatch(/citation|cite/i);
    expect(text).toMatch(/refus|refused/i);
    expect(text).not.toMatch(
      /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
    );
  });

  it("given the skill analyser, when it is read, then it names upgrade-advisor and the argument versions", () => {
    const text = read("catalog/skills/analyser/SKILL.md");

    expect(text).toContain("upgrade-advisor");
    expect(text).toMatch(/\bversions\b/);
    expect(text).toContain("mcp__cockpit__submit_findings");
    expect(text).toContain("cartographer");
  });
});

describe("decision 052 K: « Préparer pour Claude » and « Mettre à jour » carry it", () => {
  it("given a repo with nothing of the catalogue, when the plan is read, then upgrade-advisor is create with the text of the catalogue", async () => {
    const ctx = await withProject({
      gitRepos: { "user1000/app": { files: { "README.md": "# app\n" } } },
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

    expect(plan.files.find((f) => f.path === PATH)).toEqual({
      path: PATH,
      status: "create",
      content: read(AGENT),
    });
  });

  it("given a prepared repo without the agent, when the states are computed, then upgrade-advisor is absent; with the current text it is current", () => {
    const base: Record<string, string> = {
      ".claude/skills/dev-us/SKILL.md": read("catalog/skills/dev-us/SKILL.md"),
    };

    const absent = catalogStates({ files: base });
    const current = catalogStates({ files: { ...base, [PATH]: read(AGENT) } });

    expect(absent?.find((f) => f.path === PATH)?.state).toBe("absent");
    expect(current?.find((f) => f.path === PATH)?.state).toBe("current");
  });

  it("given the catalogue, when history.json is read, then it holds the SHA-256 of the current agent", () => {
    const history = JSON.parse(read("catalog/history.json")) as Record<
      string,
      string[]
    >;

    expect(history[PATH]).toContain(sha256(read(AGENT)));
  });
});
