import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { type FakeGitRepoOptions, githubCalls } from "./test-github.ts";
import { testAppOptions } from "./test-instance.ts";
import {
  archiveProject,
  type Row,
  rows,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice E3 (decision 031 G to I): `team` on the agents route and POST /api/projects/:id/team/apply, through `app.request()` against the fake GitHub.
//
// Pinned where the decision leaves it open (same shapes as agents.test.ts):
// - GET /api/projects/:id/agents also answers `team`: the text of .claude/team.md, null without the file.
// - POST /api/projects/:id/team/apply { before, after } answers 200 { commitSha, pullRequest?: { number, url } }; a refusal is 409 { error: "<code>" }
//   (`pull_request_forbidden` also carries `appSettingsUrl`); a GitHub error is 502; refused entries hold detail { reason: <code> }, error entries detail { reason: "error" }.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const PATH = ".claude/team.md";
const TEAM = `---
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
Body kept.
`;
const TEAM2 = TEAM.replace('"implements"', '"implements it"');
const PROTECTED = {
  status: 403,
  message: "Protected branch update failed for refs/heads/main",
};
const NO_PULL_REQUEST_RIGHT = {
  status: 403,
  message: "Resource not accessible by integration",
};

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(repo: FakeGitRepoOptions = {}, withTeam = true) {
  const ctx = await withProject({
    gitRepos: {
      [REPO]: {
        files: { "README.md": "# app\n", ...(withTeam && { [PATH]: TEAM }) },
        ...repo,
      },
    },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}

const request = (
  ctx: Pick<Ctx, "app">,
  cookie: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) =>
  ctx.app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const read = (ctx: Ctx) =>
  request(
    ctx,
    ctx.alice.cookie,
    `/api/projects/${ctx.projectId}/agents`,
    "GET",
  );
const apply = (
  ctx: Ctx,
  body: unknown,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => request(ctx, cookie, `/api/projects/${id}/team/apply`, "POST", body);

const writeCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
  );
const repoCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.startsWith("/repos/"));
const teamRows = (ctx: Ctx) =>
  rows(ctx.db, sql`action = 'save_team'`) as Promise<
    (Row & { github_effects: unknown })[]
  >;
const teamRowCount = async (ctx: Ctx) =>
  (
    (await ctx.db.execute(
      sql`select count(*)::int as n from history where action = 'save_team'`,
    )) as unknown as { rows: { n: number }[] }
  ).rows[0]?.n;

describe("decision 031 G: team on GET /api/projects/:id/agents", () => {
  it("given a repo with .claude/team.md, when a member reads the agents, then team is the exact text of the file", async () => {
    const ctx = await ready();

    const res = await read(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.team).toBe(TEAM);
    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("catalog");
  });

  it("given a repo without .claude/team.md, when a member reads the agents, then team is null", async () => {
    const ctx = await ready({}, false);

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).team).toBeNull();
  });
});

describe("decision 031 H, I: POST /api/projects/:id/team/apply", () => {
  it("given a member and an unchanged repo, when the team is updated, then .claude/team.md is written by one commit feat: update the team (Cockpit) and a save_team entry without does or until text is written", async () => {
    const ctx = await ready();
    const base = ctx.git.head;

    const res = await apply(ctx, { before: TEAM, after: TEAM2 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { commitSha: string };
    expect(body.commitSha).toBe(ctx.git.head);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: update the team (Cockpit)",
      parents: [base],
    });
    expect(ctx.git.filesAt(ctx.git.head)?.[PATH]).toBe(TEAM2);
    const found = await teamRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      token_id: null,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      action: "save_team",
      args: { path: PATH },
      result: "ok",
      github_effects: { commitSha: body.commitSha, pullRequest: null },
    });
    const text = JSON.stringify(found[0]);
    expect(text).not.toContain("implements it");
    expect(text).not.toContain("the verdict is ready");
  });

  it("given an absent file, when { before: null, after } is applied, then the file is created", async () => {
    const ctx = await ready({}, false);

    const res = await apply(ctx, { before: null, after: TEAM });

    expect(res.status).toBe(200);
    expect(ctx.git.filesAt(ctx.git.head)?.[PATH]).toBe(TEAM);
    expect(await teamRows(ctx)).toMatchObject([
      { action: "save_team", args: { path: PATH }, result: "ok" },
    ]);
  });

  it("given a protected default branch, when the team is updated, then the answer gives the pull request and the entry holds its number", async () => {
    const ctx = await ready({ refUpdateFailure: PROTECTED });

    const res = await apply(ctx, { before: TEAM, after: TEAM2 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      pullRequest: { number: number; url: string };
    };
    expect(body.pullRequest).toEqual({
      number: 1,
      url: "https://github.com/user1000/app/pull/1",
    });
    expect((await teamRows(ctx))[0]).toMatchObject({
      result: "ok",
      github_effects: { commitSha: body.commitSha, pullRequest: 1 },
    });
  });

  it.each([
    ["no body", undefined],
    ["a body that is not an object", "x"],
    ["no before", { after: TEAM2 }],
    ["no after", { before: TEAM }],
    ["an after null", { before: TEAM, after: null }],
    ["before equal to after", { before: TEAM, after: TEAM }],
    ["an after without front matter", { before: TEAM, after: "just text\n" }],
    [
      "a quoted agent name",
      {
        before: TEAM,
        after: TEAM.replace("agent: developer", 'agent: "developer"'),
      },
    ],
    [
      "a step whose first key is not agent",
      {
        before: TEAM,
        after: "---\nsteps:\n  - does: x\n    agent: developer\n---\n",
      },
    ],
    [
      "an after over 1 MiB",
      { before: null, after: `${TEAM}${"x".repeat(1_048_577)}` },
    ],
    ["a before that is a number", { before: 1, after: TEAM2 }],
    ["an after that is a number", { before: TEAM, after: 2 }],
  ])(
    "given %s, when it is applied, then 400, nothing is written to GitHub and no history entry",
    async (_name, body) => {
      const ctx = await ready();

      const res = await apply(ctx, body);

      expect(res.status).toBe(400);
      expect(repoCalls(ctx)).toEqual([]);
      expect(await teamRowCount(ctx)).toBe(0);
    },
  );

  it.each([
    [
      "repo_changed",
      (ctx: Ctx) => {
        ctx.git.push({ [PATH]: "theirs\n" });
      },
      {},
    ],
    ["empty_repo", () => {}, { empty: true }],
    [
      "repo_unreachable",
      (ctx: Ctx) => {
        ctx.git.unreachable = true;
      },
      {},
    ],
    [
      "pull_request_forbidden",
      () => {},
      {
        refUpdateFailure: PROTECTED,
        pullRequestFailure: NO_PULL_REQUEST_RIGHT,
      },
    ],
  ])(
    "given a repo refused with %s, when the team is updated, then 409 with that code and one refused save_team entry with no GitHub effect",
    async (code, mutate, repo: FakeGitRepoOptions) => {
      const ctx = await ready(repo);
      if (!repo.empty) mutate(ctx);

      const res = await apply(ctx, { before: TEAM, after: TEAM2 });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(
        code === "pull_request_forbidden"
          ? {
              error: code,
              appSettingsUrl: "https://github.com/settings/apps/cockpit-test",
            }
          : { error: code },
      );
      const found = await teamRows(ctx);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        action: "save_team",
        result: "refused",
        detail: { reason: code },
        github_effects: null,
      });
    },
  );

  it("given an archived project, when the team is updated, then 409 project_archived, nothing is written and a refused entry is recorded", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await apply(ctx, { before: TEAM, after: TEAM2 });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(writeCalls(ctx)).toEqual([]);
    expect(await teamRows(ctx)).toMatchObject([
      { result: "refused", detail: { reason: "project_archived" } },
    ]);
  });

  it("given another user's project, when the team is updated, then 404 with a refused entry and nothing written", async () => {
    const ctx = await ready();
    // The route exists and serves the owner (a missing route also answers 404).
    expect((await apply(ctx, { before: TEAM, after: TEAM2 })).status).toBe(200);
    const known = writeCalls(ctx).length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await apply(
      ctx,
      { before: TEAM2, after: TEAM },
      ctx.projectId,
      bob.cookie,
    );

    expect(res.status).toBe(404);
    expect(writeCalls(ctx)).toHaveLength(known);
    expect(
      (await teamRows(ctx)).filter((r) => r.result === "refused"),
    ).toHaveLength(1);
  });

  it("given GitHub that fails while the commit is made, when the team is updated, then 502 and one error entry with the closed reason error", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.method === "POST" && c.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, { before: TEAM, after: TEAM2 });

    expect(res.status).toBe(502);
    const found = await teamRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      action: "save_team",
      result: "error",
      detail: { reason: "error" },
      project_id: ctx.projectId,
    });
  });

  it("given no session, when the team is updated, then 401 and nothing is written", async () => {
    const ctx = await ready();

    const res = await apply(
      ctx,
      { before: TEAM, after: TEAM2 },
      ctx.projectId,
      "",
    );

    expect(res.status).toBe(401);
    expect(repoCalls(ctx)).toEqual([]);
  });

  it("given an instance the wizard has not configured, when the team is updated, then 503", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request("/api/projects/1/team/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(503);
  });
});
