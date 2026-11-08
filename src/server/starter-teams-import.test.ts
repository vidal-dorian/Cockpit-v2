import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubCalls } from "./test-github.ts";
import { rows, seedProject, setup, userWithToken } from "./test-mcp.ts";

// Slice 11.6 (decision 063 D, H): the level chosen when a project is imported.
//
// Pinned where the decision leaves it open (the developer follows these):
// - POST /api/projects takes an optional `starterTeam`: "eco" | "standard" | "premium" | "max", default "standard"; anything else (a string, null, a number) is 400 and nothing is created.
// - The project is stored with `projects.starter_team` (text, CHECK, default 'standard', also for the rows that exist before the migration); the project JSON of the import answer
//   and of GET /api/projects carries `starterTeam`.
// - The `import_project` entry keeps `args: { projectId, starterTeam }`.
// - The import still writes nothing in the repo.

afterEach(() => {
  vi.unstubAllGlobals();
});

const repo = {
  id: 1,
  full_name: "user1000/app",
  default_branch: "main",
  private: false,
};

async function ready() {
  const ctx = await setup({ account: 1000, repositories: [repo] });
  const alice = await userWithToken(ctx.app, ctx.db, 1000);
  return { ...ctx, alice };
}
type Ctx = Awaited<ReturnType<typeof ready>>;
const importRepo = (ctx: Ctx, body: unknown) =>
  ctx.app.request("/api/projects", {
    method: "POST",
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const stored = async (ctx: Ctx) =>
  (
    (await ctx.db.execute(
      sql`select starter_team from projects order by id`,
    )) as unknown as { rows: { starter_team: string }[] }
  ).rows.map((r) => r.starter_team);

describe("decision 063 D: POST /api/projects with starterTeam", () => {
  it.each(["eco", "standard", "premium", "max"])(
    "given the level %s, when a repo is imported, then the project keeps it, the answer carries it and the import entry has it in its args",
    async (level) => {
      const ctx = await ready();

      const res = await importRepo(ctx, {
        githubRepoId: 1,
        starterTeam: level,
      });

      expect(res.status).toBe(201);
      const { project } = (await res.json()) as {
        project: { id: number; starterTeam: string };
      };
      expect(project.starterTeam).toBe(level);
      expect(await stored(ctx)).toEqual([level]);
      const entries = await rows(ctx.db, sql`action = 'import_project'`);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        result: "ok",
        args: { projectId: project.id, starterTeam: level },
      });
    },
  );

  it("given no starterTeam, when a repo is imported, then the level is standard, in the project and in the entry", async () => {
    const ctx = await ready();

    const res = await importRepo(ctx, { githubRepoId: 1 });

    expect(res.status).toBe(201);
    const { project } = (await res.json()) as {
      project: { id: number; starterTeam: string };
    };
    expect(project.starterTeam).toBe("standard");
    expect(await stored(ctx)).toEqual(["standard"]);
    expect(
      (await rows(ctx.db, sql`action = 'import_project'`))[0],
    ).toMatchObject({
      args: { projectId: project.id, starterTeam: "standard" },
    });
  });

  it.each([
    ["an unknown level", "gold"],
    ["a level in capitals", "ECO"],
    ["null", null],
    ["a number", 2],
    ["an empty string", ""],
  ])(
    "given %s as starterTeam, when a repo is imported, then 400 and nothing is created",
    async (_name, starterTeam) => {
      const ctx = await ready();

      const res = await importRepo(ctx, { githubRepoId: 1, starterTeam });

      expect(res.status).toBe(400);
      expect(await stored(ctx)).toEqual([]);
      expect(await rows(ctx.db, sql`action = 'import_project'`)).toEqual([]);
    },
  );

  it("given an import with a level, when it is done, then nothing was written in the repo (decision 063 D)", async () => {
    const ctx = await ready();

    const res = await importRepo(ctx, { githubRepoId: 1, starterTeam: "max" });

    expect(res.status).toBe(201);
    expect(
      githubCalls(ctx.fetchMock).filter(
        (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
      ),
    ).toEqual([]);
  });
});

describe("decision 063 D: projects.starter_team", () => {
  it("given a project created without a level (as every project before this slice), when it is listed, then its level is standard, and the column refuses any other value than the four", async () => {
    const ctx = await ready();
    await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 7,
      fullName: "user1000/old",
    });

    const res = await ctx.app.request("/api/projects", {
      headers: { cookie: ctx.alice.cookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { starterTeam: string }[] };
    expect(body.projects.map((p) => p.starterTeam)).toEqual(["standard"]);
    expect(await stored(ctx)).toEqual(["standard"]);
    await expect(
      ctx.db.execute(sql`update projects set starter_team = 'gold'`),
    ).rejects.toThrow();
  });
});
