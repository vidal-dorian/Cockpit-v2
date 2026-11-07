import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withProject } from "./test-mcp.ts";

// Slice R1 (decision 043 M): `/analyser` and `cartographer`, two files more in `catalog/`, written by « Préparer pour Claude » (027) for a new repo.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The files are `catalog/skills/analyser/SKILL.md` and `catalog/agents/cartographer.md`, going to `.claude/skills/analyser/SKILL.md` and `.claude/agents/cartographer.md`.
// - Like the other agents they name nothing of Cockpit's own documents (decision 005) and the prompts are in English; the skill names Cockpit's tools by their
//   Claude Code names `mcp__cockpit__get_project` and `mcp__cockpit__submit_code_map`.
// - « Ajouter /analyser au repo » (the window of the screens) uses the routes of 027 as they are: POST /prepare gives the plan, POST /prepare/apply writes the files
//   of the plan it is handed, so a plan reduced to the two files writes these two files only (see the web tests).

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
const AGENT = ".claude/agents/cartographer.md";
const REPO = "user1000/app";

describe("decision 043 M: the files of the catalogue", () => {
  it("given the catalogue, when the agent cartographer is read, then it has a front matter with name: cartographer, a description, tools and model: opus", () => {
    const front = frontMatter(read("catalog/agents/cartographer.md"));

    expect(front, "a YAML front matter at the top").not.toBe("");
    expect(front).toMatch(/^name:\s*cartographer\s*$/m);
    expect(front).toMatch(/^description:\s*\S/m);
    expect(front).toMatch(/^tools:\s*\S/m);
    expect(front).toMatch(/^model:\s*opus\s*$/m);
  });

  it("given the agent cartographer, when its body is read, then it reads the repo at the commit of HEAD, submits with submit_code_map, fixes and sends again on a refusal, and names nothing of Cockpit's own documents", () => {
    const text = read("catalog/agents/cartographer.md");

    expect(text.replace(frontMatter(text), "").trim().length).toBeGreaterThan(
      200,
    );
    expect(text).toContain("submit_code_map");
    expect(text).toMatch(/\bHEAD\b/);
    expect(text).toMatch(/refus|refused/i);
    expect(text).toMatch(/manifest/i);
    expect(text).toMatch(/citation|cite/i);
    expect(text).not.toMatch(
      /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
    );
  });

  it("given the catalogue, when the skill analyser is read, then it has a YAML front matter with name: analyser and a description", () => {
    const front = frontMatter(read("catalog/skills/analyser/SKILL.md"));

    expect(front, "a YAML front matter at the top").not.toBe("");
    expect(front).toMatch(/^name:\s*analyser\s*$/m);
    expect(front).toMatch(/^description:\s*\S/m);
  });

  it("given the skill analyser, when it is read, then it calls get_project, runs the cartographer agent, and names submit_code_map by its Claude Code name", () => {
    const text = read("catalog/skills/analyser/SKILL.md");

    expect(text).toContain("mcp__cockpit__get_project");
    expect(text).toContain("cartographer");
    expect(text).toContain("mcp__cockpit__submit_code_map");
    expect(text).not.toMatch(
      /cockpit-v2|docs\/decisions|docs\/decoupage|decisions? 0\d\d/i,
    );
  });
});

describe("decision 043 M: « Préparer pour Claude » writes them for a new repo", () => {
  async function ready(files: Record<string, string>) {
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

  it("given a repo with nothing of the catalogue, when the plan is read, then the skill and the agent are create, with the text of the catalogue", async () => {
    const ctx = await ready({});

    const { plan } = (await (await ctx.post("/prepare")).json()) as {
      plan: Plan;
    };

    const skill = plan.files.find((f) => f.path === SKILL);
    const agent = plan.files.find((f) => f.path === AGENT);
    expect(skill).toEqual({
      path: SKILL,
      status: "create",
      content: read("catalog/skills/analyser/SKILL.md"),
    });
    expect(agent).toEqual({
      path: AGENT,
      status: "create",
      content: read("catalog/agents/cartographer.md"),
    });
  });

  it("given a plan of the two files only (a repo already prepared), when it is applied, then ONE commit adds exactly these two files with the text of the catalogue", async () => {
    const ctx = await ready({});
    const { plan } = (await (await ctx.post("/prepare")).json()) as {
      plan: Plan;
    };
    const only = {
      ...plan,
      files: plan.files.filter((f) => f.path === SKILL || f.path === AGENT),
    };
    expect(only.files).toHaveLength(2);

    const res = await ctx.post("/prepare/apply", { plan: only });

    expect(res.status).toBe(200);
    const sha = ((await res.json()) as { commitSha: string }).commitSha;
    expect(ctx.git.created.commits).toHaveLength(1);
    const files = ctx.git.filesAt(sha) ?? {};
    expect(files[SKILL]).toBe(read("catalog/skills/analyser/SKILL.md"));
    expect(files[AGENT]).toBe(read("catalog/agents/cartographer.md"));
    expect(Object.keys(files).sort()).toEqual(
      [AGENT, "README.md", SKILL].sort(),
    );
  });

  it("given a repo that has its own cartographer, when the plan is read and applied, then the agent is exists (never create) and the file of the repo is left as it is while the skill is added", async () => {
    const ctx = await ready({ [AGENT]: "mine: my own cartographer\n" });
    const { plan } = (await (await ctx.post("/prepare")).json()) as {
      plan: Plan;
    };
    expect(plan.files.find((f) => f.path === AGENT)).toMatchObject({
      status: "exists",
      current: "mine: my own cartographer\n",
    });

    const res = await ctx.post("/prepare/apply", {
      plan: {
        ...plan,
        files: plan.files.filter((f) => f.path === SKILL || f.path === AGENT),
      },
    });

    expect(res.status).toBe(200);
    const files = ctx.git.filesAt(ctx.git.head) ?? {};
    expect(files[AGENT]).toBe("mine: my own cartographer\n");
    expect(files[SKILL]).toBe(read("catalog/skills/analyser/SKILL.md"));
  });
});
