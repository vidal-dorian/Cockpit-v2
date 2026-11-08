import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeGitRepoOptions, githubCalls } from "./test-github.ts";
import {
  archiveProject,
  type Row,
  rows,
  seedProject,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 12.3 (decision 066): the plugin repo shared by every project, through `app.request()` against the fake GitHub that keeps a Git history.
//
// Assumed contract (same conventions as claude-config.test.ts, decision 065):
// - The plugin repo is `user1000/plugins` in `gitRepos`; it is reachable when the installation lists it (`repositories`).
// - PUT /api/plugins/repo { fullName: "<owner/name>" | null } -> 200 { repo: "<owner/name>" | null }; unreachable -> 409 { error: "repo_unreachable" }; a body that does not fit -> 400.
//   History: link_plugin_repo / unlink_plugin_repo (actor human, origin ui, result ok).
// - GET /api/plugins -> 200 { repo, agents, skills } (as 065 A: [{ name, text }] sorted, "" when unreadable); 409 repo_unreachable; 502 github_unavailable; no history.
// - POST /api/plugins/apply { kind: "agent" | "skill", name, before, after } -> 200 { commitSha, pullRequest? }; paths plugins/commun/agents/<name>.md and plugins/commun/skills/<name>/SKILL.md;
//   `.claude-plugin/marketplace.json` and `plugins/commun/.claude-plugin/plugin.json` (JSON.parse-equal to 066 C) join the commit only when missing; 409 repo_changed (refused entry), 409 no_plugin_repo, 400 for a body that does not fit.
//   History action save_shared_agent / delete_shared_agent / save_shared_skill / delete_shared_skill, args { path }.
// - GET /api/plugins/projects -> 200 { projects: [{ id, fullName, installed, settings }] } for the non-archived projects of the user (settings: the text of .claude/settings.json, null without file).
// - POST /api/projects/:id/plugins/apply { install: boolean, before: string | null } -> 200 { commitSha, pullRequest? }; `after` is pluginSettings(before, ...) (plugin-settings.ts),
//   409 invalid_settings / no_plugin_repo / repo_changed / project_archived (refused entry), 404 for a project that is not the user's.
//   History install_shared_plugin / remove_shared_plugin, args { path: ".claude/settings.json" }.

afterEach(() => {
  vi.unstubAllGlobals();
});

const PLUGINS = "user1000/plugins";
const SETTINGS = ".claude/settings.json";
const MARKET = ".claude-plugin/marketplace.json";
const MANIFEST = "plugins/commun/.claude-plugin/plugin.json";
const AGENT = "plugins/commun/agents/dev.md";
const SKILL = "plugins/commun/skills/lint/SKILL.md";
const AG = "---\nname: dev\ndescription: Builds\n---\nBuild\n";
const SK = "---\nname: lint\ndescription: Lints\n---\nLint it\n";
const MARKET_JSON = {
  name: "cockpit-user1000",
  owner: { name: "user1000" },
  plugins: [
    {
      name: "commun",
      source: "./plugins/commun",
      description:
        "Les agents et skills communs de user1000, écrits par Cockpit",
    },
  ],
};
const text = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const INSTALLED = {
  extraKnownMarketplaces: {
    "cockpit-user1000": {
      source: { source: "github", repo: PLUGINS },
    },
  },
  enabledPlugins: { "commun@cockpit-user1000": true },
};
const repo = (id: number, full_name: string) => ({
  id,
  full_name,
  default_branch: "main",
  private: false,
});

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(
  plugins: FakeGitRepoOptions = {},
  app: Record<string, string> = {},
) {
  const ctx = await withProject({
    repositories: [repo(1, "user1000/app"), repo(2, PLUGINS)],
    gitRepos: {
      "user1000/app": { files: { "README.md": "# app\n", ...app } },
      [PLUGINS]: { files: { "README.md": "# plugins\n" }, ...plugins },
    },
  });
  return { ...ctx, git: ctx.fetchMock.git(PLUGINS) };
}

const call = (
  ctx: Pick<Ctx, "app">,
  cookie: string,
  path: string,
  method: "GET" | "PUT" | "POST",
  body?: unknown,
) =>
  ctx.app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const link = (ctx: Ctx, fullName: string | null = PLUGINS) =>
  call(ctx, ctx.alice.cookie, "/api/plugins/repo", "PUT", { fullName });
const linked = async (...args: Parameters<typeof ready>) => {
  const ctx = await ready(...args);
  expect((await link(ctx)).status).toBe(200);
  return ctx;
};
const read = (ctx: Ctx) => call(ctx, ctx.alice.cookie, "/api/plugins", "GET");
const apply = (ctx: Ctx, body: unknown) =>
  call(ctx, ctx.alice.cookie, "/api/plugins/apply", "POST", body);
const projectsOf = (ctx: Ctx) =>
  call(ctx, ctx.alice.cookie, "/api/plugins/projects", "GET");
const install = (
  ctx: Ctx,
  body: unknown,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => call(ctx, cookie, `/api/projects/${id}/plugins/apply`, "POST", body);
const pluginRows = (ctx: Ctx) =>
  rows(
    ctx.db,
    sql`action like '%plugin%' or action like '%shared%'`,
  ) as Promise<(Row & { github_effects: unknown })[]>;
const noWrite = (ctx: Ctx) => {
  expect(
    githubCalls(ctx.fetchMock).filter(
      (c) => c.path.startsWith("/repos/") && c.method !== "GET",
    ),
  ).toEqual([]);
};

describe("decision 066 B: PUT /api/plugins/repo", () => {
  it("given a repo the installation reaches, when it is linked, then it is served by GET /api/plugins and one link_plugin_repo entry is recorded", async () => {
    const ctx = await ready();

    const res = await link(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo: PLUGINS });
    expect(await (await read(ctx)).json()).toMatchObject({ repo: PLUGINS });
    expect(await pluginRows(ctx)).toMatchObject([
      {
        user_id: ctx.alice.id,
        actor: "human",
        origin: "ui",
        action: "link_plugin_repo",
        result: "ok",
      },
    ]);
  });

  it("given a repo the installation does not reach, when it is linked, then 409 repo_unreachable, nothing is linked and the refusal is recorded (decision 010 C)", async () => {
    const ctx = await ready();

    const res = await link(ctx, "user1000/elsewhere");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_unreachable" });
    expect(await (await read(ctx)).json()).toMatchObject({ repo: null });
    expect(await pluginRows(ctx)).toMatchObject([
      {
        user_id: ctx.alice.id,
        action: "link_plugin_repo",
        result: "refused",
      },
    ]);
  });

  it.each([
    ["no fullName", {}],
    ["a name that is not owner/name", { fullName: "plugins" }],
  ])("given %s, when it is sent, then 400", async (_n, body) => {
    const ctx = await ready();

    const res = await call(
      ctx,
      ctx.alice.cookie,
      "/api/plugins/repo",
      "PUT",
      body,
    );

    expect(res.status).toBe(400);
  });

  it("given a linked repo, when fullName is null, then it is unlinked, the repo and the projects are untouched and one unlink_plugin_repo entry is recorded", async () => {
    const ctx = await linked();

    const res = await link(ctx, null);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo: null });
    expect(await (await read(ctx)).json()).toEqual({
      repo: null,
      agents: [],
      skills: [],
    });
    noWrite(ctx);
    expect((await pluginRows(ctx)).map((r) => r.action)).toEqual([
      "link_plugin_repo",
      "unlink_plugin_repo",
    ]);
  });
});

describe("decision 066 D: GET /api/plugins", () => {
  it("given no linked repo, when read, then repo is null and the lists are empty without a call to a repo", async () => {
    const ctx = await ready();

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo: null, agents: [], skills: [] });
  });

  it("given a plugin repo with agents and skills (one unreadable, one badly named), when read, then they are served sorted from plugins/commun with no history entry beyond the link", async () => {
    const ctx = await linked({
      files: {
        "README.md": "# plugins\n",
        "plugins/commun/agents/zed.md": "Z\n",
        [AGENT]: AG,
        "plugins/commun/agents/Bad.md": "bad\n",
        "plugins/commun/skills/lint/SKILL.md": SK,
        "plugins/commun/skills/lint/extra.sh": "echo\n",
        "agents/outside.md": "not under commun\n",
      },
      entries: { "plugins/commun/agents/linked.md": { kind: "symlink" } },
    });

    const res = await read(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repo: PLUGINS,
      agents: [
        { name: "dev", text: AG },
        { name: "linked", text: "" },
        { name: "zed", text: "Z\n" },
      ],
      skills: [{ name: "lint", text: SK }],
    });
    expect(await pluginRows(ctx)).toHaveLength(1);
  });

  it("given a linked repo that is no longer reached, when read, then 409 repo_unreachable", async () => {
    const ctx = await linked({ unreachable: true });

    const res = await read(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_unreachable" });
  });

  it("given GitHub that fails, when read, then 502 github_unavailable", async () => {
    const ctx = await linked();
    ctx.fetchMock.update({
      failOn: (c) => c.path.endsWith("/git/ref/heads/main"),
    });

    const res = await read(ctx);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });
});

describe("decision 066 C, E: POST /api/plugins/apply", () => {
  it("given an empty plugin repo, when the first agent is added, then one commit holds the agent and the two .claude-plugin files, with the message and the entry of 066 E", async () => {
    const ctx = await linked();
    const base = ctx.git.head;

    const res = await apply(ctx, {
      kind: "agent",
      name: "dev",
      before: null,
      after: AG,
    });

    expect(res.status).toBe(200);
    const { commitSha } = (await res.json()) as { commitSha: string };
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: add the shared agent dev (Cockpit)",
      parents: [base],
    });
    const files = ctx.git.filesAt(ctx.git.head) ?? {};
    expect(files[AGENT]).toBe(AG);
    expect(JSON.parse(files[MARKET] ?? "null")).toEqual(MARKET_JSON);
    expect(JSON.parse(files[MANIFEST] ?? "null")).toEqual({
      name: "commun",
      description: expect.any(String),
    });
    expect(await pluginRows(ctx)).toMatchObject([
      { action: "link_plugin_repo" },
      {
        user_id: ctx.alice.id,
        actor: "human",
        origin: "ui",
        action: "save_shared_agent",
        args: { path: AGENT },
        result: "ok",
        github_effects: { commitSha, pullRequest: null },
      },
    ]);
  });

  it("given both .claude-plugin files already there, when a skill is added, then they are left alone and only the skill is written", async () => {
    const market = text({ ...MARKET_JSON, name: "mine" });
    const ctx = await linked({
      files: {
        "README.md": "# plugins\n",
        [MARKET]: market,
        [MANIFEST]: '{"name":"commun"}\n',
      },
    });

    const res = await apply(ctx, {
      kind: "skill",
      name: "lint",
      before: null,
      after: SK,
    });

    expect(res.status).toBe(200);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: "feat: add the shared skill lint (Cockpit)",
    });
    const files = ctx.git.filesAt(ctx.git.head) ?? {};
    expect(files[SKILL]).toBe(SK);
    expect(files[MARKET]).toBe(market);
    expect(files[MANIFEST]).toBe('{"name":"commun"}\n');
  });

  it.each([
    [
      "agent update",
      { kind: "agent", name: "dev", before: AG, after: `${AG}More\n` },
      AGENT,
      `${AG}More\n`,
      "feat: update the shared agent dev (Cockpit)",
      "save_shared_agent",
    ],
    [
      "agent remove",
      { kind: "agent", name: "dev", before: AG, after: null },
      AGENT,
      undefined,
      "feat: remove the shared agent dev (Cockpit)",
      "delete_shared_agent",
    ],
    [
      "skill update",
      { kind: "skill", name: "lint", before: SK, after: `${SK}More\n` },
      SKILL,
      `${SK}More\n`,
      "feat: update the shared skill lint (Cockpit)",
      "save_shared_skill",
    ],
    [
      "skill remove",
      { kind: "skill", name: "lint", before: SK, after: null },
      SKILL,
      undefined,
      "feat: remove the shared skill lint (Cockpit)",
      "delete_shared_skill",
    ],
  ])(
    "given existing files, when a %s is applied, then one commit with the message, the path built by the server and the matching entry",
    async (_n, body, path, after, message, action) => {
      const ctx = await linked({
        files: {
          "README.md": "# plugins\n",
          [MARKET]: text(MARKET_JSON),
          [MANIFEST]: "{}\n",
          [AGENT]: AG,
          [SKILL]: SK,
        },
      });

      const res = await apply(ctx, body);

      expect(res.status).toBe(200);
      expect(ctx.git.created.commits).toHaveLength(1);
      expect(ctx.git.created.commits[0]).toMatchObject({ message });
      expect(ctx.git.filesAt(ctx.git.head)?.[path]).toBe(after);
      expect((await pluginRows(ctx)).at(-1)).toMatchObject({
        action,
        args: { path },
        result: "ok",
      });
    },
  );

  it.each([
    ["an unknown kind", { kind: "rule", name: "x", before: null, after: AG }],
    ["no name", { kind: "agent", before: null, after: AG }],
    [
      "a name that climbs",
      { kind: "agent", name: "../x", before: null, after: AG },
    ],
    [
      "before equal to after",
      { kind: "agent", name: "dev", before: AG, after: AG },
    ],
    ["both null", { kind: "skill", name: "lint", before: null, after: null }],
    [
      "an after over 1 MiB",
      {
        kind: "agent",
        name: "dev",
        before: null,
        after: "x".repeat(1_048_577),
      },
    ],
  ])(
    "given %s, when it is applied, then 400 and nothing is written",
    async (_n, body) => {
      const ctx = await linked();

      const res = await apply(ctx, body);

      expect(res.status).toBe(400);
      expect(ctx.git.created.commits).toEqual([]);
    },
  );

  it("given no linked repo, when it is applied, then 409 no_plugin_repo and nothing is written", async () => {
    const ctx = await ready();

    const res = await apply(ctx, {
      kind: "agent",
      name: "dev",
      before: null,
      after: AG,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_plugin_repo" });
    expect(ctx.git.created.commits).toEqual([]);
    expect((await pluginRows(ctx)).at(-1)).toMatchObject({
      action: "save_shared_agent",
      result: "refused",
      detail: { reason: "no_plugin_repo" },
    });
  });

  it("given GitHub that fails before the commit, when it is applied, then 502 and one error entry is recorded", async () => {
    const ctx = await linked();
    ctx.fetchMock.update({
      failOn: (c) => c.path.endsWith("/git/ref/heads/main"),
    });

    const res = await apply(ctx, {
      kind: "agent",
      name: "dev",
      before: null,
      after: AG,
    });

    expect(res.status).toBe(502);
    expect((await pluginRows(ctx)).at(-1)).toMatchObject({
      action: "save_shared_agent",
      result: "error",
    });
  });

  it("given a settings.json already as it would be written, when installing, then 400 and nothing is written", async () => {
    const before = text(INSTALLED);
    const ctx = await linked({}, { [SETTINGS]: before });

    const res = await install(ctx, { install: true, before });

    expect(res.status).toBe(400);
    noWrite(ctx);
  });

  it("given the file changed on GitHub since it was read, when it is applied, then 409 repo_changed, nothing is written and one refused entry is recorded", async () => {
    const ctx = await linked({
      files: { "README.md": "# plugins\n", [AGENT]: AG },
    });
    ctx.git.push({ [AGENT]: "theirs\n" });

    const res = await apply(ctx, {
      kind: "agent",
      name: "dev",
      before: AG,
      after: `${AG}More\n`,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
    expect((await pluginRows(ctx)).at(-1)).toMatchObject({
      action: "save_shared_agent",
      result: "refused",
      detail: { reason: "repo_changed" },
    });
  });

  it("given a protected default branch, when an agent is added, then the answer gives the pull request", async () => {
    const ctx = await linked({
      refUpdateFailure: {
        status: 403,
        message: "Protected branch update failed for refs/heads/main",
      },
    });

    const res = await apply(ctx, {
      kind: "agent",
      name: "dev",
      before: null,
      after: AG,
    });

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { pullRequest: unknown }).pullRequest,
    ).toEqual({ number: 1, url: "https://github.com/user1000/plugins/pull/1" });
  });
});

describe("decision 066 F: GET /api/plugins/projects", () => {
  it("given three projects (installed, not installed, without file) and an archived one, when read, then the non-archived ones come with installed and the text of settings.json", async () => {
    const installed = text({ model: "opus", ...INSTALLED });
    const ctx = await linked({}, { [SETTINGS]: installed });
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 3,
      fullName: "user1000/other",
    });
    const gone = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 4,
      fullName: "user1000/gone",
    });
    await archiveProject(ctx.db, gone);

    const res = await projectsOf(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      projects: [
        {
          id: ctx.projectId,
          fullName: "user1000/app",
          installed: true,
          settings: installed,
        },
        {
          id: other,
          fullName: "user1000/other",
          installed: false,
          settings: null,
        },
      ],
    });
  });

  it("given a settings.json where enabledPlugins holds the plugin as false or another marketplace, when read, then the project is not installed", async () => {
    const off = text({ enabledPlugins: { "commun@cockpit-user1000": false } });
    const ctx = await linked({}, { [SETTINGS]: off });

    const body = (await (await projectsOf(ctx)).json()) as {
      projects: { installed: boolean }[];
    };

    expect(body.projects[0]?.installed).toBe(false);
  });
});

describe("decision 066 F, G: POST /api/projects/:id/plugins/apply", () => {
  const BEFORE = text({
    permissions: { allow: ["Bash"] },
    enabledPlugins: { "other@x": true },
  });

  it("given a settings.json with other keys, when installing, then one commit writes the other keys kept plus the two entries, with the message and entry of 066 G", async () => {
    const ctx = await linked({}, { [SETTINGS]: BEFORE });
    const app = ctx.fetchMock.git("user1000/app");

    const res = await install(ctx, { install: true, before: BEFORE });

    expect(res.status).toBe(200);
    expect(app.created.commits).toHaveLength(1);
    expect(app.created.commits[0]).toMatchObject({
      message: "feat: install the shared plugin (Cockpit)",
    });
    expect(app.filesAt(app.head)?.[SETTINGS]).toBe(
      text({
        permissions: { allow: ["Bash"] },
        enabledPlugins: { "other@x": true, "commun@cockpit-user1000": true },
        extraKnownMarketplaces: INSTALLED.extraKnownMarketplaces,
      }),
    );
    expect((await pluginRows(ctx)).at(-1)).toMatchObject({
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      action: "install_shared_plugin",
      args: { path: SETTINGS },
      result: "ok",
    });
  });

  it("given a project without settings.json, when installing with before null, then the file is created", async () => {
    const ctx = await linked();

    const res = await install(ctx, { install: true, before: null });

    expect(res.status).toBe(200);
    const app = ctx.fetchMock.git("user1000/app");
    expect(app.filesAt(app.head)?.[SETTINGS]).toBe(text(INSTALLED));
  });

  it("given the plugin installed, when removing, then both entries and the keys left empty go and the others stay", async () => {
    const before = text({ model: "opus", ...INSTALLED });
    const ctx = await linked({}, { [SETTINGS]: before });

    const res = await install(ctx, { install: false, before });

    expect(res.status).toBe(200);
    const app = ctx.fetchMock.git("user1000/app");
    expect(app.created.commits[0]).toMatchObject({
      message: "feat: remove the shared plugin (Cockpit)",
    });
    expect(app.filesAt(app.head)?.[SETTINGS]).toBe(text({ model: "opus" }));
    expect((await pluginRows(ctx)).at(-1)).toMatchObject({
      action: "remove_shared_plugin",
    });
  });

  it.each([
    ["not JSON", "{ nope"],
    ["an array", "[]"],
  ])(
    "given a settings.json that is %s, when installing, then 409 invalid_settings and nothing is written",
    async (_n, before) => {
      const ctx = await linked({}, { [SETTINGS]: before });

      const res = await install(ctx, { install: true, before });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "invalid_settings" });
      noWrite(ctx);
      expect((await pluginRows(ctx)).at(-1)).toMatchObject({
        result: "refused",
        detail: { reason: "invalid_settings" },
      });
    },
  );

  it("given no linked repo, when installing, then 409 no_plugin_repo and nothing is written", async () => {
    const ctx = await ready();

    const res = await install(ctx, { install: true, before: null });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_plugin_repo" });
    noWrite(ctx);
  });

  it("given settings.json changed on GitHub since it was read, when installing, then 409 repo_changed and nothing is written", async () => {
    const ctx = await linked({}, { [SETTINGS]: BEFORE });
    ctx.fetchMock.git("user1000/app").push({ [SETTINGS]: "{}\n" });

    const res = await install(ctx, { install: true, before: BEFORE });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.fetchMock.git("user1000/app").created.commits).toEqual([]);
  });

  it.each([
    ["no install", { before: null }],
    ["no before", { install: true }],
    ["an install that is not a boolean", { install: "yes", before: null }],
  ])("given %s, when it is sent, then 400", async (_n, body) => {
    const ctx = await linked();

    expect((await install(ctx, body)).status).toBe(400);
  });

  it("given an archived project, when installing, then 409 project_archived and nothing is written", async () => {
    const ctx = await linked();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await install(ctx, { install: true, before: null });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    noWrite(ctx);
  });

  it("given another user's project, when installing, then 404 and nothing is written", async () => {
    const ctx = await linked();
    // The route exists and serves the owner.
    expect((await install(ctx, { install: true, before: null })).status).toBe(
      200,
    );
    const known = ctx.fetchMock.git("user1000/app").created.commits.length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await install(
      ctx,
      { install: false, before: null },
      ctx.projectId,
      bob.cookie,
    );

    expect(res.status).toBe(404);
    expect(ctx.fetchMock.git("user1000/app").created.commits).toHaveLength(
      known,
    );
  });
});
