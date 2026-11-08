import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeGitRepoOptions } from "./test-github.ts";
import { userWithToken, withProject } from "./test-mcp.ts";
import {
  agentCatalog,
  fromCatalog,
  LEVEL_IDS,
  LEVELS,
  type Level,
  modelOf,
  teamWritten,
  withModel,
} from "./test-starter-teams.ts";

// Slice 11.6 (decision 063 E, B, C): « Préparer pour Claude » writes the team of the project's level, and GET /api/starter-teams serves the four levels.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The plan of POST /api/projects/:id/prepare is today's plan (the files of the catalogue, CLAUDE.md under its rule) plus, for the level of the project:
//   * every agent of the team that is not in today's plan (doc-writer, doc-reviewer: Premium and Max), `create` with the catalogue text;
//   * the agents of the team with the model of the level (the `model:` line replaced, `withModel`); the agents outside the team (bug-hunter, cartographer, the reviewer of Éco...) keep the catalogue text;
//   * `.claude/team.md` with the file of the level without its model lines (`teamWritten`), for Éco, Premium and Max.
// - STANDARD WRITES NO team.md: without the file `/dev-us` already follows test-writer, developer, reviewer (decision 029 C), which is the Standard team, so a Standard plan is today's
//   plan with nothing added. The catalogue models (test-writer and developer sonnet, reviewer opus) are the Standard's, so the files of today's plan are the catalogue texts;
//   Premium adds doc-writer and doc-reviewer to that team, and Max puts every agent of its team in opus.
// - The apply route accepts these files (the plan went through the browser, decision 026 D): a `create` of a file of the level whose content is not the level's is 400.
// - GET /api/projects/:id... is not touched; GET /api/starter-teams (session required, 401 without) answers
//   `{ teams: [{ id, team, agents: [{ name, text }] }] }`, the four levels in the order eco, standard, premium, max; `team` is `teamWritten(level)`,
//   `agents` the agents of the team in the order of its steps, each with the catalogue text and the level's model.
// - The level of a project is read in the database (`projects.starter_team`), never taken from the request.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const TEAM = ".claude/team.md";
const TODAY = [
  ".claude/agents/test-writer.md",
  ".claude/agents/developer.md",
  ".claude/agents/reviewer.md",
  ".claude/skills/dev-us/SKILL.md",
  ".claude/skills/write-us/SKILL.md",
  ".claude/agents/cartographer.md",
  ".claude/skills/analyser/SKILL.md",
  ".claude/agents/rules-analyst.md",
  ".claude/agents/bug-hunter.md",
  ".claude/agents/security-reviewer.md",
  ".claude/agents/architect.md",
  ".claude/agents/upgrade-advisor.md",
  "CLAUDE.md",
];
const agentPath = (name: string) => `.claude/agents/${name}.md`;

type PlanFile = {
  path: string;
  content: string;
  status: string;
  current?: string;
};
type Plan = { baseSha: string; signature: string; files: PlanFile[] };

async function ready(level: Level, repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: { "README.md": "# app\n" }, ...repo } },
  });
  await ctx.db.execute(
    sql`update projects set starter_team = ${level} where id = ${ctx.projectId}`,
  );
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}
type Ctx = Awaited<ReturnType<typeof ready>>;
const post = (ctx: Ctx, path: string, body?: unknown) =>
  ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
    method: "POST",
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function planOf(ctx: Ctx) {
  const res = await post(ctx, "/prepare");
  expect(res.status, "the plan must be served").toBe(200);
  return ((await res.json()) as { plan: Plan }).plan;
}
const file = (plan: Plan, path: string) =>
  plan.files.find((f) => f.path === path);
const paths = (plan: Plan) => plan.files.map((f) => f.path).sort();
const teamAgents = (level: Level) => LEVELS[level].map((s) => s.agent);
/** The agents of the plan that are not in today's plan. */
const extras = (level: Level) =>
  teamAgents(level)
    .map(agentPath)
    .filter((p) => !TODAY.includes(p));

describe("decision 063 E: the plan of « Préparer pour Claude » by level", () => {
  it("given a Standard project, when the plan is read, then it is today's plan, with no team.md and the Standard models (test-writer and developer sonnet, reviewer opus: the catalogue's)", async () => {
    const ctx = await ready("standard");

    const plan = await planOf(ctx);

    expect(paths(plan)).toEqual([...TODAY].sort());
    expect(plan.files.every((f) => f.status === "create")).toBe(true);
    for (const { agent, model } of LEVELS.standard) {
      expect(modelOf(file(plan, agentPath(agent))?.content ?? ""), agent).toBe(
        model,
      );
      expect(file(plan, agentPath(agent))?.content).toBe(agentCatalog(agent));
    }
  });

  it.each(["eco", "premium", "max"] as const)(
    "given a %s project, when the plan is read, then it holds today's files, the extra agents of the team and .claude/team.md, all create",
    async (level) => {
      const ctx = await ready(level);

      const plan = await planOf(ctx);

      expect(paths(plan)).toEqual([...TODAY, ...extras(level), TEAM].sort());
      expect(plan.files.every((f) => f.status === "create")).toBe(true);
      expect(file(plan, TEAM)?.content).toBe(teamWritten(level));
    },
  );

  it.each(LEVEL_IDS)(
    "given a %s project, when the plan is read, then each agent of the team has the model of the level and the text of the catalogue, and the other agents keep the catalogue's",
    async (level) => {
      const ctx = await ready(level);

      const plan = await planOf(ctx);

      for (const { agent, model } of LEVELS[level])
        expect(file(plan, agentPath(agent))?.content, agent).toBe(
          withModel(agentCatalog(agent), model),
        );
      for (const other of ["bug-hunter", "cartographer", "architect"])
        if (!teamAgents(level).includes(other))
          expect(file(plan, agentPath(other))?.content, other).toBe(
            agentCatalog(other),
          );
      if (!teamAgents(level).includes("reviewer"))
        expect(file(plan, agentPath("reviewer"))?.content).toBe(
          agentCatalog("reviewer"),
        );
    },
  );

  it("given a repo with a developer changed by hand and a team.md of its own, when the plan of a Max project is read, then both are exists with the repo's text and the rest is create", async () => {
    const ctx = await ready("max", {
      files: {
        "README.md": "# app\n",
        [agentPath("developer")]: "my own developer\nmodel: haiku\n",
        [TEAM]: '---\nsteps:\n  - agent: developer\n    does: "mine"\n---\n',
      },
    });

    const plan = await planOf(ctx);

    expect(file(plan, agentPath("developer"))).toMatchObject({
      status: "exists",
      current: "my own developer\nmodel: haiku\n",
    });
    expect(file(plan, TEAM)).toMatchObject({ status: "exists" });
    expect(file(plan, agentPath("doc-writer"))?.status).toBe("create");
    expect(file(plan, agentPath("test-writer"))?.status).toBe("create");
  });

  it("given a repo that already holds the team.md of the level, when the plan is read, then it is same", async () => {
    const ctx = await ready("premium", {
      files: { "README.md": "# app\n", [TEAM]: teamWritten("premium") },
    });

    expect(file(await planOf(ctx), TEAM)?.status).toBe("same");
  });
});

describe("decision 063 E: applying the plan", () => {
  it.each(["eco", "premium", "max"] as const)(
    "given a %s project and an empty repo, when the plan is applied, then one commit writes the agents with the level's models and .claude/team.md",
    async (level) => {
      const ctx = await ready(level);
      const plan = await planOf(ctx);

      const res = await post(ctx, "/prepare/apply", { plan });

      expect(res.status).toBe(200);
      expect(ctx.git.created.commits).toHaveLength(1);
      const written = ctx.git.filesAt(ctx.git.head) ?? {};
      expect(written[TEAM]).toBe(teamWritten(level));
      for (const { agent, model } of LEVELS[level])
        expect(written[agentPath(agent)], agent).toBe(
          withModel(agentCatalog(agent), model),
        );
    },
  );

  it("given a Max project with a developer changed by hand and a team.md of its own, when the plan is applied, then both stay as they are in the repo, model line included", async () => {
    const mine = "my own developer\nmodel: haiku\n";
    const team = '---\nsteps:\n  - agent: developer\n    does: "mine"\n---\n';
    const ctx = await ready("max", {
      files: {
        "README.md": "# app\n",
        [agentPath("developer")]: mine,
        [TEAM]: team,
      },
    });
    const plan = await planOf(ctx);

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(200);
    const written = ctx.git.filesAt(ctx.git.head) ?? {};
    expect(written[agentPath("developer")]).toBe(mine);
    expect(written[TEAM]).toBe(team);
    expect(written[agentPath("doc-writer")]).toBeDefined();
  });

  it("given a Premium project, when a plan with a team.md that is not the level's is applied, then 400 and nothing is written", async () => {
    const ctx = await ready("premium");
    const plan = await planOf(ctx);
    const forged = {
      ...plan,
      files: plan.files.map((f) =>
        f.path === TEAM ? { ...f, content: teamWritten("eco") } : f,
      ),
    };

    const res = await post(ctx, "/prepare/apply", { plan: forged });

    expect(res.status).toBe(400);
    expect(ctx.git.created.commits).toHaveLength(0);
  });

  it("given a Premium project, when a plan with a doc-writer that is not the catalogue's text with the level's model is applied, then 400 and nothing is written", async () => {
    const ctx = await ready("premium");
    const plan = await planOf(ctx);
    const forged = {
      ...plan,
      files: plan.files.map((f) =>
        f.path === agentPath("doc-writer") ? { ...f, content: "evil\n" } : f,
      ),
    };

    const res = await post(ctx, "/prepare/apply", { plan: forged });

    expect(res.status).toBe(400);
    expect(ctx.git.created.commits).toHaveLength(0);
  });
});

describe("decision 063 review S1: a non-member is answered 404 before any validation", () => {
  it.each(LEVEL_IDS)(
    "given a %s project and a forged plan, when a user who is not a member applies it, then 404 whatever the level, and nothing is written; the plan route is 404 too",
    async (level) => {
      const ctx = await ready(level);
      const plan = await planOf(ctx);
      const forged = {
        ...plan,
        files: [
          { path: TEAM, content: "evil\n", status: "create" },
          ...plan.files,
        ],
      };
      const bob = await userWithToken(ctx.app, ctx.db, 2000);
      const asBob = (path: string, body?: unknown) =>
        ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
          method: "POST",
          headers: { cookie: bob.cookie, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

      expect((await asBob("/prepare/apply", { plan: forged })).status).toBe(
        404,
      );
      expect((await asBob("/prepare")).status).toBe(404);
      expect(ctx.git.created.commits).toHaveLength(0);
    },
  );
});

describe("decision 063 B, C: GET /api/starter-teams", () => {
  it("given a session, when the starter teams are read, then the four levels come in order, each with its team.md and the agents of its steps with the level's model", async () => {
    const ctx = await ready("standard");

    const res = await ctx.app.request("/api/starter-teams", {
      headers: { cookie: ctx.alice.cookie },
    });

    expect(res.status).toBe(200);
    const { teams } = (await res.json()) as {
      teams: {
        id: string;
        team: string;
        agents: { name: string; text: string }[];
      }[];
    };
    expect(teams.map((t) => t.id)).toEqual([
      "eco",
      "standard",
      "premium",
      "max",
    ]);
    for (const t of teams) {
      const level = t.id as Level;
      expect(t.team).toBe(teamWritten(level));
      expect(t.agents).toEqual(
        LEVELS[level].map(({ agent, model }) => ({
          name: agent,
          text: withModel(agentCatalog(agent), model),
        })),
      );
    }
  });

  it("given no session, when the starter teams are read, then 401", async () => {
    const ctx = await ready("standard");

    const res = await ctx.app.request("/api/starter-teams");

    expect(res.status).toBe(401);
  });
});

describe("decision 063 C: the dev-us skill and the catalogue agents stay consistent", () => {
  it("given the catalogue reviewer, when its model is read, then it is opus, the Standard's (decision 063 A)", () => {
    expect(modelOf(fromCatalog("agents/reviewer.md"))).toBe("opus");
  });
});
