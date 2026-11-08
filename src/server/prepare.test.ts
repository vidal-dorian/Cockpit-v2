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

// Slice 6.2 (decisions 027 B, D, E): the routes that prepare a repo for Claude.
// Tested through `app.request()` against the fake GitHub that keeps a Git history (`gitRepos`, decision 026): the repo is served to
// `planRepoWrite` / `applyRepoWrite` only (the fake does not serve the health reads on such a repo, and the routes need none).
//
// Pinned where the decision leaves it open:
// - The files planned come from the catalogue: .claude/agents/{test-writer,developer,reviewer}.md, .claude/skills/{dev-us,write-us}/SKILL.md
//   and CLAUDE.md, each taken from `catalog/` (`catalog/agents/<name>.md`, `catalog/skills/<name>/SKILL.md`, `catalog/CLAUDE.md`), content equal to the file.
//   CLAUDE.md is not in the plan at all (no entry, whatever its status) when the repo has a CLAUDE.md or a .claude/CLAUDE.md (013 C).
// - POST /api/projects/:id/prepare (no body) answers 200 { plan } with the plan of 026 as is: { baseSha, signature, files: [{ path, content, status, current? }] }.
// - POST /api/projects/:id/prepare/apply takes { plan } and answers 200 { commitSha, created, pullRequest?: { number, url } } (026 F), the commit message being
//   "feat: prepare the repo for Claude (Cockpit)".
// - A refusal is 409 { error: "<code>" } on both routes (the shape of `repo_unreachable` in the health route and of `project_archived` elsewhere);
//   `pull_request_forbidden` also carries `appSettingsUrl` (https://github.com/settings/apps/<slug>), which the page links to: a project member is not an administrator,
//   so the settings route of the address cannot give it.
// - A plan that is not valid (a body that is not { plan: { baseSha: string, files: [...] } }, a status other than create/same/exists, a path 026 D refuses) is 400,
//   whatever the account; nothing is written to GitHub.
// - An error of GitHub is 502 { error: "github_unavailable" } (as the health route), recorded as an `error` entry for the apply.
// - POST /prepare writes no history entry, whatever it answers (a read is not an action, 013 G). POST /prepare/apply writes one `prepare_repo` entry:
//   ok (args { created: <number> }, github_effects { commitSha, pullRequest: <number | null> }), refused (detail { reason: <code> }) or error (detail { reason: "error" }).

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const MESSAGE = "feat: prepare the repo for Claude (Cockpit)";
const PROTECTED = {
  status: 403,
  message: "Protected branch update failed for refs/heads/main",
};
const NO_PULL_REQUEST_RIGHT = {
  status: 403,
  message: "Resource not accessible by integration",
};

// A missing file is a marker text, not an exception: the tests then fail on the route (or the catalogue test on the file), not all on the same ENOENT at load time.
const fromCatalog = (relative: string) => {
  try {
    return readFileSync(
      fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
      "utf8",
    );
  } catch {
    return `missing catalog/${relative}`;
  }
};
/** Where each file of the catalogue goes in a repo (decision 027 B), with its content. */
const CATALOG: Record<string, string> = {
  "CLAUDE.md": fromCatalog("CLAUDE.md"),
  ".claude/agents/test-writer.md": fromCatalog("agents/test-writer.md"),
  ".claude/agents/developer.md": fromCatalog("agents/developer.md"),
  ".claude/agents/reviewer.md": fromCatalog("agents/reviewer.md"),
  ".claude/skills/dev-us/SKILL.md": fromCatalog("skills/dev-us/SKILL.md"),
  ".claude/skills/write-us/SKILL.md": fromCatalog("skills/write-us/SKILL.md"),
  // Slice R1 (decision 043 M).
  ".claude/agents/cartographer.md": fromCatalog("agents/cartographer.md"),
  ".claude/skills/analyser/SKILL.md": fromCatalog("skills/analyser/SKILL.md"),
  // Slice R2 (decision 047 M).
  ".claude/agents/rules-analyst.md": fromCatalog("agents/rules-analyst.md"),
  ".claude/agents/bug-hunter.md": fromCatalog("agents/bug-hunter.md"),
  ".claude/agents/security-reviewer.md": fromCatalog(
    "agents/security-reviewer.md",
  ),
  ".claude/agents/architect.md": fromCatalog("agents/architect.md"),
};
const ALL = Object.keys(CATALOG).sort();
const WITHOUT_CLAUDE_MD = ALL.filter((p) => p !== "CLAUDE.md");

type PlanFile = {
  path: string;
  content: string;
  status: string;
  current?: string;
};
type Plan = { baseSha: string; signature: string; files: PlanFile[] };

type Ctx = Awaited<ReturnType<typeof ready>>;

/** Alice and her project user1000/app, whose repo is served with a Git history (a README, plus what `repo` changes). */
async function ready(repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: { "README.md": "# app\n" }, ...repo } },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}

const post = (
  ctx: Pick<Ctx, "app">,
  cookie: string,
  path: string,
  body?: unknown,
) =>
  ctx.app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const prepare = (
  ctx: Ctx,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => post(ctx, cookie, `/api/projects/${id}/prepare`);
const apply = (
  ctx: Ctx,
  body: unknown,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => post(ctx, cookie, `/api/projects/${id}/prepare/apply`, body);

/** The plan of /prepare, which must be served. */
async function planOf(ctx: Ctx) {
  const res = await prepare(ctx);
  expect(res.status, "the plan must be served for this test").toBe(200);
  return ((await res.json()) as { plan: Plan }).plan;
}
const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : 1;
const statusesOf = (plan: Plan) =>
  Object.fromEntries(plan.files.map((f) => [f.path, f.status]));

/** A well formed plan nobody signed, for the cases where /prepare cannot be served. */
const unsigned = (baseSha = "0".repeat(40)) => ({
  baseSha,
  files: Object.entries(CATALOG).map(([path, content]) => ({
    path,
    content,
    status: "create",
  })),
});

/** What the code under test wrote into the repo (the installation token request is not one). */
const writeCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.method !== "GET" && c.path.startsWith("/repos/"),
  );
/** Every call on the repo, reads included. */
const repoCalls = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter((c) => c.path.startsWith("/repos/"));
const noWrite = (ctx: Ctx) => {
  expect(writeCalls(ctx)).toEqual([]);
  expect(ctx.git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
  expect(ctx.git.refsCreated).toEqual([]);
  expect(ctx.git.pullRequests).toEqual([]);
};

// Raw SQL like the other helpers, so no test depends on the Drizzle export of a column.
const prepareRows = (ctx: Ctx) =>
  rows(ctx.db, sql`action = 'prepare_repo'`) as Promise<
    (Row & { github_effects: unknown })[]
  >;

describe("decision 027 D: POST /api/projects/:id/prepare", () => {
  it("given a repo with none of the files, when the plan is read, then 200 { plan } holds the eight files of the catalogue, each create with the content of the catalogue, the base is the head of the default branch and the plan is signed", async () => {
    const ctx = await ready();

    const res = await prepare(ctx);

    expect(res.status).toBe(200);
    const { plan } = (await res.json()) as { plan: Plan };
    expect(plan.baseSha).toBe(ctx.git.head);
    expect(typeof plan.signature).toBe("string");
    expect(plan.signature.length).toBeGreaterThan(0);
    expect([...plan.files].sort(byPath)).toEqual(
      ALL.map((path) => ({
        path,
        content: CATALOG[path],
        status: "create",
      })),
    );
    // Reading only.
    noWrite(ctx);
  });

  it.each([
    ["a CLAUDE.md at the root", { "CLAUDE.md": "# mine\n" }],
    ["a CLAUDE.md in .claude/", { ".claude/CLAUDE.md": "# mine\n" }],
    [
      "the very same CLAUDE.md as the catalogue",
      { "CLAUDE.md": CATALOG["CLAUDE.md"] as string },
    ],
  ])(
    "given a repo with %s, when the plan is read, then CLAUDE.md is not in the plan at all (decision 013 C) and the seven other files are create",
    async (_name, files) => {
      const ctx = await ready({ files: { "README.md": "# app\n", ...files } });

      const plan = await planOf(ctx);

      expect(plan.files.map((f) => f.path).sort()).toEqual(WITHOUT_CLAUDE_MD);
      expect(plan.files.every((f) => f.status === "create")).toBe(true);
    },
  );

  it("given a repo that has an agent changed by hand, a skill identical to the catalogue and an agent that is a directory, when the plan is read, then they are exists with the current text, same and exists with no current, and the rest is create", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        ".claude/agents/developer.md": "my own developer\n",
        ".claude/skills/write-us/SKILL.md": CATALOG[
          ".claude/skills/write-us/SKILL.md"
        ] as string,
        ".claude/agents/reviewer.md/inside.txt": "a directory, not a file\n",
      },
    });

    const plan = await planOf(ctx);

    expect(statusesOf(plan)).toEqual({
      "CLAUDE.md": "create",
      ".claude/agents/test-writer.md": "create",
      ".claude/agents/developer.md": "exists",
      ".claude/agents/reviewer.md": "exists",
      ".claude/skills/dev-us/SKILL.md": "create",
      ".claude/skills/write-us/SKILL.md": "same",
      ".claude/agents/cartographer.md": "create",
      ".claude/skills/analyser/SKILL.md": "create",
      ".claude/agents/rules-analyst.md": "create",
      ".claude/agents/bug-hunter.md": "create",
      ".claude/agents/security-reviewer.md": "create",
      ".claude/agents/architect.md": "create",
    });
    const developer = plan.files.find(
      (f) => f.path === ".claude/agents/developer.md",
    );
    expect(developer).toMatchObject({
      content: CATALOG[".claude/agents/developer.md"],
      current: "my own developer\n",
    });
    const reviewer = plan.files.find(
      (f) => f.path === ".claude/agents/reviewer.md",
    );
    expect(reviewer).not.toHaveProperty("current");
  });

  it("given an instance the wizard has not configured, when the plan is read, then 503 whoever asks", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request("/api/projects/1/prepare", {
      method: "POST",
    });

    expect(res.status).toBe(503);
  });

  it("given no session, when the plan is read, then 401 and GitHub is not called for the repo", async () => {
    const ctx = await ready();

    const res = await post(ctx, "", `/api/projects/${ctx.projectId}/prepare`);

    expect(res.status).toBe(401);
    expect(repoCalls(ctx)).toEqual([]);
  });

  it.each([
    ["another user's project", (ctx: Ctx) => ctx.projectId, 2000],
    ["a project that does not exist", () => 99999, 1000],
    ["an id that is not a number", () => "abc", 1000],
  ])(
    "given %s, when the plan is read, then 404 and GitHub is not called for the repo",
    async (_name, id, githubId) => {
      const ctx = await ready();
      // The route exists and serves the owner (a missing route also answers 404).
      await planOf(ctx);
      const known = repoCalls(ctx).length;
      const asker =
        githubId === 1000
          ? ctx.alice
          : await userWithToken(ctx.app, ctx.db, githubId);

      const res = await prepare(ctx, id(ctx), asker.cookie);

      expect(res.status).toBe(404);
      expect(repoCalls(ctx)).toHaveLength(known);
    },
  );

  it("given an archived project, when the plan is read, then 409 project_archived and GitHub is not called for the repo", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await prepare(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(repoCalls(ctx)).toEqual([]);
  });

  it.each([
    ["empty_repo", { empty: true }],
    ["repo_unreachable", { unreachable: true }],
  ])(
    "given a repo for which the plan is refused with %s, when the plan is read, then 409 with that code, and nothing is written to GitHub or to the history",
    async (code, repo) => {
      const ctx = await ready(repo);

      const res = await prepare(ctx);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
      noWrite(ctx);
      expect(await rows(ctx.db, sql`action = 'prepare_repo'`)).toEqual([]);
    },
  );

  it("given GitHub that fails, when the plan is read, then 502 github_unavailable and no history entry", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({
      failOn: (c) => c.path.endsWith("/git/ref/heads/main"),
    });

    const res = await prepare(ctx);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
    expect(await rows(ctx.db, sql`action = 'prepare_repo'`)).toEqual([]);
  });
});

describe("decision 027 D: POST /api/projects/:id/prepare/apply", () => {
  it("given the plan of /prepare applied unchanged, when it is applied, then 200 with the commit and the eight paths, one commit with exactly the create files on the default branch, nothing else touched", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    const before = ctx.git.head;

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      created: string[];
      pullRequest?: unknown;
    };
    expect([...body.created].sort()).toEqual(ALL);
    expect(body).not.toHaveProperty("pullRequest");
    expect(ctx.git.head).toBe(body.commitSha);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({
      message: MESSAGE,
      parents: [before],
    });
    expect(ctx.git.created.refUpdates).toHaveLength(1);
    expect(ctx.git.filesAt(body.commitSha)).toEqual({
      "README.md": "# app\n",
      ...CATALOG,
    });
  });

  it("given a repo with files already there, when the plan is applied unchanged, then only the create files are written and the others keep their text", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        "CLAUDE.md": "# mine\n",
        ".claude/agents/developer.md": "my own developer\n",
        ".claude/skills/write-us/SKILL.md": CATALOG[
          ".claude/skills/write-us/SKILL.md"
        ] as string,
      },
    });
    const plan = await planOf(ctx);

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { commitSha: string; created: string[] };
    expect([...body.created].sort()).toEqual([
      ".claude/agents/architect.md",
      ".claude/agents/bug-hunter.md",
      ".claude/agents/cartographer.md",
      ".claude/agents/reviewer.md",
      ".claude/agents/rules-analyst.md",
      ".claude/agents/security-reviewer.md",
      ".claude/agents/test-writer.md",
      ".claude/skills/analyser/SKILL.md",
      ".claude/skills/dev-us/SKILL.md",
    ]);
    expect(ctx.git.filesAt(body.commitSha)).toEqual({
      "README.md": "# app\n",
      "CLAUDE.md": "# mine\n",
      ".claude/agents/developer.md": "my own developer\n",
      ".claude/skills/write-us/SKILL.md":
        CATALOG[".claude/skills/write-us/SKILL.md"],
      ".claude/agents/test-writer.md": CATALOG[".claude/agents/test-writer.md"],
      ".claude/agents/reviewer.md": CATALOG[".claude/agents/reviewer.md"],
      ".claude/skills/dev-us/SKILL.md":
        CATALOG[".claude/skills/dev-us/SKILL.md"],
      ".claude/agents/cartographer.md":
        CATALOG[".claude/agents/cartographer.md"],
      ".claude/agents/rules-analyst.md":
        CATALOG[".claude/agents/rules-analyst.md"],
      ".claude/agents/bug-hunter.md": CATALOG[".claude/agents/bug-hunter.md"],
      ".claude/agents/security-reviewer.md":
        CATALOG[".claude/agents/security-reviewer.md"],
      ".claude/agents/architect.md": CATALOG[".claude/agents/architect.md"],
      ".claude/skills/analyser/SKILL.md":
        CATALOG[".claude/skills/analyser/SKILL.md"],
    });
  });

  it("given a plan with nothing to create, when it is applied, then 200 with no path, and nothing is written to GitHub", async () => {
    const ctx = await ready({
      files: { "README.md": "# app\n", ...CATALOG },
    });
    const plan = await planOf(ctx);
    expect(plan.files.every((f) => f.status !== "create")).toBe(true);

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: [] });
    noWrite(ctx);
  });

  it("given a protected default branch, when the plan is applied, then 200 with the pull request, the default branch is untouched and the commit is on a cockpit/ branch", async () => {
    const ctx = await ready({ refUpdateFailure: PROTECTED });
    const plan = await planOf(ctx);
    const before = ctx.git.head;

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      created: string[];
      pullRequest: { number: number; url: string };
    };
    expect(body.pullRequest).toEqual({
      number: 1,
      url: `https://github.com/${REPO}/pull/1`,
    });
    expect([...body.created].sort()).toEqual(ALL);
    expect(ctx.git.head).toBe(before);
    expect(ctx.git.branch(`cockpit/${body.commitSha.slice(0, 7)}`)).toBe(
      body.commitSha,
    );
    expect(ctx.git.pullRequests).toHaveLength(1);
  });

  it("given a repo that gained one of the files since the plan, when the plan is applied, then 409 repo_changed and nothing is written", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    ctx.git.push({ ".claude/agents/developer.md": "theirs\n" });
    const head = ctx.git.head;

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
    expect(ctx.git.created.refUpdates).toEqual([]);
    expect(ctx.git.head).toBe(head);
  });

  it("given a repo that gained a .claude/CLAUDE.md since a plan holding CLAUDE.md, when the plan is applied, then 409 repo_changed and no CLAUDE.md is written beside it (013 C)", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    expect(statusesOf(plan)["CLAUDE.md"]).toBe("create");
    ctx.git.push({ ".claude/CLAUDE.md": "# theirs\n" });

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
    expect(ctx.git.filesAt(ctx.git.head)?.["CLAUDE.md"]).toBeUndefined();
  });

  it("given an unsigned plan creating CLAUDE.md in a repo that has a .claude/CLAUDE.md, when it is applied, then 409 repo_changed and nothing is written (013 C)", async () => {
    const ctx = await ready({
      files: { "README.md": "# app\n", ".claude/CLAUDE.md": "# theirs\n" },
    });

    const res = await apply(ctx, { plan: unsigned(ctx.git.head) });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    noWrite(ctx);
  });

  it("given a plan altered on its way (an exists file turned into create), when it is applied, then 409 repo_changed and the file is never overwritten", async () => {
    const ctx = await ready({
      files: {
        "README.md": "# app\n",
        ".claude/agents/developer.md": "mine\n",
      },
    });
    const plan = await planOf(ctx);
    const altered = {
      ...plan,
      files: plan.files.map((f) =>
        f.path === ".claude/agents/developer.md"
          ? { path: f.path, content: f.content, status: "create" }
          : f,
      ),
    };

    const res = await apply(ctx, { plan: altered });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.created.commits).toEqual([]);
    expect(ctx.git.filesAt(ctx.git.head)?.[".claude/agents/developer.md"]).toBe(
      "mine\n",
    );
  });

  it("given a protected branch and an App without Pull requests: write, when the plan is applied, then 409 pull_request_forbidden with the address of the settings of the App, and nothing stays on GitHub", async () => {
    const ctx = await ready({
      refUpdateFailure: PROTECTED,
      pullRequestFailure: NO_PULL_REQUEST_RIGHT,
    });
    const plan = await planOf(ctx);
    const before = ctx.git.head;

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "pull_request_forbidden",
      appSettingsUrl: "https://github.com/settings/apps/cockpit-test",
    });
    expect(ctx.git.head).toBe(before);
    expect(ctx.git.pullRequests).toEqual([]);
  });

  it("given a repo that lost the access of the App since the plan, when the plan is applied, then 409 repo_unreachable", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    ctx.git.unreachable = true;

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_unreachable" });
  });

  it("given an empty repo, when a plan is applied, then 409 empty_repo and nothing is written", async () => {
    const ctx = await ready({ empty: true });

    const res = await apply(ctx, { plan: unsigned() });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "empty_repo" });
    noWrite(ctx);
  });

  it("given GitHub that fails while the commit is made, when the plan is applied, then 502 github_unavailable", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    ctx.fetchMock.update({
      failOn: (c) => c.method === "POST" && c.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });

  it("given an instance the wizard has not configured, when a plan is applied, then 503 whoever asks", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request("/api/projects/1/prepare/apply", {
      method: "POST",
    });

    expect(res.status).toBe(503);
  });

  it("given no session, when a plan is applied, then 401 and nothing is written", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);

    const res = await post(
      ctx,
      "",
      `/api/projects/${ctx.projectId}/prepare/apply`,
      { plan },
    );

    expect(res.status).toBe(401);
    noWrite(ctx);
  });

  it.each([
    ["another user's project", (ctx: Ctx) => ctx.projectId, 2000],
    ["a project that does not exist", () => 99999, 1000],
  ])(
    "given %s, when a plan is applied, then 404 and nothing is written",
    async (_name, id, githubId) => {
      const ctx = await ready();
      const plan = await planOf(ctx);
      const asker =
        githubId === 1000
          ? ctx.alice
          : await userWithToken(ctx.app, ctx.db, githubId);

      const res = await apply(ctx, { plan }, id(ctx), asker.cookie);

      expect(res.status).toBe(404);
      noWrite(ctx);
    },
  );

  it("given an archived project, when a plan is applied, then 409 project_archived and nothing is written", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    await archiveProject(ctx.db, ctx.projectId);

    const res = await apply(ctx, { plan });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    noWrite(ctx);
  });

  const valid = unsigned();
  it.each([
    ["no body", undefined],
    ["a body that is not an object", "plan"],
    ["a body that is null", null],
    ["a body that is an array", [valid]],
    ["no plan", {}],
    ["a plan that is a string", { plan: "plan" }],
    ["a plan that is null", { plan: null }],
    ["a plan with no files", { plan: { baseSha: valid.baseSha } }],
    [
      "a baseSha that is not a commit sha (it would be stored in the history)",
      { plan: { baseSha: "Jean Dupont, 12 rue X, ".repeat(500), files: [] } },
    ],
    [
      "a baseSha in upper case",
      { plan: { ...valid, baseSha: "ABCDEF0123".repeat(4) } },
    ],
    ["a plan whose files is not a list", { plan: { ...valid, files: "x" } }],
    ["a plan with no base", { plan: { files: valid.files } }],
    ["a plan whose base is not a string", { plan: { ...valid, baseSha: 12 } }],
    [
      "a file with a status that does not exist",
      {
        plan: { ...valid, files: [{ ...valid.files[0], status: "overwrite" }] },
      },
    ],
    [
      "a file with no status",
      { plan: { ...valid, files: [{ path: "a.md", content: "x" }] } },
    ],
    [
      "a file with no content",
      { plan: { ...valid, files: [{ path: "a.md", status: "create" }] } },
    ],
    [
      "a file whose content is not a string",
      {
        plan: {
          ...valid,
          files: [{ path: "a.md", content: 1, status: "create" }],
        },
      },
    ],
    [
      "a file whose current is not a string",
      {
        plan: {
          ...valid,
          files: [{ path: "a.md", content: "x", status: "exists", current: 3 }],
        },
      },
    ],
    [
      "a file with no path",
      { plan: { ...valid, files: [{ content: "x", status: "create" }] } },
    ],
    [
      "a path that climbs out of the repo",
      {
        plan: {
          ...valid,
          files: [{ path: "../evil", content: "x", status: "create" }],
        },
      },
    ],
    [
      "a path inside .git",
      {
        plan: {
          ...valid,
          files: [{ path: ".git/config", content: "x", status: "create" }],
        },
      },
    ],
    [
      "a path given twice",
      {
        plan: {
          ...valid,
          files: [
            { path: "a.md", content: "x", status: "create" },
            { path: "a.md", content: "y", status: "create" },
          ],
        },
      },
    ],
  ])(
    "given %s, when a plan is applied, then 400 and nothing is written to GitHub",
    async (_name, body) => {
      const ctx = await ready();

      const res = await apply(ctx, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("error");
      noWrite(ctx);
    },
  );
});

describe("decision 026 D: only the catalogue goes through the apply route", () => {
  it.each([
    [
      "a path that is not in the catalogue",
      (plan: Plan) => ({
        ...plan,
        files: [
          ...plan.files,
          { path: "extra.md", content: "x", status: "create" },
        ],
      }),
    ],
    [
      "a create file whose content is not the catalogue's",
      (plan: Plan) => ({
        ...plan,
        files: plan.files.map((f) =>
          f.path === "CLAUDE.md" ? { ...f, content: "changed\n" } : f,
        ),
      }),
    ],
  ])(
    "given a plan with %s, when it is applied, then 400, nothing is written and no entry is recorded",
    async (_name, change) => {
      const ctx = await ready();
      const plan = await planOf(ctx);

      const res = await apply(ctx, { plan: change(plan) });

      expect(res.status).toBe(400);
      noWrite(ctx);
      expect(await prepareRows(ctx)).toEqual([]);
    },
  );
});

describe("POST /api/projects/:id/prepare/apply holds no database connection during the GitHub write (decisions 016 and 020 F)", () => {
  it("given GitHub slow to create the commit, when a plan is applied, then another request is served meanwhile", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    const stub = globalThis.fetch;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = () => {};
    const hit = new Promise<void>((resolve) => {
      reached = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.includes("/git/commits")) return stub(input, init);
        reached();
        await gate;
        return stub(input, init);
      },
    );
    const slow = apply(ctx, { plan });
    await hit;

    // PGlite has one connection: a transaction held by the apply would block this read.
    const other = Promise.resolve(
      ctx.app.request("/api/projects", {
        headers: { cookie: ctx.alice.cookie },
      }),
    );
    let timer: NodeJS.Timeout | undefined;
    const first = await Promise.race([
      other.then(() => "served"),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("blocked"), 2000);
      }),
    ]);
    clearTimeout(timer);
    release();
    await other;

    expect(first).toBe("served");
    expect((await slow).status).toBe(200);
  });
});

describe("decision 027 E: the history of preparing a repo", () => {
  it("given a plan applied, when it is done, then one ok prepare_repo entry of the human, from the UI, on the project, with the number of files created and the commit", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);

    const res = await apply(ctx, { plan });

    const { commitSha } = (await res.json()) as { commitSha: string };
    const found = await prepareRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      token_id: null,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      action: "prepare_repo",
      args: { created: 12 },
      result: "ok",
      detail: null,
      github_effects: { commitSha, pullRequest: null },
    });
  });

  it("given a plan that went through a pull request, when it is done, then the entry holds the number of the pull request", async () => {
    const ctx = await ready({ refUpdateFailure: PROTECTED });
    const plan = await planOf(ctx);

    const res = await apply(ctx, { plan });

    const { commitSha } = (await res.json()) as { commitSha: string };
    const found = await prepareRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      result: "ok",
      args: { created: 12 },
      github_effects: { commitSha, pullRequest: 1 },
    });
  });

  it("given the entry of a preparation, when the history is read, then it holds no path, no content and no address", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    await apply(ctx, { plan });

    const [entry] = await prepareRows(ctx);

    const text = JSON.stringify(entry);
    expect(text).not.toContain(".claude");
    expect(text).not.toContain("github.com");
    expect(text).not.toContain(REPO);
  });

  it("given the plan only read, when /prepare answers, then no prepare_repo entry is written", async () => {
    const ctx = await ready();

    expect((await prepare(ctx)).status).toBe(200);
    expect((await prepare(ctx)).status).toBe(200);

    expect(await prepareRows(ctx)).toEqual([]);
  });

  it.each([
    [
      "repo_changed",
      async (ctx: Ctx) => {
        const plan = await planOf(ctx);
        ctx.git.push({ ".claude/agents/developer.md": "theirs\n" });
        return plan;
      },
      {},
    ],
    [
      "pull_request_forbidden",
      (ctx: Ctx) => planOf(ctx),
      {
        refUpdateFailure: PROTECTED,
        pullRequestFailure: NO_PULL_REQUEST_RIGHT,
      },
    ],
    [
      "repo_unreachable",
      async (ctx: Ctx) => {
        const plan = await planOf(ctx);
        ctx.git.unreachable = true;
        return plan;
      },
      {},
    ],
    [
      "project_archived",
      async (ctx: Ctx) => {
        const plan = await planOf(ctx);
        await archiveProject(ctx.db, ctx.projectId);
        return plan;
      },
      {},
    ],
  ])(
    "given a plan refused with %s, when it is applied, then one refused prepare_repo entry holds the code and no GitHub effect",
    async (code, setUp, repo: FakeGitRepoOptions) => {
      const ctx = await ready(repo);
      const plan = await setUp(ctx);

      const res = await apply(ctx, { plan });

      expect(res.status).toBe(409);
      const found = await prepareRows(ctx);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        action: "prepare_repo",
        result: "refused",
        detail: { reason: code },
        github_effects: null,
      });
    },
  );

  it("given GitHub that fails while the plan is applied, when it is done, then one error prepare_repo entry with the closed reason error, and no text of GitHub", async () => {
    const ctx = await ready();
    const plan = await planOf(ctx);
    ctx.fetchMock.update({
      failOn: (c) => c.method === "POST" && c.path.endsWith("/git/commits"),
    });

    await apply(ctx, { plan });

    const found = await prepareRows(ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      action: "prepare_repo",
      result: "error",
      detail: { reason: "error" },
      project_id: ctx.projectId,
    });
    expect(JSON.stringify(found[0])).not.toContain("github-boom-message");
  });

  it("given a plan that is not well formed, when it is applied, then no GitHub call is made for the repo", async () => {
    const ctx = await ready();

    const res = await apply(ctx, { plan: "x" });

    expect(res.status).toBe(400);
    expect(repoCalls(ctx)).toEqual([]);
  });
});
