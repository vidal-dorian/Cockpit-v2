import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeGitRepoOptions, githubCalls } from "./test-github.ts";
import { rows, withProject } from "./test-mcp.ts";

// Slice E4 (decision 032): several teams per project, through `app.request()` against the fake GitHub that keeps a Git history.
//
// Pinned where the decision leaves it open:
// - GET /api/projects/:id/agents also answers `teams: [{ name, text }]` (decision 032 D); the other fields are those of 030 B and 031 G.
// - POST /api/projects/:id/team/apply { name, before, after } answers like the 031 route (200 { commitSha, pullRequest? }, 409 { error }, 400 for a bad body).
// - The health check goes through GET /api/projects/:id/health and reads the `agents` line.
// - Where the decision says "a name outside the format", the 400 is on the body: nothing is read or written on GitHub, no history entry.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const SKILL = ".claude/skills/dev-us/SKILL.md";
const teamText = (...agents: string[]) =>
  `---\nsteps:\n${agents.map((a) => `  - agent: ${a}\n    does: something`).join("\n")}\n---\nBody kept.\n`;
const TEAM = teamText("test-writer", "developer", "reviewer");
const LEGER = teamText("developer");
const LEGER2 = teamText("developer", "reviewer");
const teamPath = (name: string) => `.claude/teams/${name}.md`;
const READY: Record<string, string> = {
  "CLAUDE.md": "# Project",
  ".github/workflows/ci.yml": "name: ci",
  [SKILL]: "x",
  ".claude/agents/test-writer.md": "---\n---\n",
  ".claude/agents/developer.md": "---\n---\n",
  ".claude/agents/reviewer.md": "---\n---\n",
};

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(
  files: Record<string, string> = {},
  repo: FakeGitRepoOptions = {},
) {
  const ctx = await withProject({
    gitRepos: {
      [REPO]: { files: { "README.md": "# app\n", ...files }, ...repo },
    },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}

// The health check reads the snapshot stub (`files`), not a repo with a Git history.
async function readyForHealth(files: Record<string, string>) {
  const ctx = await withProject({ files });
  return { ...ctx, git: undefined as never };
}

const call = (ctx: Ctx, path: string, method: "GET" | "POST", body?: unknown) =>
  ctx.app.request(`/api/projects/${ctx.projectId}/${path}`, {
    method,
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const read = (ctx: Ctx) => call(ctx, "agents", "GET");
const apply = (ctx: Ctx, body: unknown) =>
  call(ctx, "team/apply", "POST", body);
const agentsLine = async (ctx: Ctx) => {
  const res = await call(ctx, "health", "GET");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    lines: { key: string; ok: boolean; detail: string }[];
  };
  return body.lines.find((l) => l.key === "agents");
};
const repoCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.startsWith("/repos/"));
const writeCalls = (ctx: Ctx) =>
  repoCalls(ctx).filter((c) => c.method !== "GET");
const historyOf = (ctx: Ctx, action: string) =>
  rows(ctx.db, sql`action = ${action}`) as Promise<
    {
      action: string;
      args: unknown;
      result: string;
      actor: string;
      origin: string;
    }[]
  >;
const historyCount = async (ctx: Ctx) =>
  (
    (await ctx.db.execute(
      sql`select count(*)::int as n from history where action in ('save_team', 'delete_team')`,
    )) as unknown as { rows: { n: number }[] }
  ).rows[0]?.n;

describe("decision 032 B: the skill /dev-us of the catalogue", () => {
  const skill = readFileSync(
    fileURLToPath(
      new URL("../../catalog/skills/dev-us/SKILL.md", import.meta.url),
    ),
    "utf8",
  );

  it("given the skill, when it is read, then --team <name> follows .claude/teams/<name>.md and stops, without the default team, when that file does not exist", () => {
    expect(skill).toContain("--team");
    expect(skill).toContain(".claude/teams/<name>.md");
    const near = skill.slice(skill.indexOf("--team"));
    expect(near).toMatch(/does not exist|is missing|not exist/i);
    expect(near).toMatch(/stop/i);
    expect(near).toMatch(
      /(never|not|without|no) .{0,40}(fall back|fallback|default team)|do not fall back/i,
    );
  });

  it("given the skill, when it is read, then without --team it is unchanged: team.md, else the three default steps", () => {
    expect(skill).toContain(".claude/team.md");
    expect(skill).toMatch(/without .{0,20}--team/i);
    expect(skill.indexOf("test-writer")).toBeLessThan(
      skill.indexOf("developer"),
    );
    expect(skill.indexOf("developer")).toBeLessThan(skill.indexOf("reviewer"));
  });
});

describe("decision 032 C: the agents line checks the named teams", () => {
  it("given the skill, the three agents and a valid .claude/teams/leger.md naming an existing agent, when the health is requested, then the agents line is green", async () => {
    const ctx = await readyForHealth({ ...READY, [teamPath("leger")]: LEGER });

    expect(await agentsLine(ctx)).toEqual({
      key: "agents",
      ok: true,
      detail: "ok",
    });
  });

  it("given a valid team.md naming only doc-writer and a named team naming it too, when the health is requested, then the agents line is green", async () => {
    const files = {
      ...READY,
      ".claude/agents/doc-writer.md": "x",
      ".claude/team.md": teamText("doc-writer"),
      [teamPath("docs")]: teamText("doc-writer"),
    };
    const ctx = await readyForHealth(files);

    expect(await agentsLine(ctx)).toEqual({
      key: "agents",
      ok: true,
      detail: "ok",
    });
  });

  it("given a named team naming an agent that has no file, when the health is requested, then the agents line is red with detail missing", async () => {
    const ctx = await readyForHealth({
      ...READY,
      [teamPath("leger")]: teamText("developer", "ghost"),
    });

    expect(await agentsLine(ctx)).toEqual({
      key: "agents",
      ok: false,
      detail: "missing",
    });
  });

  it("given a named team that cannot be read, when the health is requested, then the agents line is red with detail invalid_team", async () => {
    const ctx = await readyForHealth({
      ...READY,
      [teamPath("leger")]: "# not a team\n",
    });

    expect(await agentsLine(ctx)).toEqual({
      key: "agents",
      ok: false,
      detail: "invalid_team",
    });
  });

  it.each([
    ["an invalid name Leger.md", ".claude/teams/Leger.md"],
    ["a name starting with a dash", ".claude/teams/-x.md"],
    ["a file that is not .md", ".claude/teams/notes.txt"],
    ["a file in a sub-directory", ".claude/teams/old/inside.md"],
  ])(
    "given an unreadable file of .claude/teams with %s, when the health is requested, then it is ignored: green, and never read",
    async (_name, path) => {
      const ctx = await readyForHealth({ ...READY, [path]: "# not a team\n" });

      expect(await agentsLine(ctx)).toEqual({
        key: "agents",
        ok: true,
        detail: "ok",
      });
      expect(repoCalls(ctx).map((c) => c.path)).not.toContain(
        `/repos/${REPO}/contents/${path}`,
      );
    },
  );

  it("given a ready repo with .claude/teams/leger.md and docs.md, when the health is requested, then each team file is read once and no other tree is read than without teams", async () => {
    const ctx = await readyForHealth({
      ...READY,
      [teamPath("leger")]: LEGER,
      [teamPath("docs")]: LEGER,
    });

    await agentsLine(ctx);

    const paths = repoCalls(ctx).map((c) => c.path);
    for (const name of ["leger", "docs"])
      expect(
        paths.filter((p) => p === `/repos/${REPO}/contents/${teamPath(name)}`),
      ).toHaveLength(1);
    expect(paths.filter((p) => p.includes("/git/trees/"))).toHaveLength(3);
  });

  it("given a ready repo without .claude/teams, when the health is requested, then only the three tree reads of before are made (root, .claude, workflows) and no file is read", async () => {
    const ctx = await readyForHealth(READY);

    expect(await agentsLine(ctx)).toEqual({
      key: "agents",
      ok: true,
      detail: "ok",
    });
    const paths = repoCalls(ctx).map((c) => c.path);
    expect(paths.filter((p) => p.includes("/contents/"))).toEqual([]);
    expect(paths.filter((p) => p.includes("/git/trees/"))).toHaveLength(3);
  });
});

describe("decision 032 D: teams on GET /api/projects/:id/agents", () => {
  it("given three valid teams, an invalid name and a non-md file, when a member reads, then teams holds the valid ones sorted by name with their text, and the other fields stay", async () => {
    const ctx = await ready({
      ".claude/team.md": TEAM,
      [teamPath("zeta")]: LEGER,
      [teamPath("alpha")]: LEGER2,
      [teamPath("leger")]: LEGER,
      ".claude/teams/Leger.md": "bad\n",
      ".claude/teams/-x.md": "bad\n",
      ".claude/teams/notes.txt": "bad\n",
      ".claude/teams/old/inside.md": "bad\n",
    });

    const res = await read(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.teams).toEqual([
      { name: "alpha", text: LEGER2 },
      { name: "leger", text: LEGER },
      { name: "zeta", text: LEGER },
    ]);
    expect(body.team).toBe(TEAM);
    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("catalog");
    expect(writeCalls(ctx)).toEqual([]);
  });

  it("given a repo without .claude/teams, when a member reads, then teams is []", async () => {
    const ctx = await ready();

    const res = await read(ctx);

    expect(((await res.json()) as Record<string, unknown>).teams).toEqual([]);
  });

  it("given a symlink and a too large file named like teams, when a member reads, then their text is empty and the others are read", async () => {
    const ctx = await ready(
      { [teamPath("leger")]: LEGER },
      {
        entries: {
          [teamPath("link")]: { kind: "symlink" },
          [teamPath("big")]: { kind: "large" },
        },
      },
    );

    const res = await read(ctx);

    expect(((await res.json()) as Record<string, unknown>).teams).toEqual([
      { name: "big", text: "" },
      { name: "leger", text: LEGER },
      { name: "link", text: "" },
    ]);
  });
});

describe("decision 032 F, G: POST /api/projects/:id/team/apply with a name", () => {
  it("given no leger team, when { name: leger, before: null, after } is applied, then .claude/teams/leger.md is created by one commit feat: update the team leger (Cockpit) and a save_team entry holds its path", async () => {
    const ctx = await ready({ ".claude/team.md": TEAM });

    const res = await apply(ctx, { name: "leger", before: null, after: LEGER });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: update the team leger (Cockpit)",
    });
    const files = ctx.git.filesAt(ctx.git.head);
    expect(files?.[teamPath("leger")]).toBe(LEGER);
    expect(files?.[".claude/team.md"]).toBe(TEAM);
    expect(await historyOf(ctx, "save_team")).toMatchObject([
      {
        actor: "human",
        origin: "ui",
        result: "ok",
        args: { path: ".claude/teams/leger.md" },
      },
    ]);
  });

  it("given a leger team, when { name: leger, before, after } is applied, then the file is updated with the same message and history", async () => {
    const ctx = await ready({ [teamPath("leger")]: LEGER });

    const res = await apply(ctx, {
      name: "leger",
      before: LEGER,
      after: LEGER2,
    });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: update the team leger (Cockpit)",
    });
    expect(ctx.git.filesAt(ctx.git.head)?.[teamPath("leger")]).toBe(LEGER2);
    expect(await historyOf(ctx, "save_team")).toMatchObject([
      { result: "ok", args: { path: ".claude/teams/leger.md" } },
    ]);
  });

  it.each([
    ["no name", {}],
    ["name null", { name: null }],
  ])(
    "given %s, when the team is applied, then .claude/team.md is written with the message of 031 (unchanged)",
    async (_n, extra) => {
      const ctx = await ready({ ".claude/team.md": TEAM });

      const res = await apply(ctx, { ...extra, before: TEAM, after: LEGER });

      expect(res.status).toBe(200);
      expect(ctx.git.created.commits[0]).toMatchObject({
        message: "feat: update the team (Cockpit)",
      });
      expect(ctx.git.filesAt(ctx.git.head)?.[".claude/team.md"]).toBe(LEGER);
      expect(await historyOf(ctx, "save_team")).toMatchObject([
        { args: { path: ".claude/team.md" } },
      ]);
    },
  );

  it("given a name and an after that is not a readable team, when it is applied, then 400 with no GitHub call and no history", async () => {
    const ctx = await ready();

    const res = await apply(ctx, {
      name: "leger",
      before: null,
      after: "just text\n",
    });

    expect(res.status).toBe(400);
    expect(repoCalls(ctx)).toEqual([]);
    expect(await historyCount(ctx)).toBe(0);
  });
});

describe("decision 032 F, G: deleting a named team", () => {
  it("given a leger team, when { name: leger, before, after: null } is applied, then the file is removed by one commit feat: remove the team leger (Cockpit) and a delete_team entry holds its path", async () => {
    const ctx = await ready({
      ".claude/team.md": TEAM,
      [teamPath("leger")]: LEGER,
    });

    const res = await apply(ctx, { name: "leger", before: LEGER, after: null });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: remove the team leger (Cockpit)",
    });
    const files = ctx.git.filesAt(ctx.git.head);
    expect(files).not.toHaveProperty([teamPath("leger")]);
    expect(files?.[".claude/team.md"]).toBe(TEAM);
    expect(await historyOf(ctx, "delete_team")).toMatchObject([
      {
        actor: "human",
        origin: "ui",
        result: "ok",
        args: { path: ".claude/teams/leger.md" },
      },
    ]);
    expect(await historyOf(ctx, "save_team")).toEqual([]);
  });

  it("given a leger team changed on GitHub since it was read, when its removal is applied, then 409 repo_changed and the file stays", async () => {
    const ctx = await ready({ [teamPath("leger")]: LEGER });

    const res = await apply(ctx, {
      name: "leger",
      before: LEGER2,
      after: null,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.filesAt(ctx.git.head)?.[teamPath("leger")]).toBe(LEGER);
  });

  it.each([
    ["no name", {}],
    ["name null", { name: null }],
  ])(
    "given an after null with %s, when it is applied, then it stays a 400 and team.md is not deleted",
    async (_n, extra) => {
      const ctx = await ready({ ".claude/team.md": TEAM });

      const res = await apply(ctx, { ...extra, before: TEAM, after: null });

      expect(res.status).toBe(400);
      expect(writeCalls(ctx)).toEqual([]);
      expect(await historyCount(ctx)).toBe(0);
    },
  );
});

describe("decision 032 A, F: a name outside the format", () => {
  it.each([
    ["a path", "../x"],
    ["a capital", "Leger"],
    ["a leading dash", "-x"],
    ["an empty string", ""],
    ["a slash", "a/b"],
    ["a dot", "a.b"],
    ["241 characters", "a".repeat(241)],
    ["a number", 5],
    ["an array", ["leger"]],
    ["an object", {}],
  ])(
    "given %s as name, when a team is applied, then 400, no GitHub call and no history entry",
    async (_n, name) => {
      const ctx = await ready({ ".claude/team.md": TEAM });

      const res = await apply(ctx, { name, before: null, after: LEGER });

      expect(res.status).toBe(400);
      expect(repoCalls(ctx)).toEqual([]);
      expect(await historyCount(ctx)).toBe(0);
    },
  );

  it("given an invalid name and after null, when a removal is applied, then 400, no GitHub call and no history entry", async () => {
    const ctx = await ready();

    const res = await apply(ctx, { name: "../x", before: LEGER, after: null });

    expect(res.status).toBe(400);
    expect(repoCalls(ctx)).toEqual([]);
    expect(await historyCount(ctx)).toBe(0);
  });

  it("given a name of 240 characters, when a team is created, then it is accepted", async () => {
    const ctx = await ready();

    const name = "a".repeat(240);
    const res = await apply(ctx, { name, before: null, after: LEGER });

    expect(res.status).toBe(200);
    expect(ctx.git.filesAt(ctx.git.head)?.[teamPath(name)]).toBe(LEGER);
  });
});
