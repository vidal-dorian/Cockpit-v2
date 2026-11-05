import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubCalls } from "./test-github.ts";
import {
  seedStory,
  seedTicket,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 7.2 (decision 034 C): GET /api/projects/:id/branches, a read as the App, and the `branch` of a story on GET /api/stories/:id (what the window of the story reads).
//
// Pinned where the decision leaves it open:
// - 200 { branches: string[] } (names only, the default branch included, GitHub's order); 404 { error } for a non-member or an unknown project; 401 without a session; 502 when GitHub fails.
// - GET /api/stories/:id answers story.branch: the branch of the story (decision 033 A), null while no run started.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";

async function ready() {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: { "README.md": "# app\n" } } },
  });
  const git = ctx.fetchMock.git(REPO);
  git._otherBranches.set("us/1-x", git.head);
  return { ...ctx, git };
}
type Ctx = Awaited<ReturnType<typeof ready>>;

const read = (
  ctx: Ctx,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => ctx.app.request(`/api/projects/${id}/branches`, { headers: { cookie } });
const historyCount = async (ctx: Ctx) =>
  (
    (await ctx.db.execute(
      sql`select count(*)::int as n from history where action <> 'create_token'`,
    )) as unknown as { rows: { n: number }[] }
  ).rows[0]?.n;

describe("criterion 12: GET /api/projects/:id/branches", () => {
  it("given a repo with a branch us/1-x, when a member reads the branches, then { branches: [main, us/1-x] } is answered from GET /repos/{owner}/{repo}/branches as the App, and nothing is written to the history", async () => {
    const ctx = await ready();

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branches: ["main", "us/1-x"] });
    const calls = githubCalls(ctx.fetchMock).filter(
      (c) => c.path === `/repos/${REPO}/branches`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.authorization).toMatch(/ghs_x/);
    expect(await historyCount(ctx)).toBe(0);
  });

  it("given another user, when they read the branches of that project, then 404 and GitHub is not called", async () => {
    const ctx = await ready();
    expect((await read(ctx)).status).toBe(200);
    const known = githubCalls(ctx.fetchMock).length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await read(ctx, ctx.projectId, bob.cookie);

    expect(res.status).toBe(404);
    expect(githubCalls(ctx.fetchMock)).toHaveLength(known);
  });

  it("given an unknown project, when the branches are read, then 404", async () => {
    const ctx = await ready();
    expect((await read(ctx)).status).toBe(200);

    const res = await read(ctx, 99999);

    expect(res.status).toBe(404);
  });

  it("given no session, when the branches are read, then 401", async () => {
    const ctx = await ready();

    const res = await read(ctx, ctx.projectId, "");

    expect(res.status).toBe(401);
  });

  it("given GitHub that fails, when the branches are read, then 502 and nothing is written to the history", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({ failOn: (c) => c.path.endsWith("/branches") });

    const res = await read(ctx);

    expect(res.status).toBe(502);
    expect(await historyCount(ctx)).toBe(0);
  });
});

describe("criterion 5: story.branch on GET /api/stories/:id", () => {
  it("given a story that has a branch and one that has none, when they are read, then story.branch is the name, then null", async () => {
    const ctx = await ready();
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "idée");
    const withBranch = await seedStory(ctx.db, ticketId, { status: "ready" });
    const without = await seedStory(ctx.db, ticketId, { status: "ready" });
    await ctx.db.execute(
      sql`update user_stories set branch = 'us/1-x' where id = ${withBranch}`,
    );
    const get = async (id: number) =>
      (
        (await (
          await ctx.app.request(`/api/stories/${id}`, {
            headers: { cookie: ctx.alice.cookie },
          })
        ).json()) as { story: { branch?: string | null } }
      ).story.branch;

    expect(await get(withBranch)).toBe("us/1-x");
    expect(await get(without)).toBeNull();
  });
});
