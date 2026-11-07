import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Slice C1 (decision 049 D to G): the health line of the catalogue, the update routes and the replacement of an old /analyser.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The state of a file is computed as in catalog-states.test.ts; here the "recorded" hashes come from the table `catalog_writes` (columns project_id, path, sha256, written_at),
//   which the tests fill with raw SQL, and the repo is the fake GitHub. The history of past versions is not seeded here (see catalog-states.test.ts).
// - GET /api/projects/:id/health gains the line `{ key: "catalog", ok, detail: "ok" | "outdated", files: [{ path, state }] }` between `agents` and `webhook` (so it is part of the
//   cached lines), with one `files` entry per file of the catalogue except CLAUDE.md (eight), state `"current" | "old" | "modified" | "absent"`. It is ok when no file is old or absent
//   (modified ones do not count), and it is not in the answer at all for a repo that is not prepared (no `.claude/skills/dev-us/SKILL.md`).
// - POST /api/projects/:id/catalog/plan (no body) answers 200 `{ plan: { files: [{ path, state: "old" | "absent", current: string | null, content }] } }`: only the files to write,
//   sorted by path, `content` the text of the catalogue, `current` the text in the repo (null when absent). A hand-modified or current file is not in it. Nothing is written
//   and no history entry either. 409 `{ error: "not_prepared" }` for a repo that is not prepared, 409 `project_archived`, 404 for a non-member, 401 with no session,
//   409 `empty_repo` / `repo_unreachable` as /prepare, 502 `github_unavailable` on a GitHub error.
// - POST /api/projects/:id/catalog/apply takes `{ files: [{ path, before: string | null }] }` (`before` = `current` of the plan) and answers 200 `{ commitSha, changed: [paths], pullRequest?: { number, url } }`
//   (the shape of applyRepoChanges). The texts written are the catalogue's own, never the browser's. One commit "chore: update the Claude files (Cockpit)", each file read again at the head
//   (`repo_changed`, 409, nothing written, when one is not exactly its `before`), a pull request when the branch is protected (`pull_request_forbidden` as /prepare/apply). 400 when the body is not
//   valid, when a path is not a file of the catalogue (CLAUDE.md included), or when `before` is a text that is hand-modified or already current: such a file is never written, nothing is.
//   It records the SHA-256 of what it wrote in `catalog_writes` (replacing the row of the path), and one `update_catalog` history entry: ok (args { files: <count> }, github_effects { commitSha,
//   pullRequest: <number | null> }), refused (detail { reason }) or error (detail { reason: "error" }).
// - The plan of POST /prepare gets a fourth status, `"update"`: a repo file whose text is an old version (recorded or in the history) of a file of the catalogue (other than CLAUDE.md), with
//   `current` the repo text and `content` the new one. /prepare/apply writes it (replacing it, `repo_changed` if it changed since) and records the hash. A hand-modified file stays `exists`.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const MESSAGE = "chore: update the Claude files (Cockpit)";
const PROTECTED = {
  status: 403,
  message: "Protected branch update failed for refs/heads/main",
};
const NO_PULL_REQUEST_RIGHT = {
  status: 403,
  message: "Resource not accessible by integration",
};
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const fromCatalog = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
    "utf8",
  );
const CATALOG: Record<string, string> = {
  ".claude/agents/test-writer.md": fromCatalog("agents/test-writer.md"),
  ".claude/agents/developer.md": fromCatalog("agents/developer.md"),
  ".claude/agents/reviewer.md": fromCatalog("agents/reviewer.md"),
  ".claude/skills/dev-us/SKILL.md": fromCatalog("skills/dev-us/SKILL.md"),
  ".claude/skills/write-us/SKILL.md": fromCatalog("skills/write-us/SKILL.md"),
  ".claude/agents/cartographer.md": fromCatalog("agents/cartographer.md"),
  ".claude/skills/analyser/SKILL.md": fromCatalog("skills/analyser/SKILL.md"),
  ".claude/agents/rules-analyst.md": fromCatalog("agents/rules-analyst.md"),
  ".claude/agents/bug-hunter.md": fromCatalog("agents/bug-hunter.md"),
  ".claude/agents/security-reviewer.md": fromCatalog(
    "agents/security-reviewer.md",
  ),
  ".claude/agents/architect.md": fromCatalog("agents/architect.md"),
};
const PATHS = Object.keys(CATALOG).sort();
const DEV = ".claude/agents/developer.md";
const REVIEWER = ".claude/agents/reviewer.md";
const WRITE_US = ".claude/skills/write-us/SKILL.md";
const SKILL = ".claude/skills/analyser/SKILL.md";
const OLD_DEV = "the developer of long ago\n";
const OLD_SKILL = "the analyser of long ago\n";
const MINE = "my own write-us\n";

/** A repo whose catalogue files are current, with `changes` on top (null removes a file). */
const repoWith = (changes: Record<string, string | null> = {}) => ({
  "README.md": "# app\n",
  ...Object.fromEntries(
    Object.entries({ ...CATALOG, ...changes }).filter(([, t]) => t !== null),
  ),
});

type Ctx = Awaited<ReturnType<typeof ready>>;
/** Alice and her project, the repo served with a Git history. */
async function ready(
  changes: Record<string, string | null> = {},
  repo: FakeGitRepoOptions = {},
) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: repoWith(changes), ...repo } },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}
/** The same repo served as the health check reads it (no Git history). */
const healthy = (changes: Record<string, string | null> = {}) =>
  withProject({ files: repoWith(changes) });

/** What Cockpit says it wrote (decision 049 A), seeded. */
const remember = (
  ctx: { db: Ctx["db"]; projectId: number },
  path: string,
  text: string,
) =>
  ctx.db.execute(
    sql`insert into catalog_writes (project_id, path, sha256, written_at) values (${ctx.projectId}, ${path}, ${sha256(text)}, now())`,
  );
const kept = async (ctx: Pick<Ctx, "db">) =>
  (
    (await ctx.db.execute(
      sql`select path, sha256 from catalog_writes order by path`,
    )) as unknown as { rows: { path: string; sha256: string }[] }
  ).rows;

const post = (
  ctx: Pick<Ctx, "app" | "projectId">,
  cookie: string,
  path: string,
  body?: unknown,
  id: number | string = ctx.projectId,
) =>
  ctx.app.request(`/api/projects/${id}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const plan = (ctx: Ctx) =>
  post(ctx, ctx.alice.cookie, "/catalog/plan", undefined);
const apply = (ctx: Ctx, body: unknown) =>
  post(ctx, ctx.alice.cookie, "/catalog/apply", body);
const BEFORE_DEV = { path: DEV, before: OLD_DEV };
const BEFORE_REVIEWER = { path: REVIEWER, before: null };

type HealthLine = {
  key: string;
  ok: boolean;
  detail: string;
  files?: { path: string; state: string }[];
};
async function health(ctx: Awaited<ReturnType<typeof healthy>>) {
  const res = await ctx.app.request(`/api/projects/${ctx.projectId}/health`, {
    headers: { cookie: ctx.alice.cookie },
  });
  expect(res.status, "the health must be served").toBe(200);
  return ((await res.json()) as { lines: HealthLine[] }).lines;
}

const writeCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
  );
const noWrite = (ctx: Ctx) => {
  expect(writeCalls(ctx)).toEqual([]);
  expect(ctx.git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
  expect(ctx.git.pullRequests).toEqual([]);
};
const updateRows = (ctx: Ctx) =>
  rows(ctx.db, sql`action = 'update_catalog'`) as Promise<
    (Row & { github_effects: unknown })[]
  >;

describe("decision 049 E: the health line of the catalogue", () => {
  it("given a prepared repo whose files are all current, when the health is read, then the catalog line is ok, sits between agents and webhook and lists the eight files as current", async () => {
    const ctx = await healthy();

    const lines = await health(ctx);

    expect(lines.map((l) => l.key)).toEqual([
      "claude_md",
      "ci",
      "mcp",
      "agents",
      "catalog",
      "webhook",
    ]);
    const line = lines.find((l) => l.key === "catalog") as HealthLine;
    expect(line).toMatchObject({ ok: true, detail: "ok" });
    expect(line.files?.map((f) => f.path).sort()).toEqual(PATHS);
    expect(line.files?.every((f) => f.state === "current")).toBe(true);
  });

  it("given a developer agent that Cockpit wrote in an older version, when the health is read, then the line is red (outdated) and that file is old", async () => {
    const ctx = await healthy({ [DEV]: OLD_DEV });
    await remember(ctx, DEV, OLD_DEV);

    const lines = await health(ctx);

    const line = lines.find((l) => l.key === "catalog") as HealthLine;
    expect(line).toMatchObject({ ok: false, detail: "outdated" });
    expect(line.files?.find((f) => f.path === DEV)?.state).toBe("old");
    expect(line.files?.find((f) => f.path === REVIEWER)?.state).toBe("current");
  });

  it("given a prepared repo that lacks the reviewer agent, when the health is read, then the line is red and that file is absent", async () => {
    const ctx = await healthy({ [REVIEWER]: null });

    const line = (await health(ctx)).find(
      (l) => l.key === "catalog",
    ) as HealthLine;

    expect(line).toMatchObject({ ok: false, detail: "outdated" });
    expect(line.files?.find((f) => f.path === REVIEWER)?.state).toBe("absent");
  });

  it("given a write-us skill changed by hand and nothing else old, when the health is read, then the line stays ok and lists that file as modified", async () => {
    const ctx = await healthy({ [WRITE_US]: MINE });

    const line = (await health(ctx)).find(
      (l) => l.key === "catalog",
    ) as HealthLine;

    expect(line).toMatchObject({ ok: true, detail: "ok" });
    expect(line.files?.find((f) => f.path === WRITE_US)?.state).toBe(
      "modified",
    );
  });

  it("given an old copy that was then edited by hand (the agent editor), when the health is read, then it is modified and the line is not red", async () => {
    const edited = `${OLD_DEV}one line more\n`;
    const ctx = await healthy({ [DEV]: edited });
    await remember(ctx, DEV, OLD_DEV);

    const line = (await health(ctx)).find(
      (l) => l.key === "catalog",
    ) as HealthLine;

    expect(line.ok).toBe(true);
    expect(line.files?.find((f) => f.path === DEV)?.state).toBe("modified");
  });

  it("given a repo with no dev-us skill, when the health is read, then there is no catalog line", async () => {
    const ctx = await healthy({ [".claude/skills/dev-us/SKILL.md"]: null });

    const lines = await health(ctx);

    expect(lines.some((l) => l.key === "catalog")).toBe(false);
  });

  it("given a repo that holds only a README, when the health is read, then there is no catalog line", async () => {
    const ctx = await withProject({ files: { "README.md": "# app\n" } });

    const lines = await health(ctx);

    expect(lines.some((l) => l.key === "catalog")).toBe(false);
  });
});

describe("decision 049 F: POST /api/projects/:id/catalog/plan", () => {
  it("given an old developer agent and an absent reviewer, when the plan is read, then 200 holds those two files, old against new, and nothing is written nor journaled", async () => {
    const ctx = await ready({
      [DEV]: OLD_DEV,
      [REVIEWER]: null,
      [WRITE_US]: MINE,
    });
    await remember(ctx, DEV, OLD_DEV);

    const res = await plan(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plan: {
        files: [
          {
            path: DEV,
            state: "old",
            current: OLD_DEV,
            content: CATALOG[DEV],
          },
          {
            path: REVIEWER,
            state: "absent",
            current: null,
            content: CATALOG[REVIEWER],
          },
        ],
      },
    });
    noWrite(ctx);
    expect(await rows(ctx.db, sql`action = 'update_catalog'`)).toEqual([]);
  });

  it("given a prepared repo that is up to date, when the plan is read, then it holds no file", async () => {
    const ctx = await ready();

    const res = await plan(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: { files: [] } });
  });

  it("given a repo that is not prepared, when the plan is read, then 409 not_prepared", async () => {
    const ctx = await ready({ [".claude/skills/dev-us/SKILL.md"]: null });

    const res = await plan(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_prepared" });
  });

  it("given an archived project, when the plan is read, then 409 project_archived", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await plan(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
  });

  it("given a user who is not a member and a request with no session, when the plan is read, then 404 and 401, and nothing is written", async () => {
    const ctx = await ready();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const stranger = await post(ctx, bob.cookie, "/catalog/plan");
    const anonymous = await ctx.app.request(
      `/api/projects/${ctx.projectId}/catalog/plan`,
      { method: "POST" },
    );

    expect(stranger.status).toBe(404);
    expect(anonymous.status).toBe(401);
    noWrite(ctx);
  });
});

describe("decision 049 F: POST /api/projects/:id/catalog/apply", () => {
  it("given an old and an absent file next to a hand-modified one, when the update is applied, then one commit writes the two with the text of the catalogue and the modified one is untouched", async () => {
    const ctx = await ready({
      [DEV]: OLD_DEV,
      [REVIEWER]: null,
      [WRITE_US]: MINE,
    });
    await remember(ctx, DEV, OLD_DEV);
    const before = ctx.git.head;

    const res = await apply(ctx, { files: [BEFORE_DEV, BEFORE_REVIEWER] });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      changed: string[];
    };
    expect([...body.changed].sort()).toEqual([DEV, REVIEWER]);
    expect(body).not.toHaveProperty("pullRequest");
    expect(ctx.git.head).toBe(body.commitSha);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: MESSAGE,
      parents: [before],
    });
    expect(ctx.git.filesAt(body.commitSha)).toEqual(
      repoWith({ [WRITE_US]: MINE }),
    );
  });

  it("given the update applied, when the table is read, then the two files are kept with the hash of the new text (the old row replaced) and the modified one is not", async () => {
    const ctx = await ready({
      [DEV]: OLD_DEV,
      [REVIEWER]: null,
      [WRITE_US]: MINE,
    });
    await remember(ctx, DEV, OLD_DEV);

    await apply(ctx, { files: [BEFORE_DEV, BEFORE_REVIEWER] });

    expect(await kept(ctx)).toEqual([
      { path: DEV, sha256: sha256(CATALOG[DEV] as string) },
      { path: REVIEWER, sha256: sha256(CATALOG[REVIEWER] as string) },
    ]);
  });

  it("given the update applied, when the plan is read again, then it is empty", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV });
    await remember(ctx, DEV, OLD_DEV);
    await apply(ctx, { files: [BEFORE_DEV] });

    const res = await plan(ctx);

    expect(await res.json()).toEqual({ plan: { files: [] } });
  });

  it("given a file that was edited on GitHub after the plan, when the update is applied, then 409 repo_changed, nothing is written nor kept", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV, [REVIEWER]: null });
    await remember(ctx, DEV, OLD_DEV);
    const kept0 = await kept(ctx);
    ctx.git.push({ [DEV]: `${OLD_DEV}edited meanwhile\n` }, "push");
    const head = ctx.git.head;

    const res = await apply(ctx, { files: [BEFORE_DEV, BEFORE_REVIEWER] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
    expect(ctx.git.head).toBe(head);
    expect(await kept(ctx)).toEqual(kept0);
  });

  it("given an absent file created on GitHub after the plan, when the update is applied, then 409 repo_changed and nothing is written", async () => {
    const ctx = await ready({ [REVIEWER]: null });
    ctx.git.push({ [REVIEWER]: "someone was faster\n" }, "push");

    const res = await apply(ctx, { files: [BEFORE_REVIEWER] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
  });

  it("given a protected default branch, when the update is applied, then 200 with a pull request, the default branch is untouched", async () => {
    const ctx = await ready(
      { [DEV]: OLD_DEV },
      { refUpdateFailure: PROTECTED },
    );
    await remember(ctx, DEV, OLD_DEV);
    const before = ctx.git.head;

    const res = await apply(ctx, { files: [BEFORE_DEV] });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      pullRequest: { number: number; url: string };
    };
    expect(body.pullRequest).toEqual({
      number: 1,
      url: `https://github.com/${REPO}/pull/1`,
    });
    expect(ctx.git.head).toBe(before);
    expect(ctx.git.branch(`cockpit/${body.commitSha.slice(0, 7)}`)).toBe(
      body.commitSha,
    );
  });

  it("given a protected branch and an App without Pull requests: write, when the update is applied, then 409 pull_request_forbidden with the settings of the App", async () => {
    const ctx = await ready(
      { [DEV]: OLD_DEV },
      {
        refUpdateFailure: PROTECTED,
        pullRequestFailure: NO_PULL_REQUEST_RIGHT,
      },
    );
    await remember(ctx, DEV, OLD_DEV);

    const res = await apply(ctx, { files: [BEFORE_DEV] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "pull_request_forbidden",
      appSettingsUrl: "https://github.com/settings/apps/cockpit-test",
    });
  });

  it.each([
    ["a hand-modified file", [{ path: WRITE_US, before: MINE }]],
    ["a file already current", [{ path: DEV, before: CATALOG[DEV] as string }]],
    ["CLAUDE.md", [{ path: "CLAUDE.md", before: null }]],
    ["a path outside the catalogue", [{ path: "src/evil.ts", before: null }]],
    ["a path that escapes", [{ path: "../x", before: null }]],
    ["no file", []],
  ])(
    "given a request for %s, when the update is applied, then 400, nothing is written and nothing is journaled as ok",
    async (_name, files) => {
      const ctx = await ready({ [WRITE_US]: MINE });

      const res = await apply(ctx, { files });

      expect(res.status).toBe(400);
      noWrite(ctx);
      expect(await kept(ctx)).toEqual([]);
    },
  );

  it("given a body that is not valid, when the update is applied, then 400 and nothing is written", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV });
    await remember(ctx, DEV, OLD_DEV);

    for (const body of [{}, { files: "x" }, { files: [{ path: DEV }] }]) {
      expect((await apply(ctx, body)).status).toBe(400);
    }
    noWrite(ctx);
  });

  it("given an archived project, when the update is applied, then 409 project_archived, nothing is written, and one refused entry is journaled", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV });
    await remember(ctx, DEV, OLD_DEV);
    await archiveProject(ctx.db, ctx.projectId);

    const res = await apply(ctx, { files: [BEFORE_DEV] });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    noWrite(ctx);
    expect(await updateRows(ctx)).toMatchObject([
      { result: "refused", detail: { reason: "project_archived" } },
    ]);
  });

  it("given a user who is not a member, when the update is applied, then 404 and nothing is written", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await post(ctx, bob.cookie, "/catalog/apply", {
      files: [BEFORE_DEV],
    });

    expect(res.status).toBe(404);
    noWrite(ctx);
  });

  it("given the update applied, when the history is read, then one ok update_catalog entry of the human, from the UI, holds the count and the commit", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV, [REVIEWER]: null });
    await remember(ctx, DEV, OLD_DEV);

    const res = await apply(ctx, { files: [BEFORE_DEV, BEFORE_REVIEWER] });

    const { commitSha } = (await res.json()) as { commitSha: string };
    expect(await updateRows(ctx)).toMatchObject([
      {
        user_id: ctx.alice.id,
        token_id: null,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        action: "update_catalog",
        args: { files: 2 },
        result: "ok",
        detail: null,
        github_effects: { commitSha, pullRequest: null },
      },
    ]);
  });

  it("given a file edited after the plan, when the update is applied, then one refused update_catalog entry holds repo_changed", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV });
    await remember(ctx, DEV, OLD_DEV);
    ctx.git.push({ [DEV]: "edited meanwhile\n" }, "push");

    await apply(ctx, { files: [BEFORE_DEV] });

    expect(await updateRows(ctx)).toMatchObject([
      { result: "refused", detail: { reason: "repo_changed" } },
    ]);
  });

  it("given a GitHub error during the write, when the update is applied, then 502 github_unavailable, an error entry, and nothing is kept", async () => {
    const ctx = await ready({ [DEV]: OLD_DEV });
    await remember(ctx, DEV, OLD_DEV);
    ctx.fetchMock.update({
      failOn: (call) =>
        call.method === "POST" && call.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, { files: [BEFORE_DEV] });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
    expect(await updateRows(ctx)).toMatchObject([
      { result: "error", detail: { reason: "error" } },
    ]);
    expect(await kept(ctx)).toEqual([{ path: DEV, sha256: sha256(OLD_DEV) }]);
  });
});

describe("decision 049 G: « Ajouter /analyser au repo » replaces an old original", () => {
  type Plan = {
    baseSha: string;
    signature: string;
    files: {
      path: string;
      content: string;
      status: string;
      current?: string;
    }[];
  };
  const prepare = async (ctx: Ctx) => {
    const res = await post(ctx, ctx.alice.cookie, "/prepare");
    expect(res.status, "the plan must be served").toBe(200);
    return ((await res.json()) as { plan: Plan }).plan;
  };

  it("given an analyser skill that Cockpit wrote in an older version, when the plan is read, then that file is update with the old text as current and the new one as content", async () => {
    const ctx = await ready({ [SKILL]: OLD_SKILL });
    await remember(ctx, SKILL, OLD_SKILL);

    const found = (await prepare(ctx)).files.find((f) => f.path === SKILL);

    expect(found).toEqual({
      path: SKILL,
      content: CATALOG[SKILL],
      status: "update",
      current: OLD_SKILL,
    });
  });

  it("given an analyser skill changed by hand, when the plan is read, then it stays exists with its text", async () => {
    const ctx = await ready({ [SKILL]: "my analyser\n" });
    await remember(ctx, SKILL, OLD_SKILL);

    const found = (await prepare(ctx)).files.find((f) => f.path === SKILL);

    expect(found).toMatchObject({
      status: "exists",
      current: "my analyser\n",
    });
  });

  it("given the plan reduced to the analyser files, when it is applied, then the old skill is replaced in one commit, the hash is kept and the commit says it is a preparation", async () => {
    const ctx = await ready({ [SKILL]: OLD_SKILL });
    await remember(ctx, SKILL, OLD_SKILL);
    const full = await prepare(ctx);

    const res = await post(ctx, ctx.alice.cookie, "/prepare/apply", {
      plan: { ...full, files: full.files.filter((f) => f.path === SKILL) },
    });

    expect(res.status).toBe(200);
    const { commitSha } = (await res.json()) as { commitSha: string };
    expect(ctx.git.filesAt(commitSha)?.[SKILL]).toBe(CATALOG[SKILL]);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(await kept(ctx)).toEqual([
      { path: SKILL, sha256: sha256(CATALOG[SKILL] as string) },
    ]);
  });

  it("given an old skill edited on GitHub after the plan, when the plan is applied, then 409 repo_changed and nothing is written", async () => {
    const ctx = await ready({ [SKILL]: OLD_SKILL });
    await remember(ctx, SKILL, OLD_SKILL);
    const full = await prepare(ctx);
    ctx.git.push({ [SKILL]: "edited meanwhile\n" }, "push");

    const res = await post(ctx, ctx.alice.cookie, "/prepare/apply", {
      plan: { ...full, files: full.files.filter((f) => f.path === SKILL) },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
  });
});
