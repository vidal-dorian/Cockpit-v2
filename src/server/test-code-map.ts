import { sql } from "drizzle-orm";
import type { FakeGitRepoOptions, stubGitHub } from "./test-github.ts";
import { callTool, withProject } from "./test-mcp.ts";

// Shared by the tests of slice R1 (decision 043): a repo with an API and a web module, the arguments of `submit_code_map`
// and the table `code_maps` read with raw SQL (so no test depends on the Drizzle export of a column).

export const REPO = "user1000/app";

/** `n` lines "<prefix> 1\n" ... "<prefix> n\n": a file of exactly `n` lines (a final newline does not start another one). */
export const text = (n: number, prefix = "line") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}\n`).join("");

export const FILES: Record<string, string> = {
  "README.md": text(3, "readme"),
  "api/package.json": text(6, "api-manifest"),
  "api/src/db.ts": text(30, "db"),
  "web/package.json": text(6, "web-manifest"),
  "web/src/types.ts": text(10, "types"),
};

export const cite = (path: string, start_line = 1, end_line = start_line) => ({
  path,
  start_line,
  end_line,
});

export type Module = ReturnType<typeof apiModule>;

/** The API: three objects (User, Order, Invoice), two links, two runtimes. */
export const apiModule = (over: Record<string, unknown> = {}) => ({
  path: "api",
  name: "Serveur",
  kind: "api",
  manifest: "api/package.json",
  runtimes: [
    { name: "node", version: "20", citation: cite("api/package.json", 2) },
    { name: "hono", version: "4.6", citation: cite("api/package.json", 3) },
  ],
  objects: [
    {
      name: "User",
      kind: "table",
      fields: [
        { name: "id", type: "uuid" },
        { name: "email", type: "text" },
      ],
      citation: cite("api/src/db.ts", 18, 24),
    },
    {
      name: "Order",
      kind: "table",
      fields: [{ name: "id", type: "uuid" }],
      citation: cite("api/src/db.ts", 5, 9),
    },
    {
      name: "Invoice",
      kind: "type",
      fields: [],
      citation: cite("api/src/db.ts", 1, 2),
    },
  ],
  links: [
    { from: "Order", to: "User", kind: "references", cardinality: "0..1" },
    { from: "Invoice", to: "Order", kind: "contains" },
  ],
  ...over,
});

export const webModule = (over: Record<string, unknown> = {}) => ({
  path: "web",
  name: "Application",
  kind: "web",
  manifest: "web/package.json",
  runtimes: [
    { name: "react", version: "18.3", citation: cite("web/package.json", 2) },
  ],
  objects: [
    {
      name: "Session",
      kind: "type",
      fields: [{ name: "token", type: "string" }],
      citation: cite("web/src/types.ts", 3, 5),
    },
  ],
  links: [],
  ...over,
});

/** Alice and her project, whose repo has a Git history with `files` (and the other `entries` of `repo`); `sha` is its only commit. */
export async function ready(
  files: Record<string, string> = FILES,
  repo: Omit<FakeGitRepoOptions, "files"> = {},
  github: Partial<Parameters<typeof stubGitHub>[0]> = {},
) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { ...repo, files } },
    ...github,
  });
  const git = ctx.fetchMock.git(REPO);
  return { ...ctx, git, sha: git.head };
}
export type Ctx = Awaited<ReturnType<typeof ready>>;

/** `ready()` with Alice Pro by a code with no end: the takeover tools are Pro only (decision 077 D), and most tests are not about the plan. */
export async function readyPro(...args: Parameters<typeof ready>) {
  const ctx = await ready(...args);
  await ctx.db.execute(
    sql`insert into pro_codes (code_hash, note, created_at, expires_at, user_id, used_at) values ('test', 'test', now(), now(), ${ctx.alice.id}, now())`,
  );
  return ctx;
}

/** A `submit_code_map` call on the project of `ctx`; `args` overrides any argument (`project_id`, `commit_sha`, `modules`). */
export const submit = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId" | "sha">,
  modules: unknown[] = [apiModule(), webModule()],
  args: Record<string, unknown> = {},
) =>
  callTool(ctx.app, ctx.alice.secret, "submit_code_map", {
    project_id: ctx.projectId,
    commit_sha: ctx.sha,
    modules,
    ...args,
  });

export type Stored = {
  module_path: string;
  module_name: string;
  module_kind: string;
  commit_sha: string;
  data: Record<string, unknown>;
};

/** The rows of `code_maps` (decision 007), by module path. */
export async function stored(db: Ctx["db"]) {
  const result = await db.execute(
    sql`select module_path, module_name, module_kind, commit_sha, data from code_maps order by module_path`,
  );
  return (result as unknown as { rows: Stored[] }).rows;
}

/** The GitHub reads that are file reads (Contents), as the paths they asked for. */
export const contentsReads = (calls: { method: string; path: string }[]) =>
  calls
    .filter((c) => c.method === "GET" && c.path.includes("/contents/"))
    .map((c) => decodeURIComponent(c.path.split("/contents/")[1] as string));
