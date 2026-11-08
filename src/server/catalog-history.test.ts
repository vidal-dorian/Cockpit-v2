import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeGitRepoOptions } from "./test-github.ts";
import { archiveProject, withProject } from "./test-mcp.ts";

// Slice C1 (decision 049 A, B, G): the SHA-256 Cockpit keeps of every catalogue file it writes, and `catalog/history.json`.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The table is `catalog_writes` (project_id, path, sha256, written_at), unique by (project_id, path); `sha256` is the lowercase hex SHA-256 of the UTF-8 text written,
//   `path` the repo path. The tests read it with raw SQL.
// - POST /api/projects/:id/prepare/apply records one row per catalogue file it created (a `same` or `exists` file is not written, so not recorded) and never CLAUDE.md;
//   a refusal or an error records nothing. « Ajouter /analyser au repo » is the same route with a plan reduced to the three analyser files.
// - `catalog/history.json` is `{ "<repo path>": ["<sha256 hex>", ...] }`, keyed by the repo paths (`.claude/agents/developer.md`...), never holding CLAUDE.md.
// - `npm run catalog:history` exists (package.json) to regenerate it.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const fromCatalog = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
    "utf8",
  );
const CATALOG: Record<string, string> = {
  ".claude/agents/test-writer.md": fromCatalog("agents/test-writer.md"),
  ".claude/agents/developer.md": fromCatalog("agents/developer.md"),
  ".claude/agents/reviewer.md": fromCatalog("agents/reviewer.md"),
  ".claude/skills/dev-us/SKILL.md": fromCatalog("skills/dev-us/SKILL.md"),
  ".claude/skills/write-us/SKILL.md": fromCatalog("skills/write-us/SKILL.md"),
  ".claude/agents/cartographer.md": fromCatalog("agents/cartographer.md"),
  ".claude/skills/analyser/SKILL.md": fromCatalog("skills/analyser/SKILL.md"),
  ".claude/agents/rules-analyst.md": fromCatalog("agents/rules-analyst.md"),
  ".claude/agents/bug-hunter.md": fromCatalog("agents/bug-hunter.md"),
  ".claude/agents/security-reviewer.md": fromCatalog(
    "agents/security-reviewer.md",
  ),
  ".claude/agents/architect.md": fromCatalog("agents/architect.md"),
  // Slice R6 (decision 052 K): the thirteenth file with CLAUDE.md, the twelfth without.
  ".claude/agents/upgrade-advisor.md": fromCatalog("agents/upgrade-advisor.md"),
};
const PATHS = Object.keys(CATALOG).sort();
const ANALYSER = [
  ".claude/agents/cartographer.md",
  ".claude/agents/rules-analyst.md",
  ".claude/agents/bug-hunter.md",
  ".claude/agents/security-reviewer.md",
  ".claude/agents/architect.md",
  ".claude/agents/upgrade-advisor.md",
  ".claude/skills/analyser/SKILL.md",
];

type Ctx = Awaited<ReturnType<typeof ready>>;
async function ready(repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: { "README.md": "# app\n" }, ...repo } },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}
const post = (ctx: Ctx, path: string, body?: unknown) =>
  ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
    method: "POST",
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Plan = {
  baseSha: string;
  signature: string;
  files: { path: string; content: string; status: string }[];
};
const planOf = async (ctx: Ctx) => {
  const res = await post(ctx, "/prepare");
  expect(res.status, "the plan must be served").toBe(200);
  return ((await res.json()) as { plan: Plan }).plan;
};
/** What Cockpit kept, by path. */
async function kept(ctx: Ctx) {
  const result = await ctx.db.execute(
    sql`select project_id, path, sha256 from catalog_writes order by path`,
  );
  return (
    result as unknown as {
      rows: { project_id: number; path: string; sha256: string }[];
    }
  ).rows;
}

describe("decision 049 B: catalog/history.json", () => {
  it("given the catalogue, when history.json is read, then it lists the SHA-256 of the current version of every file of the catalogue and never CLAUDE.md", () => {
    const history = JSON.parse(fromCatalog("history.json")) as Record<
      string,
      string[]
    >;

    // Decision 063 C: doc-writer and doc-reviewer are in the catalogue, so in the history, though only Premium and Max write them (PATHS is what a Standard preparation writes).
    expect(Object.keys(history).sort()).toEqual(
      [
        ...PATHS,
        ".claude/agents/doc-writer.md",
        ".claude/agents/doc-reviewer.md",
      ].sort(),
    );
    for (const [path, text] of Object.entries(CATALOG))
      expect(history[path], path).toContain(sha256(text));
  });

  it("given package.json, when its scripts are read, then catalog:history regenerates the history", () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../package.json", import.meta.url)),
        "utf8",
      ),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts["catalog:history"]).toBeTruthy();
  });
});

describe("decision 049 A: Cockpit keeps the hash of what it writes", () => {
  it("given an empty repo, when « Préparer pour Claude » is applied, then one row per file of the catalogue is kept with the SHA-256 of its text, and none for CLAUDE.md", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(200);
    expect(await kept(ctx)).toEqual(
      PATHS.map((path) => ({
        project_id: ctx.projectId,
        path,
        sha256: sha256(CATALOG[path] as string),
      })),
    );
  });

  it("given a repo that already holds two files of the catalogue, when « Préparer pour Claude » is applied, then only the files it wrote are kept", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        ".claude/agents/developer.md": "my own developer\n",
        ".claude/agents/reviewer.md": CATALOG[
          ".claude/agents/reviewer.md"
        ] as string,
      },
    });
    const plan = await planOf(ctx);

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(200);
    const paths = (await kept(ctx)).map((r) => r.path);
    expect(paths).not.toContain(".claude/agents/developer.md");
    expect(paths).not.toContain(".claude/agents/reviewer.md");
    expect(paths).toContain(".claude/agents/test-writer.md");
  });

  it("given a prepared repo without /analyser, when « Ajouter /analyser au repo » is applied (the plan reduced to the three files), then the three are kept with their hashes", async () => {
    const files = Object.fromEntries(
      Object.entries(CATALOG).filter(([path]) => !ANALYSER.includes(path)),
    );
    const ctx = await ready({ files: { "README.md": "# app\n", ...files } });
    const plan = await planOf(ctx);

    const res = await post(ctx, "/prepare/apply", {
      plan: {
        ...plan,
        files: plan.files.filter((f) => ANALYSER.includes(f.path)),
      },
    });

    expect(res.status).toBe(200);
    expect(await kept(ctx)).toEqual(
      [...ANALYSER].sort().map((path) => ({
        project_id: ctx.projectId,
        path,
        sha256: sha256(CATALOG[path] as string),
      })),
    );
  });

  it("given a plan read and a file pushed on GitHub in between, when it is applied, then repo_changed and nothing is kept", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    ctx.git.push(
      { ".claude/agents/developer.md": "pushed meanwhile\n" },
      "push",
    );

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "repo_changed" });
    expect(await kept(ctx)).toEqual([]);
  });

  it("given an archived project, when a plan is applied, then it is refused and nothing is kept", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    await archiveProject(ctx.db, ctx.projectId);

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(409);
    expect(await kept(ctx)).toEqual([]);
  });

  it("given an error of GitHub during the write, when a plan is applied, then 502 and nothing is kept", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    ctx.fetchMock.update({
      failOn: (call) =>
        call.method === "POST" && call.path.endsWith("/git/commits"),
    });

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(502);
    expect(await kept(ctx)).toEqual([]);
  });
});
