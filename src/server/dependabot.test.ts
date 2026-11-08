import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiModule, cite, FILES, submit, webModule } from "./test-code-map.ts";
import { send } from "./test-decisions.ts";
import { ready } from "./test-findings.ts";
import { githubCalls } from "./test-github.ts";
import { archiveProject, type Row, rows, userWithToken } from "./test-mcp.ts";

// Slice R6 (decision 052 L): the fix of the line « Mises à jour automatiques », `.github/dependabot.yml`, shown then written like « Préparer pour Claude » (decision 026 and src/server/prepare.test.ts).
//
// Pinned where the decision leaves it open (the developer follows these; the web tests of src/web/ProjectPageAlerts.test.tsx use the same):
// - GET /api/projects/:id/dependabot/plan (no body, a read: no history entry) answers 200 { plan } with the plan of 026 as is: { baseSha, signature, files: [{ path, content, status, current? }] }, one
//   file, `.github/dependabot.yml`, status `create`; `exists` with the current text when the repo already has a `.github/dependabot.yml`, and the same when it has a `.github/dependabot.yaml`
//   (the path stays `.github/dependabot.yml`; an `exists` file is never written).
// - POST /api/projects/:id/dependabot/apply takes { plan } and answers 200 { commitSha, created, pullRequest?: { number, url } } (026 F: a commit on the default branch, or a pull request
//   when it is protected), the commit message being "feat: add .github/dependabot.yml (Cockpit)". The history keeps ONE entry per apply: action `add_dependabot`, actor human, origin ui,
//   project_id, args { created: <number> }, github_effects { commitSha, pullRequest: <number | null> }; a refusal is a `refused` entry (detail { reason }), a failure of GitHub an `error` entry.
// - Refusals as the prepare routes: 401, 404 { error: "Not found" } for a non-member, 409 { error: "project_archived" }, 409 { error: "no_ecosystem" } for the plan route when the repo
//   has no manifest at the root, none in the map and no workflow; both routes refuse an archived project with 409 project_archived, as the prepare routes do.
// - The content, in YAML, begins with `version: 2` and holds one entry per ecosystem found, each `- package-ecosystem: "<name>"`, `directory: "<dir>"`, `schedule:` with `interval: "weekly"`,
//   in that key order (quotes optional). The ecosystems come from the manifests at the root of the repo (`package.json` npm, `composer.json` composer, `requirements.txt`, `pyproject.toml` or
//   `Pipfile` pip, `Gemfile` bundler, `go.mod` gomod, `Cargo.toml` cargo, `pom.xml` maven, `build.gradle` or `build.gradle.kts` gradle) and from the manifests the map names (`modules[].manifest`
//   of the stored map, by its file name, in the same table); `directory` is the folder of the manifest (`/` at the root, `/api` for `api/package.json`); an ecosystem is listed once per
//   directory. `github-actions` with directory `/` is added when `.github/workflows` holds a workflow (a .yml or .yaml file).

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
type Ctx = Awaited<ReturnType<typeof ready>>;
type Plan = {
  baseSha: string;
  signature: string;
  files: { path: string; content: string; status: string; current?: string }[];
};
const PROTECTED = {
  status: 403,
  message: "Protected branch update failed for refs/heads/main",
};

const plan = (
  ctx: Ctx,
  id: number | string = ctx.projectId,
  cookie = ctx.alice.cookie,
) => send(ctx.app, cookie, "GET", `/api/projects/${id}/dependabot/plan`);
const apply = (ctx: Ctx, body: unknown, id: number | string = ctx.projectId) =>
  send(
    ctx.app,
    ctx.alice.cookie,
    "POST",
    `/api/projects/${id}/dependabot/apply`,
    body,
  );
async function planOf(ctx: Ctx) {
  const res = await plan(ctx);
  expect(res.status, "the plan must be served for this test").toBe(200);
  return ((await res.json()) as { plan: Plan }).plan;
}
/** The (ecosystem, directory) entries of the YAML, in order; the weekly interval is part of the pattern. */
const entriesOf = (yaml: string) =>
  [
    ...yaml.matchAll(
      /-\s*package-ecosystem:\s*["']?([\w-]+)["']?\s*\n\s*directory:\s*["']?([^"'\n]+?)["']?\s*\n\s*schedule:\s*\n\s*interval:\s*["']?weekly["']?/g,
    ),
  ].map((m) => `${m[1]} ${m[2]}`);
const dependabotOf = (p: Plan) =>
  p.files.find((f) => f.path === ".github/dependabot.yml");
const count = (yaml: string) =>
  (yaml.match(/package-ecosystem:/g) ?? []).length;

describe("decision 052 L: the plan of .github/dependabot.yml", () => {
  it("given a repo with a package.json and a composer.json at the root and workflows, when the plan is read, then it holds the file with npm, composer and github-actions, each weekly with its folder", async () => {
    const ctx = await ready({
      "package.json": "{}\n",
      "composer.json": "{}\n",
      ".github/workflows/ci.yml": "name: ci\n",
    });

    const p = await planOf(ctx);

    expect(p.files).toHaveLength(1);
    const file = dependabotOf(p);
    expect(file).toMatchObject({
      path: ".github/dependabot.yml",
      status: "create",
    });
    expect(file?.content).toMatch(/^version:\s*2\s*$/m);
    expect(entriesOf(file?.content ?? "").sort()).toEqual([
      "composer /",
      "github-actions /",
      "npm /",
    ]);
    expect(count(file?.content ?? "")).toBe(3);
    expect(p.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(p.signature.length).toBeGreaterThan(0);
  });

  it.each([
    ["requirements.txt", "pip"],
    ["pyproject.toml", "pip"],
    ["Pipfile", "pip"],
    ["Gemfile", "bundler"],
    ["go.mod", "gomod"],
    ["Cargo.toml", "cargo"],
    ["pom.xml", "maven"],
    ["build.gradle", "gradle"],
    ["build.gradle.kts", "gradle"],
    ["package.json", "npm"],
    ["composer.json", "composer"],
  ])(
    "given a repo with %s at the root, when the plan is read, then the ecosystem is %s, in the folder /",
    async (manifest, ecosystem) => {
      const ctx = await ready({ [manifest]: "x\n" });

      const file = dependabotOf(await planOf(ctx));

      expect(entriesOf(file?.content ?? "")).toEqual([`${ecosystem} /`]);
    },
  );

  it("given requirements.txt and pyproject.toml at the root, when the plan is read, then pip is listed once for the folder", async () => {
    const ctx = await ready({
      "requirements.txt": "x\n",
      "pyproject.toml": "x\n",
    });

    const file = dependabotOf(await planOf(ctx));

    expect(entriesOf(file?.content ?? "")).toEqual(["pip /"]);
  });

  it("given a map whose manifests are api/package.json and web/package.json and a package.json at the root, when the plan is read, then npm is listed for /, /api and /web", async () => {
    const ctx = await ready({ ...FILES, "package.json": "{}\n" });
    expect((await submit(ctx, [apiModule(), webModule()])).isError).not.toBe(
      true,
    );

    const file = dependabotOf(await planOf(ctx));

    expect(entriesOf(file?.content ?? "").sort()).toEqual([
      "npm /",
      "npm /api",
      "npm /web",
    ]);
  });

  it("given a map whose manifest is a composer.json in a folder, when the plan is read, then composer is listed for that folder only", async () => {
    const ctx = await ready({
      "back/composer.json": "{}\n",
      "back/src/db.ts": "x\n".repeat(30),
    });
    const back = apiModule({
      path: "back",
      manifest: "back/composer.json",
      runtimes: [
        {
          name: "php",
          version: "8.2",
          citation: cite("back/composer.json", 1),
        },
      ],
      objects: [
        {
          name: "User",
          kind: "table",
          fields: [],
          citation: cite("back/src/db.ts", 1, 2),
        },
      ],
      links: [],
    });
    expect((await submit(ctx, [back])).isError).not.toBe(true);

    const file = dependabotOf(await planOf(ctx));

    expect(entriesOf(file?.content ?? "")).toEqual(["composer /back"]);
  });

  it.each([
    ["a .yml workflow", { ".github/workflows/ci.yml": "x" }, true],
    ["a .yaml workflow", { ".github/workflows/ci.yaml": "x" }, true],
    [
      "only a README in the workflows folder",
      { "package.json": "{}\n", ".github/workflows/README.md": "x" },
      false,
    ],
  ])(
    "given a repo with %s, when the plan is read, then github-actions is listed: %s",
    async (_name, files, listed) => {
      const ctx = await ready({ "package.json": "{}\n", ...files });

      const file = dependabotOf(await planOf(ctx));

      expect(entriesOf(file?.content ?? "").includes("github-actions /")).toBe(
        listed,
      );
    },
  );

  it("given a repo with only workflows, when the plan is read, then the file holds github-actions alone", async () => {
    const ctx = await ready({ ".github/workflows/ci.yml": "x" });

    expect(entriesOf(dependabotOf(await planOf(ctx))?.content ?? "")).toEqual([
      "github-actions /",
    ]);
  });

  it("given a repo with no manifest at the root, none in the map and no workflow, when the plan is read, then 409 no_ecosystem and nothing is written", async () => {
    const ctx = await ready();

    const res = await plan(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_ecosystem" });
    expect(
      githubCalls(ctx.fetchMock).filter((c) => c.method !== "GET"),
    ).toEqual([]);
  });

  it("given a repo that already has a .github/dependabot.yml, when the plan is read, then the file is exists with the current text", async () => {
    const ctx = await ready({
      "package.json": "{}\n",
      ".github/dependabot.yml": "version: 2\nupdates: []\n",
    });

    const file = dependabotOf(await planOf(ctx));

    expect(file).toMatchObject({
      status: "exists",
      current: "version: 2\nupdates: []\n",
    });
  });

  it("given the plan only read, when the history is looked at, then no add_dependabot entry exists (a read is not an action)", async () => {
    const ctx = await ready({ "package.json": "{}\n" });
    await planOf(ctx);

    expect(await rows(ctx.db, sql`action = 'add_dependabot'`)).toEqual([]);
  });

  it("given a non-member, no session, an unknown or an archived project, when the plan is read, then 404, 401, 404 and 409 project_archived", async () => {
    const ctx = await ready({ "package.json": "{}\n" });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    expect((await plan(ctx, ctx.projectId, bob.cookie)).status).toBe(404);
    expect((await plan(ctx, ctx.projectId, "")).status).toBe(401);
    expect((await plan(ctx, 99_999)).status).toBe(404);
    await archiveProject(ctx.db, ctx.projectId);
    const archived = await plan(ctx);
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({ error: "project_archived" });
  });
});

describe("decision 052 L: writing .github/dependabot.yml", () => {
  const ready1 = () =>
    ready({ "package.json": "{}\n", ".github/workflows/ci.yml": "x" });

  it("given the plan applied unchanged, when it is applied, then one commit on the default branch adds exactly .github/dependabot.yml with the content of the plan", async () => {
    const ctx = await ready1();
    const p = await planOf(ctx);

    const res = await apply(ctx, { plan: p });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      created: string[];
      pullRequest?: unknown;
    };
    expect(body.created).toEqual([".github/dependabot.yml"]);
    expect(body).not.toHaveProperty("pullRequest");
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]?.message).toBe(
      "feat: add .github/dependabot.yml (Cockpit)",
    );
    expect(ctx.git.head).toBe(body.commitSha);
    expect(ctx.git.filesAt(body.commitSha)?.[".github/dependabot.yml"]).toBe(
      dependabotOf(p)?.content,
    );
  });

  it("given a protected default branch, when the plan is applied, then 200 with a pull request, the default branch is untouched and the commit is on a cockpit/ branch", async () => {
    const ctx = await ready(
      { "package.json": "{}\n" },
      { refUpdateFailure: PROTECTED },
    );
    const p = await planOf(ctx);
    const before = ctx.git.head;

    const res = await apply(ctx, { plan: p });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commitSha: string;
      created: string[];
      pullRequest: { number: number; url: string };
    };
    expect(body.created).toEqual([".github/dependabot.yml"]);
    expect(body.pullRequest).toEqual({
      number: 1,
      url: `https://github.com/${REPO}/pull/1`,
    });
    expect(ctx.git.head).toBe(before);
    expect(ctx.git.branch(`cockpit/${body.commitSha.slice(0, 7)}`)).toBe(
      body.commitSha,
    );
  });

  it("given a plan applied, when the history is read, then one ok add_dependabot entry of the human, from the UI, holds the project, the count and the commit, and no path or content", async () => {
    const ctx = await ready1();
    const p = await planOf(ctx);

    const res = await apply(ctx, { plan: p });

    const { commitSha } = (await res.json()) as { commitSha: string };
    const found = (await rows(
      ctx.db,
      sql`action = 'add_dependabot'`,
    )) as (Row & {
      github_effects: unknown;
    })[];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { created: 1 },
      github_effects: { commitSha, pullRequest: null },
    });
    expect(JSON.stringify(found[0])).not.toContain("package-ecosystem");
    expect(JSON.stringify(found[0])).not.toContain(".github/dependabot.yml");
  });

  it("given a repo that gained a .github/dependabot.yml since the plan, when the plan is applied, then 409 repo_changed, nothing is written and one refused entry is left", async () => {
    const ctx = await ready1();
    const p = await planOf(ctx);
    ctx.git.push({ ".github/dependabot.yml": "version: 2\nupdates: []\n" });
    const head = ctx.git.head;

    const res = await apply(ctx, { plan: p });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_changed" });
    expect(ctx.git.head).toBe(head);
    expect(ctx.git.created.commits).toEqual([]);
    const refused = (await rows(
      ctx.db,
      sql`action = 'add_dependabot'`,
    )) as Row[];
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      result: "refused",
      detail: { reason: "repo_changed" },
    });
  });

  it("given a plan whose file exists, when it is applied, then 200 with nothing created and nothing is written", async () => {
    const ctx = await ready({
      "package.json": "{}\n",
      ".github/dependabot.yaml": "version: 2\nupdates: []\n",
    });
    const p = await planOf(ctx);
    expect(dependabotOf(p)?.status).toBe("exists");

    const res = await apply(ctx, { plan: p });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: [] });
    expect(ctx.git.created.commits).toEqual([]);
  });

  it("given a plan altered by the client (another path or another content), when it is applied, then it is refused and nothing is written", async () => {
    const ctx = await ready1();
    const p = await planOf(ctx);
    const forged = {
      ...p,
      files: p.files.map((f) => ({ ...f, content: "version: 2\n# mine\n" })),
    };

    const res = await apply(ctx, { plan: forged });

    expect([400, 409]).toContain(res.status);
    expect(ctx.git.created.commits).toEqual([]);
    expect(ctx.git.head).toBe(p.baseSha);
  });

  it("given a body that is not a plan, when it is applied, then 400 and nothing is written", async () => {
    const ctx = await ready1();

    const res = await apply(ctx, { plan: { baseSha: 5 } });

    expect(res.status).toBe(400);
    expect(ctx.git.created.commits).toEqual([]);
  });

  it("given a non-member, no session or an archived project, when the plan is applied, then 404, 401 and 409 project_archived, and nothing is written", async () => {
    const ctx = await ready1();
    const p = await planOf(ctx);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const stranger = await send(
      ctx.app,
      bob.cookie,
      "POST",
      `/api/projects/${ctx.projectId}/dependabot/apply`,
      { plan: p },
    );
    const anonymous = await send(
      ctx.app,
      "",
      "POST",
      `/api/projects/${ctx.projectId}/dependabot/apply`,
      { plan: p },
    );
    await archiveProject(ctx.db, ctx.projectId);
    const archived = await apply(ctx, { plan: p });

    expect(stranger.status).toBe(404);
    expect(anonymous.status).toBe(401);
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({ error: "project_archived" });
    expect(ctx.git.created.commits).toEqual([]);
  });

  it("given GitHub that fails during the write, when the plan is applied, then 502 github_unavailable and one error entry with the closed reason", async () => {
    const ctx = await ready1();
    const p = await planOf(ctx);
    ctx.fetchMock.update({
      failOn: (call) =>
        call.method === "POST" && call.path.endsWith("/git/commits"),
    });

    const res = await apply(ctx, { plan: p });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
    const [entry] = (await rows(
      ctx.db,
      sql`action = 'add_dependabot'`,
    )) as Row[];
    expect(entry).toMatchObject({
      result: "error",
      detail: { reason: "error" },
    });
  });
});
