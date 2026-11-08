import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withProject } from "./test-mcp.ts";

// Slice R2 (decision 047 M): `rules-analyst`, one agent more in `catalog/`, and the part « Règles » of the skill `analyser`.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The agent is `catalog/agents/rules-analyst.md`, going to `.claude/agents/rules-analyst.md`; front matter name, description, tools (which name
//   mcp__cockpit__create_takeover_stories) and model: opus. Like the cartographer it names nothing of Cockpit's own documents and its prompt is in English.
// - The skill keeps its path, names `mcp__cockpit__create_takeover_stories`, the agent `rules-analyst` and the limit of 5 rules per user story.
// - « Préparer pour Claude » writes it with the others: the catalogue is 9 files (it was 8; 12 since the findings, decision 051); « Ajouter /analyser au repo » (a plan reduced to the three files
//   of /analyser) writes the three and never overwrites a different file.

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

const SKILL = ".claude/skills/analyser/SKILL.md";
const CARTOGRAPHER = ".claude/agents/cartographer.md";
const AGENT = ".claude/agents/rules-analyst.md";
const REPO = "user1000/app";

describe("decision 047 M: the files of the catalogue", () => {
  it("given the catalogue, when the agent rules-analyst is read, then it has a front matter with name: rules-analyst, a description, tools naming create_takeover_stories and model: opus", () => {
    const front = frontMatter(read("catalog/agents/rules-analyst.md"));

    expect(front, "a YAML front matter at the top").not.toBe("");
    expect(front).toMatch(/^name:\s*rules-analyst\s*$/m);
    expect(front).toMatch(/^description:\s*\S/m);
    expect(front).toMatch(/^tools:\s*.*mcp__cockpit__create_takeover_stories/m);
    expect(front).toMatch(/^model:\s*opus\s*$/m);
  });

  it("given the agent rules-analyst, when its body is read, then it reads the code at the commit of HEAD, writes at most 5 rules per user story with reasoning and doubt, cites each rule, fixes and sends again on a refusal, and names nothing of Cockpit's own documents", () => {
    const text = read("catalog/agents/rules-analyst.md");

    expect(text.replace(frontMatter(text), "").trim().length).toBeGreaterThan(
      200,
    );
    expect(text).toContain("create_takeover_stories");
    expect(text).toMatch(/\bHEAD\b/);
    expect(text).toMatch(/\b5\b|five/i);
    expect(text).toMatch(/reasoning/i);
    expect(text).toMatch(/doubt/i);
    expect(text).toMatch(/citation|cite/i);
    expect(text).toMatch(/refus|refused/i);
    expect(text).not.toMatch(
      /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
    );
  });

  it("given the skill analyser, when it is read, then it still maps the code and now also names create_takeover_stories, the agent rules-analyst, the argument regles and the limit of 5 rules per user story", () => {
    const text = read("catalog/skills/analyser/SKILL.md");

    expect(text).toContain("mcp__cockpit__submit_code_map");
    expect(text).toContain("mcp__cockpit__create_takeover_stories");
    expect(text).toContain("rules-analyst");
    expect(text).toContain("cartographer");
    expect(text).toMatch(/\bregles\b/);
    expect(text).toMatch(/\bcarte\b/);
    expect(text).toMatch(/\b5\b|five/i);
    expect(text).not.toMatch(
      /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
    );
  });
});

describe("decision 047 M: « Préparer pour Claude » writes it", () => {
  async function prepared(files: Record<string, string>) {
    const ctx = await withProject({
      gitRepos: { [REPO]: { files: { "README.md": "# app\n", ...files } } },
    });
    const post = (path: string, body?: unknown) =>
      ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
        method: "POST",
        headers: {
          cookie: ctx.alice.cookie,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { ...ctx, git: ctx.fetchMock.git(REPO), post };
  }
  type Plan = {
    baseSha: string;
    files: { path: string; content: string; status: string }[];
  };
  const planOf = async (ctx: Awaited<ReturnType<typeof prepared>>) =>
    ((await (await ctx.post("/prepare")).json()) as { plan: Plan }).plan;

  it("given a repo with nothing of the catalogue, when the plan is read, then it has 13 files and the agent is create with the text of the catalogue", async () => {
    const ctx = await prepared({});

    const plan = await planOf(ctx);

    // Changed by decision 052 K (slice R6): 13 files with upgrade-advisor, it had 12.
    expect(plan.files).toHaveLength(13);
    expect(plan.files.find((f) => f.path === AGENT)).toEqual({
      path: AGENT,
      status: "create",
      content: read("catalog/agents/rules-analyst.md"),
    });
    expect(plan.files.find((f) => f.path === SKILL)?.content).toBe(
      read("catalog/skills/analyser/SKILL.md"),
    );
  });

  it("given a repo that already has the skill and the cartographer of R1, when the plan is read, then the agent is create and the skill is exists (never overwritten)", async () => {
    const ctx = await prepared({
      [SKILL]: "old skill\n",
      [CARTOGRAPHER]: read("catalog/agents/cartographer.md"),
    });

    const plan = await planOf(ctx);

    expect(plan.files.find((f) => f.path === AGENT)?.status).toBe("create");
    expect(plan.files.find((f) => f.path === SKILL)).toMatchObject({
      status: "exists",
      current: "old skill\n",
    });
  });

  it("given a plan of the three files of /analyser (a repo already prepared), when it is applied, then ONE commit adds exactly these three files with the text of the catalogue", async () => {
    const ctx = await prepared({});
    const plan = await planOf(ctx);
    const three = [SKILL, CARTOGRAPHER, AGENT];
    const only = {
      ...plan,
      files: plan.files.filter((f) => three.includes(f.path)),
    };
    expect(only.files).toHaveLength(3);

    const res = await ctx.post("/prepare/apply", { plan: only });

    expect(res.status).toBe(200);
    const sha = ((await res.json()) as { commitSha: string }).commitSha;
    expect(ctx.git.created.commits).toHaveLength(1);
    const files = ctx.git.filesAt(sha) ?? {};
    expect(files[AGENT]).toBe(read("catalog/agents/rules-analyst.md"));
    expect(files[SKILL]).toBe(read("catalog/skills/analyser/SKILL.md"));
    expect(Object.keys(files).sort()).toEqual(["README.md", ...three].sort());
  });
});
