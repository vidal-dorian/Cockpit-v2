import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeGitRepoOptions, githubCalls } from "./test-github.ts";
import { type Row, rows, withProject } from "./test-mcp.ts";

// Slice 11.6 (decision 063 F, H): « Repartir d'une équipe de départ » saves through the existing team route, in one commit.
//
// Pinned where the decision leaves it open (the developer follows these):
// - POST /api/projects/:id/team/apply keeps `{ name?, before, after }` and gains two optional fields:
//   * `agents`: `[{ name, before, after }]`, at most one entry per agent, `name` in the format of decision 029 B, `after` a text (never null), `before` the text in the repo (null for an agent to add);
//     the files `.claude/agents/<name>.md` are written in the same commit as the team file, message `feat: update the team and its agents (Cockpit)` when `agents` is not empty (S4), else the usual `feat: update the team (Cockpit)`;
//   * (B1) `before === after` is accepted when `agents` is not empty: only the agent files change (team.md is not touched), still 400 with no agent;
//   * (S2) `starterTeam` is for the default team only: with `name` or with `after: null` it is 400.
//   * `starterTeam`: "eco" | "standard" | "premium" | "max" (else 400, nothing written).
// - The `save_team` entry keeps `args: { path }` and gains `starterTeam` when it was sent (and only then); no agent text in the args.
// - The project's `starter_team` becomes `starterTeam` in the transaction of the `ok` entry, so a refused or failed write changes nothing.
// - A `before` that is not the text in the repo (the team file or an agent) is the existing `repo_changed` 409, and nothing is written.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const TEAM_PATH = ".claude/team.md";
const OLD_TEAM = `---
steps:
  - agent: test-writer
    does: "writes the tests"
  - agent: developer
    does: "implements"
  - agent: reviewer
    does: "reviews the diff"
    loop_to: developer
    until: "the verdict is ready"
---
`;
const OLD_REVIEWER = "---\nname: reviewer\nmodel: sonnet\n---\nMy reviewer.\n";
const NEW_REVIEWER = OLD_REVIEWER.replace("sonnet", "opus");

async function ready(repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: {
      [REPO]: {
        files: {
          "README.md": "# app\n",
          [TEAM_PATH]: OLD_TEAM,
          ".claude/agents/reviewer.md": OLD_REVIEWER,
        },
        ...repo,
      },
    },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}
type Ctx = Awaited<ReturnType<typeof ready>>;
const apply = (ctx: Ctx, body: unknown) =>
  ctx.app.request(`/api/projects/${ctx.projectId}/team/apply`, {
    method: "POST",
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const level = async (ctx: Ctx) =>
  (
    (await ctx.db.execute(
      sql`select starter_team from projects where id = ${ctx.projectId}`,
    )) as unknown as { rows: { starter_team: string }[] }
  ).rows[0]?.starter_team;
const writes = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
  );
// Inline texts, not the catalogue's: this file tests the route, whatever the catalogue holds.
const PREMIUM_TEAM = `---
steps:
  - agent: test-writer
    does: "writes the tests"
  - agent: developer
    does: "implements"
  - agent: reviewer
    does: "reviews the diff"
    loop_to: developer
    until: "the verdict is ready"
  - agent: doc-writer
    does: "updates the docs"
---
`;
const docWriter = () =>
  "---\nname: doc-writer\nmodel: sonnet\n---\nWrites the docs.\n";
const body = (overrides: Record<string, unknown> = {}) => ({
  before: OLD_TEAM,
  after: PREMIUM_TEAM,
  starterTeam: "premium",
  agents: [
    { name: "doc-writer", before: null, after: docWriter() },
    { name: "reviewer", before: OLD_REVIEWER, after: NEW_REVIEWER },
  ],
  ...overrides,
});

describe("decision 063 F: the team and its agents in one commit", () => {
  it("given a repo with a team and a reviewer, when a Premium start is saved, then one commit writes team.md, the new doc-writer and the reviewer with its new model, and the project's level becomes premium", async () => {
    const ctx = await ready();
    const base = ctx.git.head;

    const res = await apply(ctx, body());

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: update the team and its agents (Cockpit)",
      parents: [base],
    });
    const written = ctx.git.filesAt(ctx.git.head) ?? {};
    expect(written[TEAM_PATH]).toBe(PREMIUM_TEAM);
    expect(written[".claude/agents/doc-writer.md"]).toBe(docWriter());
    expect(written[".claude/agents/reviewer.md"]).toBe(NEW_REVIEWER);
    expect(await level(ctx)).toBe("premium");
  });

  it("given the same save, when it is done, then one save_team entry holds the path and the starterTeam, and no agent text", async () => {
    const ctx = await ready();

    const res = await apply(ctx, body());

    expect(res.status).toBe(200);
    const found = (await rows(ctx.db, sql`action = 'save_team'`)) as (Row & {
      github_effects: unknown;
    })[];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      project_id: ctx.projectId,
      args: { path: TEAM_PATH, starterTeam: "premium" },
      result: "ok",
    });
    expect(JSON.stringify(found[0])).not.toContain("My reviewer");
    expect(JSON.stringify(found[0])).not.toContain("doc-writer");
  });

  it("given a repo without team.md, when a start is saved with before: null, then the file is created with the agents", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        ".claude/agents/reviewer.md": OLD_REVIEWER,
      },
    });

    const res = await apply(ctx, body({ before: null }));

    expect(res.status).toBe(200);
    expect(ctx.git.filesAt(ctx.git.head)?.[TEAM_PATH]).toBe(PREMIUM_TEAM);
    expect(
      ctx.git.filesAt(ctx.git.head)?.[".claude/agents/doc-writer.md"],
    ).toBe(docWriter());
  });

  it("given a save without starterTeam, when it is done, then the entry has the path only and the project's level is unchanged", async () => {
    const ctx = await ready();

    const res = await apply(ctx, {
      before: OLD_TEAM,
      after: PREMIUM_TEAM,
    });

    expect(res.status).toBe(200);
    const [entry] = await rows(ctx.db, sql`action = 'save_team'`);
    expect(entry?.args).toEqual({ path: TEAM_PATH });
    expect(await level(ctx)).toBe("standard");
  });
});

describe("decision 063 F: what is refused", () => {
  it.each([
    ["a level that does not exist", { starterTeam: "gold" }],
    ["a level that is null", { starterTeam: null }],
    [
      "an agent whose name climbs out of the folder",
      { agents: [{ name: "../x", before: null, after: "x\n" }] },
    ],
    [
      "an agent removed (after null)",
      { agents: [{ name: "reviewer", before: OLD_REVIEWER, after: null }] },
    ],
    [
      "the same agent twice",
      {
        agents: [
          { name: "doc-writer", before: null, after: "doc\n" },
          { name: "doc-writer", before: null, after: "doc\n" },
        ],
      },
    ],
    [
      "an agent that does not change",
      {
        agents: [
          { name: "reviewer", before: OLD_REVIEWER, after: OLD_REVIEWER },
        ],
      },
    ],
    ["agents that is not a list", { agents: "doc-writer" }],
    ["a team that parseTeam does not read", { after: "not a team" }],
  ])(
    "given %s, when the start is saved, then 400, nothing is written and the level is unchanged",
    async (_name, overrides) => {
      const ctx = await ready();

      const res = await apply(ctx, body(overrides));

      expect(res.status).toBe(400);
      expect(writes(ctx)).toEqual([]);
      expect(await level(ctx)).toBe("standard");
    },
  );

  it("given a reviewer that changed on GitHub meanwhile, when the start is saved, then 409 repo_changed, no commit, no entry ok and the level is unchanged", async () => {
    const ctx = await ready();
    ctx.git.push(
      { ".claude/agents/reviewer.md": "pushed meanwhile\n" },
      "push",
    );
    const commits = ctx.git.created.commits.length;

    const res = await apply(ctx, body());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "repo_changed" });
    expect(ctx.git.created.commits).toHaveLength(commits);
    expect(await level(ctx)).toBe("standard");
    expect(
      (await rows(ctx.db, sql`action = 'save_team'`)).map((r) => r.result),
    ).toEqual(["refused"]);
  });

  it("given an error of GitHub during the write, when the start is saved, then 502 and the level is unchanged", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (call) =>
        call.method === "POST" && call.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, body());

    expect(res.status).toBe(502);
    expect(await level(ctx)).toBe("standard");
  });

  it("given three agents missing from the repo, when the start is saved, then they are all written in the same commit", async () => {
    const ctx = await ready();
    const agents = ["doc-writer", "doc-reviewer", "security-reviewer"].map(
      (name) => ({
        name,
        before: null,
        after: `---\nname: ${name}\nmodel: opus\n---\nBody.\n`,
      }),
    );

    const res = await apply(ctx, {
      before: OLD_TEAM,
      after: PREMIUM_TEAM,
      starterTeam: "max",
      agents,
    });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(
      ctx.git.filesAt(ctx.git.head)?.[".claude/agents/security-reviewer.md"],
    ).toContain("opus");
    expect(await level(ctx)).toBe("max");
  });
});

describe("decision 063 review: B1, S2, S4", () => {
  it("B1: given a team.md already equal to the level's text and a reviewer changed by hand, when only the agents are saved (before === after), then 200, one commit writes the agent files only and the level is saved", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        [TEAM_PATH]: PREMIUM_TEAM,
        ".claude/agents/reviewer.md": OLD_REVIEWER,
      },
    });
    const teamBlob = ctx.git.filesAt(ctx.git.head)?.[TEAM_PATH];

    const res = await apply(
      ctx,
      body({ before: PREMIUM_TEAM, after: PREMIUM_TEAM }),
    );

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits).toHaveLength(1);
    const written = ctx.git.filesAt(ctx.git.head) ?? {};
    expect(written[TEAM_PATH]).toBe(teamBlob);
    expect(written[".claude/agents/reviewer.md"]).toBe(NEW_REVIEWER);
    expect(written[".claude/agents/doc-writer.md"]).toBe(docWriter());
    expect(await level(ctx)).toBe("premium");
  });

  it.each([
    ["no agents", {}],
    ["an empty list", { agents: [] }],
  ])(
    "B1: given before === after and %s, when it is saved, then still 400 and nothing is written",
    async (_name, extra) => {
      const ctx = await ready({
        files: { "README.md": "# app\n", [TEAM_PATH]: PREMIUM_TEAM },
      });

      const res = await apply(ctx, {
        before: PREMIUM_TEAM,
        after: PREMIUM_TEAM,
        starterTeam: "premium",
        ...extra,
      });

      expect(res.status).toBe(400);
      expect(writes(ctx)).toEqual([]);
    },
  );

  it.each([
    ["a named team", { name: "leger", before: null }],
    ["a removal", { name: "leger", before: PREMIUM_TEAM, after: null }],
  ])(
    "S2: given starterTeam with %s, when it is saved, then 400, nothing is written and the level is unchanged",
    async (_name, overrides) => {
      const ctx = await ready({
        files: {
          "README.md": "# app\n",
          [TEAM_PATH]: OLD_TEAM,
          ".claude/teams/leger.md": PREMIUM_TEAM,
          ".claude/agents/reviewer.md": OLD_REVIEWER,
        },
      });

      const res = await apply(ctx, body(overrides));

      expect(res.status).toBe(400);
      expect(writes(ctx)).toEqual([]);
      expect(await level(ctx)).toBe("standard");
    },
  );

  it("S4: given a save without agents, when it is done, then the message is the usual feat: update the team (Cockpit)", async () => {
    const ctx = await ready();

    const res = await apply(ctx, { before: OLD_TEAM, after: PREMIUM_TEAM });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits[0]?.message).toBe(
      "feat: update the team (Cockpit)",
    );
  });
});
