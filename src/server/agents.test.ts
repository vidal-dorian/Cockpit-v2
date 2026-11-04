import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Slice E2 (decision 030 B, E, F): the routes of the agent editor, through `app.request()` against the fake GitHub that keeps a Git history.
//
// Pinned where the decision leaves it open:
// - GET /api/projects/:id/agents answers 200 { agents: [{ name, text }], catalog: [{ name, text }] } (catalogue agents of `catalog/agents/<name>.md` missing from the repo, by name).
// - POST /api/projects/:id/agents/apply answers 200 { commitSha, pullRequest?: { number, url } } (the shape of the prepare route, without `created`).
// - A refusal is 409 { error: "<code>" } (`pull_request_forbidden` also carries `appSettingsUrl`); a GitHub error is 502 { error: "github_unavailable" }.
// - The `save_agent` / `delete_agent` entry: args { path }, github_effects { commitSha, pullRequest: <number | null> } (as `prepare_repo`), refused entries hold detail { reason: <code> }, error entries detail { reason: "error" }.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const DEV = ".claude/agents/developer.md";
const REV = ".claude/agents/reviewer.md";
const PROMPT = "Secret prompt line that must never reach the history\n";
const T = `---\nname: developer\ndescription: Builds\nmodel: sonnet\n---\n${PROMPT}`;
const T2 = T.replace("model: sonnet", "model: opus");
const R = "---\nname: reviewer\ndescription: Reviews\n---\nReview it\n";
const PROTECTED = {
  status: 403,
  message: "Protected branch update failed for refs/heads/main",
};
const NO_PULL_REQUEST_RIGHT = {
  status: 403,
  message: "Resource not accessible by integration",
};

const fromCatalog = (name: string) => {
  try {
    return readFileSync(
      fileURLToPath(
        new URL(`../../catalog/agents/${name}.md`, import.meta.url),
      ),
      "utf8",
    );
  } catch {
    return `missing catalog/agents/${name}.md`;
  }
};

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: {
      [REPO]: {
        files: { "README.md": "# app\n", [DEV]: T, [REV]: R },
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
const read = (
  ctx: Ctx,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => request(ctx, cookie, `/api/projects/${id}/agents`, "GET");
const apply = (
  ctx: Ctx,
  body: unknown,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => request(ctx, cookie, `/api/projects/${id}/agents/apply`, "POST", body);

const writeCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
  );
const repoCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.startsWith("/repos/"));
const noWrite = (ctx: Ctx) => {
  expect(writeCalls(ctx)).toEqual([]);
  expect(ctx.git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
  expect(ctx.git.pullRequests).toEqual([]);
};
const agentRows = (ctx: Ctx) =>
  rows(ctx.db, sql`action in ('save_agent', 'delete_agent')`) as Promise<
    (Row & { github_effects: unknown })[]
  >;
const anyRows = async (ctx: Ctx) =>
  (await ctx.db.execute(
    // The setup writes a create_token entry (userWithToken): only the editor's entries count.
    sql`select count(*)::int as n from history where action in ('save_agent', 'delete_agent')`,
  )) as unknown as {
    rows: { n: number }[];
  };

describe("decision 030 B: GET /api/projects/:id/agents", () => {
  it("given a repo with two agents, a Notes.txt and a directory old, when a member reads it, then agents holds the two regular <name>.md files by name and catalog the catalogue agents missing from the repo", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        [DEV]: T,
        [REV]: R,
        ".claude/agents/Notes.txt": "notes\n",
        ".claude/agents/Dev.md": "bad name\n",
        ".claude/agents/-x.md": "bad name\n",
        ".claude/agents/old/inside.md": "a directory\n",
      },
    });

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agents: [
        { name: "developer", text: T },
        { name: "reviewer", text: R },
      ],
      catalog: [{ name: "test-writer", text: fromCatalog("test-writer") }],
    });
    noWrite(ctx);
  });

  it("given a repo without .claude/agents, when a member reads it, then agents is empty and catalog lists the three catalogue agents", async () => {
    const ctx = await ready({ files: { "README.md": "# app\n" } });

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agents: [],
      catalog: ["developer", "reviewer", "test-writer"].map((name) => ({
        name,
        text: fromCatalog(name),
      })),
    });
  });

  it("given an instance the wizard has not configured, when it is read, then 503", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request("/api/projects/1/agents");

    expect(res.status).toBe(503);
  });

  it("given no session, when it is read, then 401 and GitHub is not called for the repo", async () => {
    const ctx = await ready();

    const res = await request(
      ctx,
      "",
      `/api/projects/${ctx.projectId}/agents`,
      "GET",
    );

    expect(res.status).toBe(401);
    expect(repoCalls(ctx)).toEqual([]);
  });

  it("given another user's project, when it is read, then 404 and GitHub is not called for the repo", async () => {
    const ctx = await ready();
    // The route exists and serves the owner (a missing route also answers 404).
    expect((await read(ctx)).status).toBe(200);
    const known = repoCalls(ctx).length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await read(ctx, ctx.projectId, bob.cookie);

    expect(res.status).toBe(404);
    expect(repoCalls(ctx)).toHaveLength(known);
  });

  it.each([
    ["empty_repo", { empty: true }],
    ["repo_unreachable", { unreachable: true }],
  ])(
    "given a repo refused with %s, when it is read, then 409 with that code and no history entry",
    async (code, repo) => {
      const ctx = await ready(repo);

      const res = await read(ctx);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
      expect((await anyRows(ctx)).rows[0]?.n).toBe(0);
    },
  );

  it("given GitHub that fails, when it is read, then 502 and no history entry", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.path.endsWith("/git/ref/heads/main"),
    });

    const res = await read(ctx);

    expect(res.status).toBe(502);
    expect((await anyRows(ctx)).rows[0]?.n).toBe(0);
  });

  it("given a successful read, when it is done, then no history entry is written", async () => {
    const ctx = await ready();

    expect((await read(ctx)).status).toBe(200);

    expect((await anyRows(ctx)).rows[0]?.n).toBe(0);
  });
});

describe("decision 030 E: POST /api/projects/:id/agents/apply", () => {
  it("given a member and an unchanged repo, when an agent is updated, then the file is replaced by one commit with the message feat: update the agent developer (Cockpit), the answer gives the commit and a save_agent entry is written", async () => {
    const ctx = await ready();
    const base = ctx.git.head;

    const res = await apply(ctx, { name: "developer", before: T, after: T2 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { commitSha: string };
    expect(body.commitSha).toBe(ctx.git.head);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: update the agent developer (Cockpit)",
      parents: [base],
    });
    expect(ctx.git.filesAt(ctx.git.head)?.[DEV]).toBe(T2);
    const found = await agentRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      token_id: null,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      action: "save_agent",
      args: { path: DEV },
      result: "ok",
      github_effects: { commitSha: body.commitSha, pullRequest: null },
    });
    const text = JSON.stringify(found[0]);
    expect(text).not.toContain("Secret prompt");
    expect(text).not.toContain("model: opus");
  });

  it("given a protected default branch, when an agent is updated, then the answer gives the pull request and the entry holds its number", async () => {
    const ctx = await ready({ refUpdateFailure: PROTECTED });
    const base = ctx.git.head;

    const res = await apply(ctx, { name: "developer", before: T, after: T2 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      pullRequest: { number: number; url: string };
    };
    expect(body.pullRequest).toEqual({
      number: 1,
      url: "https://github.com/user1000/app/pull/1",
    });
    expect(ctx.git.head).toBe(base);
    expect((await agentRows(ctx))[0]).toMatchObject({
      result: "ok",
      github_effects: { commitSha: body.commitSha, pullRequest: 1 },
    });
  });

  it("given a new name, when an agent is added, then the file is created with the message feat: add the agent doc-writer (Cockpit) and a save_agent entry is written", async () => {
    const ctx = await ready();

    const res = await apply(ctx, {
      name: "doc-writer",
      before: null,
      after: T,
    });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits[0]?.message).toBe(
      "feat: add the agent doc-writer (Cockpit)",
    );
    expect(
      ctx.git.filesAt(ctx.git.head)?.[".claude/agents/doc-writer.md"],
    ).toBe(T);
    expect(await agentRows(ctx)).toMatchObject([
      {
        action: "save_agent",
        args: { path: ".claude/agents/doc-writer.md" },
        result: "ok",
      },
    ]);
  });

  it("given an existing agent, when it is removed, then the file is removed with the message feat: remove the agent reviewer (Cockpit) and a delete_agent entry is written", async () => {
    const ctx = await ready();

    const res = await apply(ctx, { name: "reviewer", before: R, after: null });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits[0]?.message).toBe(
      "feat: remove the agent reviewer (Cockpit)",
    );
    expect(ctx.git.filesAt(ctx.git.head)?.[REV]).toBeUndefined();
    expect(await agentRows(ctx)).toMatchObject([
      { action: "delete_agent", args: { path: REV }, result: "ok" },
    ]);
  });

  it.each([
    ["no body", undefined],
    ["a body that is not an object", "x"],
    ["no name", { before: T, after: T2 }],
    ["no before", { name: "developer", after: T2 }],
    ["no after", { name: "developer", before: T }],
    ["a name that climbs", { name: "../x", before: null, after: T }],
    ["an upper case name", { name: "Dev", before: null, after: T }],
    ["a name starting with a dash", { name: "-x", before: null, after: T }],
    [
      "a name of 238 characters",
      { name: "a".repeat(238), before: null, after: T },
    ],
    ["an empty name", { name: "", before: null, after: T }],
    ["a name with a dot", { name: "a.b", before: null, after: T }],
    [
      "both before and after null",
      { name: "developer", before: null, after: null },
    ],
    ["before equal to after", { name: "developer", before: T, after: T }],
    [
      "an after over 1 MiB",
      { name: "doc-writer", before: null, after: "x".repeat(1_048_577) },
    ],
    ["a before that is a number", { name: "developer", before: 1, after: T }],
  ])(
    "given %s, when it is applied, then 400, nothing is written to GitHub and no history entry",
    async (_name, body) => {
      const ctx = await ready();

      const res = await apply(ctx, body);

      expect(res.status).toBe(400);
      expect(repoCalls(ctx)).toEqual([]);
      expect((await anyRows(ctx)).rows[0]?.n).toBe(0);
    },
  );

  it("given an after of exactly 1 MiB, when an agent is added, then it is accepted (the limit is 1 MiB, whatever the global body limit of the API)", async () => {
    const ctx = await ready();

    const res = await apply(ctx, {
      name: "doc-writer",
      before: null,
      after: "x".repeat(1_048_576),
    });

    expect(res.status).toBe(200);
  });

  it.each([
    [
      "repo_changed",
      (ctx: Ctx) => {
        ctx.git.push({ [DEV]: "theirs\n" });
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
    "given a repo refused with %s, when an agent is updated, then 409 with that code and one refused save_agent entry with no GitHub effect",
    async (code, mutate, repo: FakeGitRepoOptions) => {
      const ctx = await ready(repo);
      if (!repo.empty) mutate(ctx);
      const head = repo.empty ? null : ctx.git.head;

      const res = await apply(ctx, { name: "developer", before: T, after: T2 });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(
        code === "pull_request_forbidden"
          ? {
              error: code,
              appSettingsUrl: "https://github.com/settings/apps/cockpit-test",
            }
          : { error: code },
      );
      if (head) expect(ctx.git.head).toBe(head);
      const found = await agentRows(ctx);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        action: "save_agent",
        result: "refused",
        detail: { reason: code },
        github_effects: null,
      });
    },
  );

  it("given an archived project, when an agent is updated, then 409 project_archived, nothing is written and a refused entry is recorded", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await apply(ctx, { name: "developer", before: T, after: T2 });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    noWrite(ctx);
    expect(await agentRows(ctx)).toMatchObject([
      { result: "refused", detail: { reason: "project_archived" } },
    ]);
  });

  it("given another user's project, when an agent is updated, then 404 and nothing is written", async () => {
    const ctx = await ready();
    // The route exists and serves the owner.
    expect(
      (await apply(ctx, { name: "reviewer", before: R, after: null })).status,
    ).toBe(200);
    const known = writeCalls(ctx).length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await apply(
      ctx,
      { name: "developer", before: T, after: T2 },
      ctx.projectId,
      bob.cookie,
    );

    expect(res.status).toBe(404);
    expect(writeCalls(ctx)).toHaveLength(known);
  });

  it("given GitHub that fails while the commit is made, when an agent is updated, then 502 and one error entry with the closed reason error", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.method === "POST" && c.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, { name: "developer", before: T, after: T2 });

    expect(res.status).toBe(502);
    const found = await agentRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      action: "save_agent",
      result: "error",
      detail: { reason: "error" },
      project_id: ctx.projectId,
    });
    expect(JSON.stringify(found[0])).not.toContain("github-boom-message");
  });

  it("given no session, when an agent is updated, then 401 and nothing is written", async () => {
    const ctx = await ready();

    const res = await apply(
      ctx,
      { name: "developer", before: T, after: T2 },
      ctx.projectId,
      "",
    );

    expect(res.status).toBe(401);
    expect(repoCalls(ctx)).toEqual([]);
  });

  it("given an instance the wizard has not configured, when an agent is updated, then 503", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request("/api/projects/1/agents/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(503);
  });
});
