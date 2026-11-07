import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOG_TEXTS } from "./catalog-update.ts";
import { githubCalls } from "./test-github.ts";
import { rows, withProject } from "./test-mcp.ts";

// Slice C1 review: a plan edited in the browser, and /catalog/apply on a repo that is not prepared.

const REPO = "user1000/app";
const DEV = ".claude/agents/developer.md";
const MINE = "my own developer\n";

async function ready(files: Record<string, string>) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: { "README.md": "# app\n", ...files } } },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}
type Ctx = Awaited<ReturnType<typeof ready>>;
const post = (ctx: Ctx, path: string, body?: unknown) =>
  ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
    method: "POST",
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Plan = { files: { path: string; status: string }[] };
const noWrite = (ctx: Ctx) => {
  expect(
    githubCalls(ctx.fetchMock).filter(
      (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
    ),
  ).toEqual([]);
  expect(ctx.git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
};
const catalogWrites = async (ctx: Ctx) =>
  (
    (await ctx.db.execute(sql`select path from catalog_writes`)) as unknown as {
      rows: unknown[];
    }
  ).rows;

describe("a forged status update sent to /prepare/apply", () => {
  it.each([
    [DEV, "a hand-modified file"],
    ["CLAUDE.md", "CLAUDE.md"],
  ])(
    "given %s as %s forced to update, when the plan is applied, then it is refused and nothing is written",
    async (path) => {
      const ctx = await ready({
        [DEV]: MINE,
        "CLAUDE.md": "# my rules\n",
      });
      const res = await post(ctx, "/prepare");
      const { plan } = (await res.json()) as { plan: Plan };
      const mine = path === DEV ? MINE : "# my rules\n";
      const content =
        path === DEV
          ? (CATALOG_TEXTS.get(DEV) as string)
          : readFileSync(
              fileURLToPath(
                new URL("../../catalog/CLAUDE.md", import.meta.url),
              ),
              "utf8",
            );
      // CLAUDE.md is not in the plan of a repo that has one: the forged plan adds it.
      const forged = {
        ...plan,
        files: [
          ...plan.files.filter((f) => f.path !== path),
          { path, content, status: "update", current: mine },
        ],
      };

      const applied = await post(ctx, "/prepare/apply", { plan: forged });

      expect(applied.status).toBe(400);
      noWrite(ctx);
      expect(await catalogWrites(ctx)).toEqual([]);
    },
  );
});

describe("POST /catalog/apply on a repo that is not prepared", () => {
  it("given a repo with no dev-us skill, when every file is sent with before null, then 409 not_prepared, a refused entry and nothing written", async () => {
    const ctx = await ready({});

    const res = await post(ctx, "/catalog/apply", {
      files: [...CATALOG_TEXTS.keys()].map((path) => ({ path, before: null })),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_prepared" });
    noWrite(ctx);
    expect(await catalogWrites(ctx)).toEqual([]);
    const entries = await rows(ctx.db, sql`action = 'update_catalog'`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ result: "refused" });
  });
});
