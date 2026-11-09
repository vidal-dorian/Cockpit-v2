import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_PERMISSIONS,
  BASE_PERMISSIONS,
  type FakeGitRepoOptions,
  type FakeRun,
  githubCalls,
  installationUrl,
} from "./test-github.ts";
import {
  archiveProject,
  type Row,
  rows,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 12.4 (decision 067 B, C, D): the workflows of a project, the starter CI and the permission `workflows`, through `app.request()` against the fake GitHub.
//
// Contract assumed where the decision leaves it open (same conventions as claude-config.test.ts, decision 065):
// - GET /api/projects/:id/workflows answers 200 {
//     workflows: [{ path, name, event, lastRun, failingSince, averageSeconds }]   in the order of the Actions API; `path` is the repo path, `name` the workflow's name,
//       `event` the event of the latest run (null without run), `lastRun` { conclusion, at, url } (`at` = the ISO `created_at` of the run, `url` = its `html_url`) or null,
//       `failingSince` the failed runs in a row from the newest (0 when the newest did not fail), `averageSeconds` the mean of `updated_at - run_started_at` of the
//       completed runs among the 10 newest of the DEFAULT branch (null without run); the runs come from `GET .../actions/workflows/{id}/runs?branch=<default>&per_page=10`,
//     starter: null (a file exists in .github/workflows)
//            | { language: null }                                                     (nothing recognised)
//            | { language: "node" | "python" | "go" | "rust", path: ".github/workflows/ci.yml", content: <text of catalog/ci/<language>.yml> },
//     permission: { workflows: boolean, installationUrl: string }   (`workflows` is true when GET /app/installations/{id} has `workflows: "write"`; the url is its `html_url`),
//     proposal: ...                                                                   (workflow-proposals.test.ts)
//   }
//   Member only (404 for another user's project), readable on an archived project, no history entry; GitHub failing: 502 { error: "github_unavailable" }.
// - POST /api/projects/:id/workflows/starter/apply takes { language } and answers 200 { commitSha, pullRequest? } like claude-config/apply; a body that does not fit is 400
//   (nothing written, no entry); a refusal is 409 { error: "<code>" } with one refused `add_starter_ci` entry, detail { reason: <code> }.
//   The entry is human / ui, args { language }, github_effects { commitSha, pullRequest: <number | null> }.
// - GitHub refusing the write for lack of the permission (a 403 whose message says the App cannot "create or update workflow ... without `workflows` permission", on the ref
//   update) is 409 workflows_forbidden, never the pull request of decision 026 G.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const WORKFLOWS_DIR = ".github/workflows";
const CI = `${WORKFLOWS_DIR}/ci.yml`;
const catalogDir = fileURLToPath(new URL("../../catalog/", import.meta.url));
const template = (language: string) =>
  readFileSync(`${catalogDir}ci/${language}.yml`, "utf8");

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(
  repo: FakeGitRepoOptions = {},
  github: Parameters<typeof withProject>[0] = {},
) {
  const ctx = await withProject({
    ...github,
    gitRepos: {
      [REPO]: {
        files: { "README.md": "# app\n", [CI]: "on: push\n" },
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
) => call(ctx, cookie, `/api/projects/${id}/workflows`, "GET");
const apply = (
  ctx: Ctx,
  body: unknown,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) =>
  call(
    ctx,
    cookie,
    `/api/projects/${id}/workflows/starter/apply`,
    "POST",
    body,
  );
const starterOf = async (ctx: Ctx) =>
  ((await (await read(ctx)).json()) as { starter: unknown }).starter;
const starterRows = (ctx: Ctx) =>
  rows(ctx.db, sql`action = 'add_starter_ci'`) as Promise<
    (Row & { github_effects: unknown })[]
  >;

const T0 = Date.parse("2026-11-08T10:00:00Z");
/** The nth run before T0, an hour apart. */
const run = (
  n: number,
  conclusion: FakeRun["conclusion"],
  seconds: number,
  extra: Partial<FakeRun> = {},
): FakeRun => ({
  conclusion,
  seconds,
  at: new Date(T0 - n * 3_600_000).toISOString(),
  ...extra,
});

describe("decision 067 B: GET /api/projects/:id/workflows", () => {
  it("given three workflows (one red for 3 runs, one with no run), when a member reads them, then each has its path, name, event, last run, failing streak and average on the 10 newest runs of the default branch", async () => {
    const ctx = await ready();
    ctx.git.workflows.push(
      {
        path: CI,
        name: "CI",
        runs: [
          run(1, "success", 240, { event: "pull_request" }),
          run(2, "success", 240),
          run(3, "success", 240),
        ],
      },
      {
        path: `${WORKFLOWS_DIR}/nightly.yml`,
        name: "Tests de nuit",
        runs: [
          // A newer failure on another branch counts for nothing.
          run(0, "failure", 9999, { branch: "feature" }),
          run(1, "failure", 60, { event: "schedule" }),
          run(2, "failure", 120),
          run(3, "failure", 180),
          ...[4, 5, 6, 7, 8, 9, 10].map((n) => run(n, "success", 300)),
          // Beyond the 10 newest: not in the average.
          run(11, "failure", 6000),
          run(12, "failure", 6000),
        ],
      },
      { path: `${WORKFLOWS_DIR}/cd.yml`, name: "CD", runs: [] },
    );

    const res = await read(ctx);

    expect(res.status).toBe(200);
    const { workflows } = (await res.json()) as { workflows: unknown };
    expect(workflows).toEqual([
      {
        path: CI,
        name: "CI",
        event: "pull_request",
        lastRun: {
          conclusion: "success",
          at: new Date(T0 - 3_600_000).toISOString(),
          url: "https://github.com/user1000/app/actions/runs/1000",
        },
        failingSince: 0,
        averageSeconds: 240,
      },
      {
        path: `${WORKFLOWS_DIR}/nightly.yml`,
        name: "Tests de nuit",
        event: "schedule",
        lastRun: {
          conclusion: "failure",
          at: new Date(T0 - 3_600_000).toISOString(),
          url: "https://github.com/user1000/app/actions/runs/2000",
        },
        failingSince: 3,
        // (60 + 120 + 180 + 7 * 300) / 10
        averageSeconds: 246,
      },
      {
        path: `${WORKFLOWS_DIR}/cd.yml`,
        name: "CD",
        event: null,
        lastRun: null,
        failingSince: 0,
        averageSeconds: null,
      },
    ]);
    expect(await rows(ctx.db, sql`action <> 'create_token'`)).toEqual([]);
  });

  it("given an archived project, when a member reads it, then it is served", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    expect((await read(ctx)).status).toBe(200);
  });

  it("given another user's project, when it is read, then 404", async () => {
    const ctx = await ready();
    // The route exists and serves the owner (a missing route also answers 404).
    expect((await read(ctx)).status).toBe(200);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    expect((await read(ctx, ctx.projectId, bob.cookie)).status).toBe(404);
  });

  it("given GitHub that fails on the Actions API, when it is read, then 502 github_unavailable", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.path.endsWith("/actions/workflows"),
    });

    const res = await read(ctx);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });
});

describe("decision 067 C: the starter CI", () => {
  it.each([
    ["package.json", ["package.json"], "node"],
    ["pyproject.toml", ["pyproject.toml"], "python"],
    ["requirements.txt", ["requirements.txt"], "python"],
    ["go.mod", ["go.mod"], "go"],
    ["Cargo.toml", ["Cargo.toml"], "rust"],
    ["package.json before go.mod", ["go.mod", "package.json"], "node"],
    ["package.json before Cargo.toml", ["Cargo.toml", "package.json"], "node"],
    ["pyproject.toml before go.mod", ["go.mod", "pyproject.toml"], "python"],
    [
      "requirements.txt before Cargo.toml",
      ["Cargo.toml", "requirements.txt"],
      "python",
    ],
    ["go.mod before Cargo.toml", ["Cargo.toml", "go.mod"], "go"],
  ])(
    "given a repo with no workflow and %s at the root, when it is read, then the starter is the template of the matching language, shown in full",
    async (_name, roots, language) => {
      const ctx = await ready({
        files: {
          "README.md": "# app\n",
          ...Object.fromEntries(roots.map((f) => [f, "x\n"])),
        },
      });

      expect(await starterOf(ctx)).toEqual({
        language,
        path: CI,
        content: template(language),
      });
    },
  );

  it("given a repo with no workflow and no known manifest at the root, when it is read, then nothing is recognised and no template is offered", async () => {
    const ctx = await ready({
      files: { "README.md": "# app\n", "sub/package.json": "{}\n" },
    });

    expect(await starterOf(ctx)).toEqual({ language: null });
  });

  it("given a repo that already has a workflow file, when it is read, then no starter is offered", async () => {
    const ctx = await ready({
      files: {
        "package.json": "{}\n",
        [`${WORKFLOWS_DIR}/release.yml`]: "on: push\n",
      },
    });

    expect(await starterOf(ctx)).toBeNull();
  });

  it("given a recognised Node repo with no workflow, when a member applies the starter, then one commit writes .github/workflows/ci.yml with the template and one add_starter_ci entry holds the language", async () => {
    const ctx = await ready({ files: { "package.json": "{}\n" } });
    const base = ctx.git.head;

    const res = await apply(ctx, { language: "node" });

    expect(res.status).toBe(200);
    const { commitSha } = (await res.json()) as { commitSha: string };
    expect(commitSha).toBe(ctx.git.head);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({ parents: [base] });
    expect(ctx.git.filesAt(ctx.git.head)?.[CI]).toBe(template("node"));
    const found = await starterRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      args: { language: "node" },
      result: "ok",
      github_effects: { commitSha, pullRequest: null },
    });
  });

  it.each([
    [
      "a language that is not the repo's",
      { files: { "package.json": "{}\n" } },
      "go",
    ],
    [
      "a repo where nothing is recognised",
      { files: { "README.md": "# app\n" } },
      "node",
    ],
  ] as [string, FakeGitRepoOptions, string][])(
    "given %s, when the starter is applied, then 409 wrong_language, nothing is written and the refusal is recorded",
    async (_name, repo, language) => {
      const ctx = await ready(repo);

      const res = await apply(ctx, { language });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "wrong_language" });
      expect(ctx.git.created.commits).toEqual([]);
      expect(await starterRows(ctx)).toMatchObject([
        { result: "refused", detail: { reason: "wrong_language" } },
      ]);
    },
  );

  it("given a repo where .github/workflows/ci.yml now exists, when the starter is applied, then 409 repo_changed and nothing is written", async () => {
    const ctx = await ready({
      files: { "package.json": "{}\n", [CI]: "on: push\n" },
    });

    const res = await apply(ctx, { language: "node" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
  });

  it.each([
    ["no language", {}],
    ["an unknown language", { language: "cobol" }],
  ])(
    "given %s, when the starter is applied, then 400, nothing is written and no entry",
    async (_name, body) => {
      const ctx = await ready({ files: { "package.json": "{}\n" } });

      expect((await apply(ctx, body)).status).toBe(400);
      expect(
        githubCalls(ctx.fetchMock).filter((c) => c.method !== "GET"),
      ).toEqual([]);
      expect(await starterRows(ctx)).toEqual([]);
    },
  );

  it("given another user's project, when the starter is applied, then 404 and nothing is written", async () => {
    const ctx = await ready({ files: { "package.json": "{}\n" } });
    expect((await apply(ctx, { language: "node" })).status).toBe(200);
    const known = ctx.git.created.commits.length;
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const res = await apply(
      ctx,
      { language: "node" },
      ctx.projectId,
      bob.cookie,
    );

    expect(res.status).toBe(404);
    expect(ctx.git.created.commits).toHaveLength(known);
  });
});

describe("decision 067 D: the permission workflows", () => {
  const permissions = (workflows?: string) => ({
    ...BASE_PERMISSIONS,
    ...ALERT_PERMISSIONS,
    workflows,
  });

  it.each([
    ["write", true],
    ["read", false],
    [undefined, false],
  ])(
    "given an installation whose workflows permission is %s, when the workflows are read, then permission.workflows is %s and the url is the installation's",
    async (granted, expected) => {
      const ctx = await ready(
        {},
        {
          installationInfo: {
            permissions: Object.fromEntries(
              Object.entries(permissions(granted)).filter(
                ([, v]) => v !== undefined,
              ),
            ) as Record<string, string>,
          },
        },
      );

      const body = (await (await read(ctx)).json()) as { permission: unknown };

      expect(body.permission).toEqual({
        workflows: expected,
        installationUrl: installationUrl(),
      });
    },
  );

  it("given GitHub that refuses the write for lack of the workflows permission, when the starter is applied, then 409 workflows_forbidden, no pull request is opened and the refusal is recorded", async () => {
    const ctx = await ready({
      files: { "package.json": "{}\n" },
      refUpdateFailure: {
        status: 403,
        message: `refusing to allow a GitHub App to create or update workflow \`${CI}\` without \`workflows\` permission`,
      },
    });

    const res = await apply(ctx, { language: "node" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "workflows_forbidden" });
    expect(ctx.git.pullRequests).toEqual([]);
    expect(ctx.git.refsCreated).toEqual([]);
    expect(await starterRows(ctx)).toMatchObject([
      { result: "refused", detail: { reason: "workflows_forbidden" } },
    ]);
  });
});
