import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiModule,
  type Ctx,
  contentsReads,
  REPO,
  readyPro as ready,
  submit,
  webModule,
} from "./test-code-map.ts";
import { githubCalls } from "./test-github.ts";
import { userWithToken } from "./test-mcp.ts";

// Slice R1 (decision 043 G, H): the two reads of the map, through app.request() on PGlite against the fake GitHub.
//
// Pinned where the decision leaves it open (the developer follows these):
// - GET /api/projects/:id/code-map answers 200 { modules: [{ path, name, kind, commitSha, createdAt, commitsSince, data }] }, ordered by path;
//   `createdAt` is an ISO date (the column created_at), `data` is the stored data `{ manifest, runtimes, objects, links }` as submitted (snake_case citations),
//   `commitsSince` is the number of commits of the default branch that the commit has not (GitHub's `ahead_by` of `compare/{commit}...{default branch}`), or null.
//   One compare call per DISTINCT commit. No map is 200 { modules: [] }.
// - GET /api/projects/:id/code?sha=&path=&start=&end= answers 200 { firstLine, lines } : `lines` are the texts (no newline) from line `firstLine`, which is
//   max(1, start - 3), to min(last line of the file, end + 3). Every request reads the file on GitHub again (Contents API at `ref=sha`): nothing is kept.
// - 400 for an invalid query (sha that is not 40 hexadecimal characters, a start or end that is not a whole number >= 1, start > end, a missing parameter);
//   404 { error } for a non-member, an unknown project, and a (sha, path) that the map of the project does not hold (a file cited, or the manifest, by a module stored at that commit);
//   401 without a session. In the two 404 cases of a non-member and of a pair not in the map, GitHub is not read.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const read = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId">,
  cookie: string | undefined = ctx.alice.cookie,
  id: number | string = ctx.projectId,
) =>
  ctx.app.request(`/api/projects/${id}/code-map`, {
    headers: cookie ? { cookie } : {},
  });

const code = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId">,
  query: Record<string, string>,
  cookie: string | undefined = ctx.alice.cookie,
  id: number | string = ctx.projectId,
) =>
  ctx.app.request(`/api/projects/${id}/code?${new URLSearchParams(query)}`, {
    headers: cookie ? { cookie } : {},
  });

type MapModule = {
  path: string;
  name: string;
  kind: string;
  commitSha: string;
  createdAt: string;
  commitsSince: number | null;
  data: Record<string, unknown>;
};
const modulesOf = async (res: Response) => {
  expect(res.status).toBe(200);
  return ((await res.json()) as { modules: MapModule[] }).modules;
};

/** A module stored by hand, as a force-push leaves one: its commit no longer exists on GitHub. */
const seedRow = (ctx: Ctx, values: { path: string; sha: string; at: string }) =>
  ctx.db.execute(
    sql`insert into code_maps (project_id, module_path, module_name, module_kind, commit_sha, data, created_at)
        values (${ctx.projectId}, ${values.path}, 'Ancien', 'library', ${values.sha},
          ${JSON.stringify({ manifest: "lib/package.json", runtimes: [], objects: [], links: [] })}::jsonb, ${values.at}::timestamptz)`,
  );

const compareCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.includes("/compare/"));

describe("decision 043 G: GET /api/projects/:id/code-map", () => {
  it("given a stored map of api and web, when a member reads it, then the modules come back ordered by path with their commit, date and data", async () => {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);

    const modules = await modulesOf(await read(ctx));

    expect(modules.map((m) => [m.path, m.name, m.kind, m.commitSha])).toEqual([
      ["api", "Serveur", "api", ctx.sha],
      ["web", "Application", "web", ctx.sha],
    ]);
    expect(
      Math.abs(Date.parse(modules[0]?.createdAt as string) - Date.now()),
    ).toBeLessThan(60_000);
    expect(modules[0]?.data).toMatchObject({
      manifest: "api/package.json",
      runtimes: apiModule().runtimes,
      objects: apiModule().objects,
      links: apiModule().links,
    });
    expect(modules[1]?.data).toMatchObject({ objects: webModule().objects });
  });

  it("given a module stored on 2026-10-01 at 10:00 UTC, when it is read, then its date is that instant", async () => {
    const ctx = await ready();
    await seedRow(ctx, {
      path: "lib",
      sha: "e".repeat(40),
      at: "2026-10-01T10:00:00Z",
    });

    const [first] = await modulesOf(await read(ctx));

    expect(Date.parse(first?.createdAt as string)).toBe(
      Date.parse("2026-10-01T10:00:00Z"),
    );
  });

  it("given no map, when a member reads it, then 200 with no module and GitHub is not called", async () => {
    const ctx = await ready();

    expect(await modulesOf(await read(ctx))).toEqual([]);
    expect(compareCalls(ctx)).toEqual([]);
  });

  it("given two commits pushed after the commit of the map, when it is read, then commitsSince is 2, and a map at the head says 0", async () => {
    const ctx = await ready();
    expect((await submit(ctx, [apiModule()])).isError).not.toBe(true);
    const second = ctx.git.push({ "x.txt": "1\n" });
    ctx.git.push({ "y.txt": "2\n" });

    expect((await modulesOf(await read(ctx)))[0]?.commitsSince).toBe(2);

    const head = ctx.git.head;
    expect(
      (await submit(ctx, [webModule()], { commit_sha: head })).isError,
    ).not.toBe(true);
    const modules = await modulesOf(await read(ctx));
    expect(modules.map((m) => [m.path, m.commitsSince])).toEqual([
      ["api", 2],
      ["web", 0],
    ]);
    expect(second).not.toBe(head);
  });

  it("given two modules at the same commit and one at another, when the map is read, then GitHub is asked to compare once per distinct commit, from that commit to the default branch", async () => {
    const ctx = await ready();
    expect((await submit(ctx, [apiModule(), webModule()])).isError).not.toBe(
      true,
    );
    ctx.git.push({ "x.txt": "1\n" });
    const lib = {
      ...apiModule(),
      path: "lib",
      manifest: "api/package.json",
      name: "Lib",
    };
    expect(
      (await submit(ctx, [lib], { commit_sha: ctx.git.head })).isError,
    ).not.toBe(true);

    const modules = await modulesOf(await read(ctx));

    expect(modules).toHaveLength(3);
    const calls = compareCalls(ctx);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => decodeURIComponent(c.path)).sort()).toEqual(
      [`${ctx.sha}...main`, `${ctx.git.head}...main`]
        .map((range) => `/repos/${REPO}/compare/${range}`)
        .sort(),
    );
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("given a module whose commit GitHub no longer has (a force-push), when the map is read, then its commitsSince is null and the other modules still have theirs", async () => {
    const ctx = await ready();
    expect((await submit(ctx, [webModule()])).isError).not.toBe(true);
    await seedRow(ctx, {
      path: "lib",
      sha: "e".repeat(40),
      at: "2026-10-01T10:00:00Z",
    });
    ctx.git.push({ "x.txt": "1\n" });

    const modules = await modulesOf(await read(ctx));

    expect(modules.map((m) => [m.path, m.commitsSince])).toEqual([
      ["lib", null],
      ["web", 1],
    ]);
  });

  it("given a user who is not a member, when they read the map, then 404 and GitHub is not called", async () => {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);
    const known = githubCalls(ctx.fetchMock).length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await read(ctx, bob.cookie);

    expect(res.status).toBe(404);
    expect(githubCalls(ctx.fetchMock)).toHaveLength(known);
  });

  it("given an unknown project, when the map is read, then 404", async () => {
    const ctx = await ready();
    expect((await read(ctx)).status, "the route exists").toBe(200);

    expect((await read(ctx, ctx.alice.cookie, 99999)).status).toBe(404);
  });

  it("given no session, when the map is read, then 401", async () => {
    const ctx = await ready();

    expect((await read(ctx, "")).status).toBe(401);
  });
});

describe("decision 043 H: GET /api/projects/:id/code", () => {
  const cited = (ctx: Ctx, start: number, end: number) => ({
    sha: ctx.sha,
    path: "api/src/db.ts",
    start: String(start),
    end: String(end),
  });
  const at = (n: number) => `db ${n}`;
  const span = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => at(from + i));

  async function withMap() {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);
    return ctx;
  }

  it("given a cited object at lines 18 to 24 of a file of 30, when a member reads them, then the lines 15 to 27 come back (three before, three after)", async () => {
    const ctx = await withMap();

    const res = await code(ctx, cited(ctx, 18, 24));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstLine: 15, lines: span(15, 27) });
  });

  it("given lines at the start of the file, when they are read, then the context stops at line 1", async () => {
    const ctx = await withMap();

    const body = (await (await code(ctx, cited(ctx, 1, 2))).json()) as {
      firstLine: number;
      lines: string[];
    };

    expect(body).toEqual({ firstLine: 1, lines: span(1, 5) });
  });

  it("given lines at the end of the file, when they are read, then the context stops at the last line", async () => {
    const ctx = await withMap();

    const body = await (await code(ctx, cited(ctx, 29, 30))).json();

    expect(body).toEqual({ firstLine: 26, lines: span(26, 30) });
  });

  it("given the manifest of a module, when its lines are read, then they are served too (the file figures in the map)", async () => {
    const ctx = await withMap();

    const res = await code(ctx, {
      sha: ctx.sha,
      path: "web/package.json",
      start: "2",
      end: "2",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      firstLine: 1,
      lines: [
        "web-manifest 1",
        "web-manifest 2",
        "web-manifest 3",
        "web-manifest 4",
        "web-manifest 5",
      ],
    });
  });

  it("given the same lines read twice, when each request is made, then GitHub is read each time (no copy is kept), at the cited commit", async () => {
    const ctx = await withMap();
    const before = contentsReads(githubCalls(ctx.fetchMock)).length;
    const beforeAll = githubCalls(ctx.fetchMock).length;

    await code(ctx, cited(ctx, 18, 24));
    await code(ctx, cited(ctx, 18, 24));

    // The submit of withMap() already read the file once to verify its citation.
    const reads = githubCalls(ctx.fetchMock)
      .slice(beforeAll)
      .filter((c) => c.path.endsWith("/contents/api/src/db.ts"));
    expect(reads).toHaveLength(2);
    expect(reads.every((c) => c.search === `?ref=${ctx.sha}`)).toBe(true);
    expect(contentsReads(githubCalls(ctx.fetchMock)).length).toBeGreaterThan(
      before,
    );
  });

  it("given a file of the repo that the map does not cite, when it is asked for, then 404 and GitHub does not read it", async () => {
    const ctx = await withMap();
    const before = githubCalls(ctx.fetchMock).length;

    const res = await code(ctx, {
      sha: ctx.sha,
      path: "README.md",
      start: "1",
      end: "1",
    });

    expect(res.status).toBe(404);
    expect(githubCalls(ctx.fetchMock)).toHaveLength(before);
  });

  it("given a commit that is not the one of the map, when a cited file is asked for at it, then 404 and GitHub does not read it", async () => {
    const ctx = await withMap();
    const other = ctx.git.push({ "api/src/db.ts": "changed\n" });
    const before = githubCalls(ctx.fetchMock).length;

    const res = await code(ctx, { ...cited(ctx, 1, 1), sha: other });

    expect(res.status).toBe(404);
    expect(githubCalls(ctx.fetchMock)).toHaveLength(before);
  });

  it("given a project with no map, when any file is asked for, then 404", async () => {
    const ctx = await ready();
    expect((await read(ctx)).status, "the map route exists").toBe(200);

    expect((await code(ctx, cited(ctx, 1, 2))).status).toBe(404);
  });

  it("given a user who is not a member, when they ask for a cited file, then 404 and GitHub does not read it", async () => {
    const ctx = await withMap();
    const before = githubCalls(ctx.fetchMock).length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await code(ctx, cited(ctx, 18, 24), bob.cookie);

    expect(res.status).toBe(404);
    expect(githubCalls(ctx.fetchMock)).toHaveLength(before);
  });

  it("given no session, when a cited file is asked for, then 401", async () => {
    const ctx = await withMap();

    expect((await code(ctx, cited(ctx, 18, 24), "")).status).toBe(401);
  });

  it.each([
    ["no sha", (q: Record<string, string>) => ({ ...q, sha: "" })],
    [
      "a sha of 39 characters",
      (q: Record<string, string>) => ({ ...q, sha: q.sha?.slice(1) ?? "" }),
    ],
    [
      "a branch name instead of a sha",
      (q: Record<string, string>) => ({ ...q, sha: "main" }),
    ],
    ["no path", (q: Record<string, string>) => ({ ...q, path: "" })],
    ["a start of 0", (q: Record<string, string>) => ({ ...q, start: "0" })],
    [
      "a start that is not a number",
      (q: Record<string, string>) => ({ ...q, start: "x" }),
    ],
    [
      "a start after the end",
      (q: Record<string, string>) => ({ ...q, start: "25", end: "24" }),
    ],
    ["no end", (q: Record<string, string>) => ({ ...q, end: "" })],
  ])(
    "given %s, when the code is asked for, then 400 and GitHub does not read the file",
    async (_name, change) => {
      const ctx = await withMap();
      const before = githubCalls(ctx.fetchMock).length;

      const res = await code(ctx, change(cited(ctx, 18, 24)));

      expect(res.status).toBe(400);
      expect(githubCalls(ctx.fetchMock)).toHaveLength(before);
    },
  );
});

describe("decision 043 G, H: a failure of one row or one commit does not take the rest down", () => {
  const corrupt = (ctx: Ctx) =>
    ctx.db.execute(
      sql`insert into code_maps (project_id, module_path, module_name, module_kind, commit_sha, data, created_at)
          values (${ctx.projectId}, 'bad', 'Cassé', 'library', ${ctx.sha}, '{"manifest": 1}'::jsonb, now())`,
    );

  it("given a stored row that no longer fits the schema, when the map is read, then the row is skipped and the others come back", async () => {
    const ctx = await ready();
    expect((await submit(ctx, [webModule()])).isError).not.toBe(true);
    await corrupt(ctx);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const modules = await modulesOf(await read(ctx));

    expect(modules.map((m) => m.path)).toEqual(["web"]);
  });

  it("given a stored row that no longer fits the schema, when a cited file is asked for, then the other rows still answer", async () => {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);
    await corrupt(ctx);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await code(ctx, {
      sha: ctx.sha,
      path: "api/src/db.ts",
      start: "1",
      end: "1",
    });

    expect(res.status).toBe(200);
  });

  it("given a compare that fails with a 500 for one commit, when the map is read, then the map is served and that commit has commitsSince null", async () => {
    const ctx = await ready();
    expect((await submit(ctx, [webModule()])).isError).not.toBe(true);
    ctx.fetchMock.update({ failOn: (c) => c.path.includes("/compare/") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const modules = await modulesOf(await read(ctx));

    expect(modules.map((m) => [m.path, m.commitsSince])).toEqual([
      ["web", null],
    ]);
  });

  it("given a commit that vanished from GitHub, when a cited file is asked for, then 404 and not 502", async () => {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);
    ctx.fetchMock.update({
      failOn: (c) => (c.path.includes("/contents/") ? 404 : false),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await code(ctx, {
      sha: ctx.sha,
      path: "api/src/db.ts",
      start: "1",
      end: "1",
    });

    expect(res.status).toBe(404);
  });
});
