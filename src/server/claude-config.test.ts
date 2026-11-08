// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${VAR} references are the data under test
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeGitRepoOptions, githubCalls } from "./test-github.ts";
import {
  archiveProject,
  type Row,
  rows,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 12.1 (decision 065 A to C): the routes of the Claude configuration of the repo, through `app.request()` against the fake GitHub that keeps a Git history.
//
// Pinned where the decision leaves it open (same conventions as agents.test.ts, decision 030):
// - GET /api/projects/:id/claude-config answers 200 { claudeMd, rules, skills, mcpJson } (texts, `null` without file; rules and skills: [{ name, text }] sorted by name).
// - POST /api/projects/:id/claude-config/apply takes { kind, name?, before, after } and answers 200 { commitSha, pullRequest?: { number, url } }.
// - A 400 is a body that does not fit (nothing written, no history entry); a refusal is 409 { error: "<code>" } with one refused entry, detail { reason: <code> }
//   (`secret_in_clear` also carries `at`, in the answer and in detail, never the value); a GitHub error is 502 { error: "github_unavailable" }.
// - The entries (action save_claude_md, save_rule, delete_rule, save_skill, delete_skill, save_mcp_json): args { path }, github_effects { commitSha, pullRequest: <number | null> }.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const RULE = ".claude/rules/style.md";
const SKILL = ".claude/skills/lint/SKILL.md";
const CLAUDE = "# App\n\nSecret line that must never reach the history\n";
const CLAUDE2 = CLAUDE.replace("# App", "# App 2");
const MCP = '{"mcpServers":{"github":{"url":"https://x.test/mcp"}}}\n';
const SK = "---\nname: lint\ndescription: Lints\n---\nLint it\n";

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: {
      [REPO]: {
        files: {
          "README.md": "# app\n",
          "CLAUDE.md": CLAUDE,
          [RULE]: "Use tabs\n",
          [SKILL]: SK,
        },
        ...repo,
      },
    },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}

const call = (
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
) => call(ctx, cookie, `/api/projects/${id}/claude-config`, "GET");
const apply = (
  ctx: Ctx,
  body: unknown,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => call(ctx, cookie, `/api/projects/${id}/claude-config/apply`, "POST", body);

const repoCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.startsWith("/repos/"));
const noWrite = (ctx: Ctx) => {
  expect(repoCalls(ctx).filter((c) => c.method !== "GET")).toEqual([]);
  expect(ctx.git.created.commits).toEqual([]);
};
const configRows = (ctx: Ctx) =>
  rows(
    ctx.db,
    sql`action in ('save_claude_md', 'save_rule', 'delete_rule', 'save_skill', 'delete_skill', 'save_mcp_json')`,
  ) as Promise<(Row & { github_effects: unknown })[]>;

describe("decision 065 A: GET /api/projects/:id/claude-config", () => {
  it("given a repo with CLAUDE.md, .mcp.json, rules and skills (some not readable or badly named, and a catalogue skill), when a member reads it, then the four parts are served sorted, unreadable files have an empty text and catalogue skills are left out, with no history entry", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        "CLAUDE.md": CLAUDE,
        ".mcp.json": MCP,
        ".claude/rules/zeta.md": "Z\n",
        [RULE]: "Use tabs\n",
        ".claude/rules/Bad.md": "bad name\n",
        ".claude/rules/notes.txt": "n\n",
        ".claude/rules/sub/deep.md": "second level\n",
        [SKILL]: SK,
        ".claude/skills/dev-us/SKILL.md": "catalogue\n",
        ".claude/skills/write-us/SKILL.md": "catalogue\n",
        ".claude/skills/analyser/SKILL.md": "catalogue\n",
        ".claude/skills/lint/extra.sh": "echo\n",
      },
      entries: { ".claude/rules/linked.md": { kind: "symlink" } },
    });

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      claudeMd: CLAUDE,
      mcpJson: MCP,
      rules: [
        { name: "linked", text: "" },
        { name: "style", text: "Use tabs\n" },
        { name: "zeta", text: "Z\n" },
      ],
      skills: [{ name: "lint", text: SK }],
    });
    noWrite(ctx);
    expect(await configRows(ctx)).toEqual([]);
  });

  it("given a repo with none of these files, when a member reads it, then claudeMd and mcpJson are null and the lists are empty", async () => {
    const ctx = await ready({ files: { "README.md": "# app\n" } });

    const res = await read(ctx);

    expect(await res.json()).toEqual({
      claudeMd: null,
      mcpJson: null,
      rules: [],
      skills: [],
    });
  });

  it("given an archived project, when a member reads it, then it is served", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    expect((await read(ctx)).status).toBe(200);
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
    "given a repo refused with %s, when it is read, then 409 with that code",
    async (code, repo) => {
      const ctx = await ready(repo);

      const res = await read(ctx);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
    },
  );

  it("given GitHub that fails, when it is read, then 502 github_unavailable", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.path.endsWith("/git/ref/heads/main"),
    });

    const res = await read(ctx);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });
});

describe("decision 065 B: POST /api/projects/:id/claude-config/apply", () => {
  it.each([
    [
      "claude_md update",
      { kind: "claude_md", before: CLAUDE, after: CLAUDE2 },
      "CLAUDE.md",
      CLAUDE2,
      "feat: update CLAUDE.md (Cockpit)",
      "save_claude_md",
    ],
    [
      "claude_md creation",
      { kind: "claude_md", before: null, after: CLAUDE2 },
      "CLAUDE.md",
      CLAUDE2,
      "feat: update CLAUDE.md (Cockpit)",
      "save_claude_md",
      { files: { "README.md": "# app\n" } },
    ],
    [
      "rule add",
      { kind: "rule", name: "naming", before: null, after: "Name well\n" },
      ".claude/rules/naming.md",
      "Name well\n",
      "feat: add the rule naming (Cockpit)",
      "save_rule",
    ],
    [
      "rule update",
      { kind: "rule", name: "style", before: "Use tabs\n", after: "Spaces\n" },
      RULE,
      "Spaces\n",
      "feat: update the rule style (Cockpit)",
      "save_rule",
    ],
    [
      "rule remove",
      { kind: "rule", name: "style", before: "Use tabs\n", after: null },
      RULE,
      undefined,
      "feat: remove the rule style (Cockpit)",
      "delete_rule",
    ],
    [
      "skill add",
      { kind: "skill", name: "deploy", before: null, after: SK },
      ".claude/skills/deploy/SKILL.md",
      SK,
      "feat: add the skill deploy (Cockpit)",
      "save_skill",
    ],
    [
      "skill update",
      { kind: "skill", name: "lint", before: SK, after: `${SK}More\n` },
      SKILL,
      `${SK}More\n`,
      "feat: update the skill lint (Cockpit)",
      "save_skill",
    ],
    [
      "skill remove",
      { kind: "skill", name: "lint", before: SK, after: null },
      SKILL,
      undefined,
      "feat: remove the skill lint (Cockpit)",
      "delete_skill",
    ],
    [
      "mcp_json update",
      { kind: "mcp_json", before: MCP, after: '{"mcpServers":{}}\n' },
      ".mcp.json",
      '{"mcpServers":{}}\n',
      "feat: update .mcp.json (Cockpit)",
      "save_mcp_json",
      { files: { "README.md": "# app\n", ".mcp.json": MCP } },
    ],
  ] as [
    string,
    Record<string, unknown>,
    string,
    string | undefined,
    string,
    string,
    FakeGitRepoOptions?,
  ][])(
    "given a member and an unchanged repo, when a %s is applied, then one commit at the path built by the server with the right message, and one entry with only the path in args",
    async (_name, body, path, text, message, action, repo) => {
      const ctx = await ready(repo);
      const base = ctx.git.head;

      const res = await apply(ctx, body);

      expect(res.status).toBe(200);
      const { commitSha } = (await res.json()) as { commitSha: string };
      expect(commitSha).toBe(ctx.git.head);
      expect(ctx.git.created.commits).toHaveLength(1);
      expect(ctx.git.created.commits[0]).toMatchObject({
        message,
        parents: [base],
      });
      expect(ctx.git.filesAt(ctx.git.head)?.[path]).toBe(text);
      const found = await configRows(ctx);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        action,
        args: { path },
        result: "ok",
        github_effects: { commitSha, pullRequest: null },
      });
      expect(JSON.stringify(found[0])).not.toContain("Secret line");
    },
  );

  it("given a protected default branch, when CLAUDE.md is updated, then the answer gives the pull request and the entry holds its number", async () => {
    const ctx = await ready({
      refUpdateFailure: {
        status: 403,
        message: "Protected branch update failed for refs/heads/main",
      },
    });

    const res = await apply(ctx, {
      kind: "claude_md",
      before: CLAUDE,
      after: CLAUDE2,
    });

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { pullRequest: unknown }).pullRequest,
    ).toEqual({ number: 1, url: "https://github.com/user1000/app/pull/1" });
    expect((await configRows(ctx))[0]).toMatchObject({
      result: "ok",
      github_effects: { pullRequest: 1 },
    });
  });

  it.each([
    ["no kind", { before: CLAUDE, after: CLAUDE2 }],
    ["an unknown kind", { kind: "agent", before: CLAUDE, after: CLAUDE2 }],
    ["no before", { kind: "claude_md", after: CLAUDE2 }],
    [
      "before equal to after",
      { kind: "claude_md", before: CLAUDE, after: CLAUDE },
    ],
    ["both null", { kind: "rule", name: "style", before: null, after: null }],
    [
      "an after over 1 MiB",
      { kind: "claude_md", before: null, after: "x".repeat(1_048_577) },
    ],
    ["a rule without name", { kind: "rule", before: null, after: "x\n" }],
    ["a skill without name", { kind: "skill", before: null, after: SK }],
    [
      "a name with a dot",
      { kind: "rule", name: "a.b", before: null, after: "x\n" },
    ],
    [
      "a name that climbs",
      { kind: "rule", name: "../x", before: null, after: "x\n" },
    ],
    [
      "an upper case name",
      { kind: "skill", name: "Lint", before: null, after: SK },
    ],
    [
      "a name on CLAUDE.md",
      { kind: "claude_md", name: "x", before: CLAUDE, after: CLAUDE2 },
    ],
    [
      "a name on .mcp.json",
      { kind: "mcp_json", name: "x", before: MCP, after: "{}" },
    ],
    ["CLAUDE.md removed", { kind: "claude_md", before: CLAUDE, after: null }],
    ["an .mcp.json removed", { kind: "mcp_json", before: MCP, after: null }],
    [
      "a catalogue skill",
      { kind: "skill", name: "dev-us", before: null, after: SK },
    ],
  ])(
    "given %s, when it is applied, then 400, nothing is written to GitHub and no history entry",
    async (_name, body) => {
      const ctx = await ready();

      const res = await apply(ctx, body);

      expect(res.status).toBe(400);
      expect(repoCalls(ctx)).toEqual([]);
      expect(await configRows(ctx)).toEqual([]);
    },
  );

  it("given the file changed on GitHub since it was read, when it is applied, then 409 repo_changed, nothing is written and one refused entry is recorded", async () => {
    const ctx = await ready();
    ctx.git.push({ [RULE]: "theirs\n" });
    const head = ctx.git.head;

    const res = await apply(ctx, {
      kind: "rule",
      name: "style",
      before: "Use tabs\n",
      after: "Spaces\n",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.head).toBe(head);
    expect(await configRows(ctx)).toMatchObject([
      {
        action: "save_rule",
        result: "refused",
        detail: { reason: "repo_changed" },
      },
    ]);
  });

  it("given a new file where one now exists, when it is applied with before: null, then 409 repo_changed", async () => {
    const ctx = await ready();

    const res = await apply(ctx, {
      kind: "claude_md",
      before: null,
      after: CLAUDE2,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
  });

  it("given an archived project, when it is applied, then 409 project_archived, nothing is written and a refused entry is recorded", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await apply(ctx, {
      kind: "claude_md",
      before: CLAUDE,
      after: CLAUDE2,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    noWrite(ctx);
    expect(await configRows(ctx)).toMatchObject([
      { result: "refused", detail: { reason: "project_archived" } },
    ]);
  });

  it("given another user's project, when it is applied, then 404 and nothing is written", async () => {
    const ctx = await ready();
    // The route exists and serves the owner.
    expect(
      (
        await apply(ctx, {
          kind: "claude_md",
          before: CLAUDE,
          after: CLAUDE2,
        })
      ).status,
    ).toBe(200);
    const known = ctx.git.created.commits.length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await apply(
      ctx,
      { kind: "claude_md", before: CLAUDE2, after: CLAUDE },
      ctx.projectId,
      bob.cookie,
    );

    expect(res.status).toBe(404);
    expect(ctx.git.created.commits).toHaveLength(known);
  });

  it("given GitHub that fails while the commit is made, when it is applied, then 502 github_unavailable and one error entry", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.method === "POST" && c.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, {
      kind: "claude_md",
      before: CLAUDE,
      after: CLAUDE2,
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
    expect(await configRows(ctx)).toMatchObject([
      {
        action: "save_claude_md",
        result: "error",
        detail: { reason: "error" },
      },
    ]);
  });
});

describe("decision 065 C: the secrets of .mcp.json", () => {
  const mcp = (servers: unknown) => JSON.stringify({ mcpServers: servers });
  const send = (ctx: Ctx, after: string) =>
    apply(ctx, { kind: "mcp_json", before: MCP, after });
  const withMcp = () =>
    ready({ files: { "README.md": "# app\n", ".mcp.json": MCP } });

  it.each([
    ["not JSON", "{ nope"],
    ["a JSON array", "[]"],
    ["a JSON string", '"x"'],
  ])(
    "given an after that is %s, when .mcp.json is applied, then 409 invalid_json, nothing is written and the refusal is recorded",
    async (_name, after) => {
      const ctx = await withMcp();

      const res = await send(ctx, after);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "invalid_json" });
      expect(ctx.git.created.commits).toEqual([]);
      expect(await configRows(ctx)).toMatchObject([
        {
          action: "save_mcp_json",
          result: "refused",
          detail: { reason: "invalid_json" },
        },
      ]);
    },
  );

  it.each([
    [
      "a header in clear",
      { github: { headers: { Authorization: "Bearer ghp_SECRETVALUE" } } },
      "mcpServers.github.headers.Authorization",
    ],
    [
      "an env value in clear, on a server that is not Cockpit",
      {
        ok: { headers: { A: "${A}" } },
        db: { command: "x", env: { PASSWORD: "hunter2-SECRETVALUE" } },
      },
      "mcpServers.db.env.PASSWORD",
    ],
    [
      "a user and a password in the url",
      { api: { url: "https://bob:SECRETVALUE@x.test/mcp" } },
      "mcpServers.api.url",
    ],
    [
      "a user alone in the url",
      { api: { url: "https://SECRETVALUE@x.test/mcp" } },
      "mcpServers.api.url",
    ],
    [
      "a reference with text around it",
      { api: { headers: { A: "x${A}SECRETVALUE" } } },
      "mcpServers.api.headers.A",
    ],
  ])(
    "given %s, when .mcp.json is applied, then 409 secret_in_clear with the path, nothing is written and the value is nowhere in the history",
    async (_name, servers, at) => {
      const ctx = await withMcp();

      const res = await send(ctx, mcp(servers));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "secret_in_clear", at });
      expect(ctx.git.created.commits).toEqual([]);
      const found = await configRows(ctx);
      expect(found).toMatchObject([
        { result: "refused", detail: { reason: "secret_in_clear" } },
      ]);
      expect(JSON.stringify(found)).not.toContain("SECRETVALUE");
      expect(JSON.stringify(found)).not.toContain("hunter2");
    },
  );

  it("given only references (${VAR}, Bearer ${VAR}) and a url without credentials, when .mcp.json is applied, then it is committed", async () => {
    const ctx = await withMcp();

    const res = await send(
      ctx,
      mcp({
        github: {
          url: "https://x.test/mcp",
          headers: { Authorization: "Bearer ${GITHUB_TOKEN}", K: "${K}" },
        },
        db: { command: "x", env: { PASSWORD: "${DB_PASSWORD}" } },
      }),
    );

    expect(res.status).toBe(200);
  });
});
