import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import {
  history,
  projectMembers,
  projects,
  sessions,
  templateRequests,
  users,
} from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  ALERT_PERMISSIONS,
  BASE_PERMISSIONS,
  INSTALLATION_ID,
  installationUrl,
  stubGitHub,
} from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Slice 12.5, decision 068: a new project from a template repo. The contract these tests assume:
//
// GET /api/templates (session; 401 without)
//   200 { installed, installUrl, owners: string[], templates: [{ githubRepoId, fullName, defaultBranch, lines: HealthLine[] }],
//         permission: { repositoryCreation: boolean, installationUrl, appMissing?: true } }
//   - templates: the repos of the user's installation that GitHub marks `is_template`, `lines` being the health lines of 013 (same shape as /api/projects/:id/health).
//   - owners: [the user's login] (the account of their installation).
//   - permission: as /api/projects/:id/workflows (067 D): `repositoryCreation` is true when the App AND the installation have `repository_creation: write`;
//     `installationUrl` is the installation page, or `<App settings>/permissions` with `appMissing: true` when the App itself lacks it.
//   - a read: no history entry. GitHub failing: 502 { error: "github_unavailable" }.
// GET /api/templates/name?owner=&name= (session)  200 { available: boolean } (read on GitHub as the installation: GET /repos/{owner}/{name}, 404 means free);
//   400 when the name is not a valid repo name or the owner is not the user's.
// POST /api/projects/from-template  { template: "<owner>/<repo>", owner, name, description?, private }
//   200 { authorizeUrl } = https://github.com/login/oauth/authorize?client_id&redirect_uri=<publicUrl>/api/auth/callback&state,
//   plus a Set-Cookie (HttpOnly) carrying that state (whatever its name); the request is kept server side, single use, ten minutes at most. Nothing is created yet.
//   400 { error: "Bad request" } (template missing, owner not the user's, name not [A-Za-z0-9._-]{1,100} or "."/"..", description over 350 characters, private not a boolean),
//   401 without session, 409 { error: "name_taken" }, 409 { error: "not_a_template" } (not a template, or not reached by the installation).
// GET /api/auth/callback?code=&state= (the login's callback, taken over when the creation's state cookie matches the state; session needed), always a 302:
//   success: the code is exchanged at https://github.com/login/oauth/access_token (client_id, client_secret, code, redirect_uri), then
//   POST https://api.github.com/repos/{template}/generate { owner, name, description, private, include_all_branches: false } with `Bearer <user token>`,
//   the token is forgotten, the repo is imported as in 011 (owner member, installation of the user), history `create_from_template` ok { template, fullName } -> /projets/<project id>.
//   failures go to /projets/nouveau?erreur=<code>:
//     demande-expiree     state missing or different, request unknown, expired (> 10 minutes) or already used (nothing is exchanged)
//     annulee             GitHub answered error=access_denied
//     github-injoignable  the code exchange failed
//     creee-non-importee  the repo was generated but reading the installation or the import then failed
//     refusee&raison=<GitHub's message>  GitHub refused POST .../generate (nothing imported)
//     hors-installation   the repo is created but the installation does not reach it (not imported)

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const CALLBACK = "https://cockpit.example.com/api/auth/callback";
const USER_TOKEN = "gho_user_token";
const SETTINGS_PERMISSIONS =
  "https://github.com/settings/apps/cockpit-test/permissions";
const TEMPLATE = "user1000/modele-web";
const NEW_REPO_ID = 500;

const GREEN: Record<string, string> = {
  "CLAUDE.md": "# Modèle\n",
  ".github/workflows/ci.yml": "on: push\n",
  ".claude/agents/test-writer.md": "x",
  ".claude/agents/developer.md": "x",
  ".claude/agents/reviewer.md": "x",
  ".claude/skills/dev-us/SKILL.md": "x",
};

const repo = (id: number, fullName: string, is_template = true) => ({
  id,
  full_name: fullName,
  default_branch: "main",
  private: true,
  is_template,
});

type Options = {
  /** `owner/name` that exist on GitHub already. */
  taken?: string[];
  /** The new repo is outside the installation. */
  outside?: boolean;
  /** GitHub refuses the generation with this status and message. */
  generateFailure?: { status: number; message: string };
  tokenStatus?: number;
  /** The installation cannot be listed once the repo is generated. */
  listFailsAfterGenerate?: boolean;
  repositoriesStatus?: number;
  appPermissions?: Record<string, string>;
  installationPermissions?: Record<string, string>;
};

/** The fake GitHub of the tests plus what only this slice needs: the OAuth code exchange, the name lookup and `generate`. */
function stubTemplates(options: Options = {}) {
  const repositories = [
    repo(1, TEMPLATE),
    repo(2, "user1000/modele-api"),
    repo(3, "user1000/plain", false),
  ];
  const base = stubGitHub({
    account: 1000,
    repositories,
    repositoriesStatus: options.repositoriesStatus,
    repoFiles: {
      [TEMPLATE]: GREEN,
      "user1000/modele-api": { "README.md": "rien\n" },
    },
    appInfo: { permissions: options.appPermissions },
    installationInfo: { permissions: options.installationPermissions },
  });
  const calls: {
    method: string;
    url: string;
    authorization: string;
    body: Record<string, unknown>;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const url = new URL(raw);
      const text =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const call = {
        method,
        url: url.origin + url.pathname,
        authorization: headers.get("authorization") ?? "",
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      };
      if (
        options.listFailsAfterGenerate &&
        url.pathname === "/installation/repositories" &&
        calls.some((c) => c.url.endsWith("/generate"))
      )
        return Response.json({}, { status: 500 });
      if (call.url === TOKEN_URL) {
        calls.push(call);
        return options.tokenStatus
          ? Response.json({}, { status: options.tokenStatus })
          : Response.json({ access_token: USER_TOKEN });
      }
      const generate = /^\/repos\/([^/]+\/[^/]+)\/generate$/.exec(url.pathname);
      if (method === "POST" && generate) {
        calls.push(call);
        if (options.generateFailure)
          return Response.json(
            { message: options.generateFailure.message },
            { status: options.generateFailure.status },
          );
        const fullName = `${call.body.owner}/${call.body.name}`;
        if (!options.outside)
          repositories.push(repo(NEW_REPO_ID, fullName, false));
        return Response.json(
          { id: NEW_REPO_ID, full_name: fullName, default_branch: "main" },
          { status: 201 },
        );
      }
      // The name lookup: `GET /repos/{owner}/{name}`, nothing after.
      const lookup = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname);
      if (method === "GET" && lookup) {
        calls.push(call);
        return (options.taken ?? []).includes(lookup[1] as string)
          ? Response.json({ id: 9 })
          : Response.json({ message: "Not Found" }, { status: 404 });
      }
      return base(input, init);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  // A session that outlives the ten minutes of a request.
  const [user] = await db
    .insert(users)
    .values({ githubId: 1000, login: "user1000" })
    .returning({ id: users.id });
  assert(user);
  await db.insert(sessions).values({
    id: createHash("sha256").update("cookie-of-1000").digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { db, app, userId: user.id, cookie: "cockpit_session=cookie-of-1000" };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const get = (ctx: Ctx, path: string, cookie = ctx.cookie) =>
  ctx.app.request(path, { headers: { cookie } });

const body = {
  template: TEMPLATE,
  owner: "user1000",
  name: "planning-chantiers",
  description: "Planning des équipes",
  private: true,
};

const create = (ctx: Ctx, sent: unknown = body) =>
  ctx.app.request("/api/projects/from-template", {
    method: "POST",
    headers: { cookie: ctx.cookie, "content-type": "application/json" },
    body: JSON.stringify(sent),
  });

/** The cookies a browser keeps from a response: every one that was set and not cleared. */
const keptCookies = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((pair) => !pair.endsWith("="))
    .join("; ");

/** Asks to create, then returns what the browser brings back from GitHub. */
async function begin(ctx: Ctx, sent: unknown = body) {
  const res = await create(ctx, sent);
  expect(res.status).toBe(200);
  const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
  const state = new URL(authorizeUrl).searchParams.get("state");
  assert(state, "the authorize URL must carry a state");
  return { state, cookies: `${ctx.cookie}; ${keptCookies(res)}` };
}

const callback = (ctx: Ctx, query: string, cookies: string) =>
  ctx.app.request(`/api/auth/callback?${query}`, {
    headers: { cookie: cookies },
  });

/** Create then come back from GitHub with a code. */
async function createAndReturn(ctx: Ctx) {
  const { state, cookies } = await begin(ctx);
  return callback(ctx, `code=gh-code&state=${state}`, cookies);
}

const failed = (code: string) => `/projets/nouveau?erreur=${code}`;

describe("GET /api/templates (decision 068 B)", () => {
  it("given three repos of which two are templates, when the templates are read, then only those two come, each with the health lines of 013, the owner and no history entry", async () => {
    stubTemplates();
    const ctx = await setup();

    const res = await get(ctx, "/api/templates");

    expect(res.status).toBe(200);
    const read = (await res.json()) as {
      owners: string[];
      templates: {
        fullName: string;
        githubRepoId: number;
        lines: { key: string; ok: boolean }[];
      }[];
    };
    expect(read.owners).toEqual(["user1000"]);
    expect(read.templates.map((t) => t.fullName)).toEqual([
      TEMPLATE,
      "user1000/modele-api",
    ]);
    const fileLines = (t: (typeof read.templates)[number]) =>
      t.lines
        .filter((l) => ["claude_md", "ci", "mcp", "agents"].includes(l.key))
        .map((l) => [l.key, l.ok]);
    expect(fileLines(read.templates[0] as never)).toEqual([
      ["claude_md", true],
      ["ci", true],
      ["mcp", true],
      ["agents", true],
    ]);
    expect(fileLines(read.templates[1] as never)).toEqual([
      ["claude_md", false],
      ["ci", false],
      ["mcp", true],
      ["agents", false],
    ]);
    expect(await ctx.db.select().from(history)).toEqual([]);
  });

  it("given no repo marked as a template, when the templates are read, then the list is empty", async () => {
    stubGitHub({
      account: 1000,
      repositories: [repo(3, "user1000/plain", false)],
    });
    const ctx = await setup();

    const res = await get(ctx, "/api/templates");

    expect(res.status).toBe(200);
    expect(((await res.json()) as { templates: unknown }).templates).toEqual(
      [],
    );
  });

  it("given GitHub answering 500, when the templates are read, then the answer is 502 github_unavailable", async () => {
    stubTemplates({ repositoriesStatus: 500 });
    const ctx = await setup();

    const res = await get(ctx, "/api/templates");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });

  it("given no session, when the templates are read, then the answer is 401", async () => {
    stubTemplates();
    const ctx = await setup();

    expect((await ctx.app.request("/api/templates")).status).toBe(401);
  });

  it.each([
    [
      "the installation has it",
      undefined,
      undefined,
      { repositoryCreation: true, installationUrl: installationUrl() },
    ],
    [
      "the installation has not approved it yet",
      undefined,
      {
        ...BASE_PERMISSIONS,
        ...ALERT_PERMISSIONS,
        repository_creation: "read",
      },
      { repositoryCreation: false, installationUrl: installationUrl() },
    ],
    [
      "the App itself lacks it",
      {
        ...BASE_PERMISSIONS,
        ...ALERT_PERMISSIONS,
        repository_creation: "read",
      },
      undefined,
      {
        repositoryCreation: false,
        installationUrl: SETTINGS_PERMISSIONS,
        appMissing: true,
      },
    ],
  ])(
    "given %s, when the templates are read, then permission says so (decision 068 F)",
    async (_name, appPermissions, installationPermissions, expected) => {
      stubTemplates({ appPermissions, installationPermissions });
      const ctx = await setup();

      const res = await get(ctx, "/api/templates");

      expect(
        ((await res.json()) as { permission: unknown }).permission,
      ).toEqual(expected);
    },
  );
});

describe("GET /api/templates/name (decision 068 C)", () => {
  it.each([
    ["is free", true, []],
    ["exists on GitHub", false, ["user1000/planning-chantiers"]],
  ])(
    "given a name that %s, when its availability is read, then available is %s",
    async (_name, available, taken) => {
      stubTemplates({ taken });
      const ctx = await setup();

      const res = await get(
        ctx,
        "/api/templates/name?owner=user1000&name=planning-chantiers",
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ available });
    },
  );

  it.each([
    ["a name GitHub does not accept", "owner=user1000&name=pas%20valide"],
    ["an owner that is not the user's", "owner=someone-else&name=ok"],
  ])(
    "given %s, when its availability is read, then the answer is 400",
    async (_n, query) => {
      stubTemplates();
      const ctx = await setup();

      expect((await get(ctx, `/api/templates/name?${query}`)).status).toBe(400);
    },
  );
});

describe("POST /api/projects/from-template (decision 068 D, G)", () => {
  it("given a valid request, when it is made, then the answer is GitHub's authorize URL of the App with a state kept in an HttpOnly cookie, and nothing is created yet", async () => {
    const calls = stubTemplates();
    const ctx = await setup();

    const res = await create(ctx);

    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe("Iv1.client");
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.includes(`=${state}`));
    assert(cookie, "a cookie must carry the state");
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(await ctx.db.select().from(projects)).toEqual([]);
  });

  it("given no session, when it is made, then the answer is 401", async () => {
    stubTemplates();
    const ctx = await setup();

    const res = await ctx.app.request("/api/projects/from-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(401);
  });

  it.each([
    ["no template", { ...body, template: undefined }],
    ["an owner that is not the user's", { ...body, owner: "someone-else" }],
    ["an empty name", { ...body, name: "" }],
    ["a name with a space", { ...body, name: "pas valide" }],
    ["a name with a slash", { ...body, name: "a/b" }],
    ["a name of 101 characters", { ...body, name: "x".repeat(101) }],
    ["the name ..", { ...body, name: ".." }],
    [
      "a description of 351 characters",
      { ...body, description: "d".repeat(351) },
    ],
    ["private as a string", { ...body, private: "yes" }],
  ])(
    "given %s, when it is made, then the answer is 400 and nothing is kept",
    async (_name, sent) => {
      stubTemplates();
      const ctx = await setup();

      const res = await create(ctx, sent);

      expect(res.status).toBe(400);
      expect(res.headers.getSetCookie()).toEqual([]);
    },
  );

  it("given a name of 100 characters and no description, when it is made, then it is accepted", async () => {
    stubTemplates();
    const ctx = await setup();

    const res = await create(ctx, {
      ...body,
      name: "x".repeat(100),
      description: undefined,
    });

    expect(res.status).toBe(200);
  });

  it("given a name that exists on GitHub, when it is made, then the answer is 409 name_taken", async () => {
    stubTemplates({ taken: ["user1000/planning-chantiers"] });
    const ctx = await setup();

    const res = await create(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "name_taken" });
  });

  it.each([
    ["a repo that is not a template", "user1000/plain"],
    ["a repo the installation does not reach", "stranger/modele"],
  ])(
    "given %s, when it is made, then the answer is 409 not_a_template",
    async (_name, template) => {
      stubTemplates();
      const ctx = await setup();

      const res = await create(ctx, { ...body, template });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_a_template" });
    },
  );
});

describe("the return from GitHub (decision 068 D)", () => {
  it("given a request kept and a code, when GitHub sends the user back, then the repo is generated from the template with the user's token, imported, and the user lands on the project", async () => {
    const calls = stubTemplates();
    const ctx = await setup();

    const res = await createAndReturn(ctx);

    const exchange = calls.find((c) => c.url === TOKEN_URL);
    expect(exchange?.body).toMatchObject({
      client_id: "Iv1.client",
      client_secret: "secret",
      code: "gh-code",
      redirect_uri: CALLBACK,
    });
    const generated = calls.filter((c) => c.url.endsWith("/generate"));
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({
      url: `https://api.github.com/repos/${TEMPLATE}/generate`,
      body: {
        owner: "user1000",
        name: "planning-chantiers",
        description: "Planning des équipes",
        private: true,
        include_all_branches: false,
      },
    });
    expect(generated[0]?.authorization).toContain(USER_TOKEN);
    const [project] = await ctx.db.select().from(projects);
    assert(project, "the new repo must be imported");
    expect(project).toMatchObject({
      githubRepoId: NEW_REPO_ID,
      fullName: "user1000/planning-chantiers",
      installationId: INSTALLATION_ID,
    });
    expect(await ctx.db.select().from(projectMembers)).toMatchObject([
      { projectId: project.id, userId: ctx.userId, role: "owner" },
    ]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/projets/${project.id}`);
    const entries = (await ctx.db.select().from(history)).filter(
      (h) => h.action === "create_from_template",
    );
    expect(entries).toMatchObject([
      {
        result: "ok",
        userId: ctx.userId,
        args: { template: TEMPLATE, fullName: "user1000/planning-chantiers" },
      },
    ]);
  });

  it("given a repo generated, when the return is over, then the user token is nowhere in the database", async () => {
    stubTemplates();
    const ctx = await setup();

    await createAndReturn(ctx);

    const tables = (await ctx.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )) as unknown as { rows: { table_name: string }[] };
    for (const { table_name } of tables.rows) {
      const rows = (await ctx.db.execute(
        sql.raw(`select t::text as row from "${table_name}" t`),
      )) as unknown as { rows: unknown[] };
      expect(JSON.stringify(rows.rows), table_name).not.toContain(USER_TOKEN);
    }
  });

  it("given a repo created outside the installation, when the user comes back, then it is not imported and the page is told (decision 068 E)", async () => {
    stubTemplates({ outside: true });
    const ctx = await setup();

    const res = await createAndReturn(ctx);

    expect(res.headers.get("location")).toBe(failed("hors-installation"));
    expect(await ctx.db.select().from(projects)).toEqual([]);
  });

  it("given GitHub refusing the creation, when the user comes back, then nothing is imported and the reason is passed to the page (decision 068 F)", async () => {
    stubTemplates({
      generateFailure: { status: 403, message: "Resource not accessible" },
    });
    const ctx = await setup();

    const res = await createAndReturn(ctx);

    expect(res.headers.get("location")).toBe(
      `${failed("refusee")}&raison=${encodeURIComponent("Resource not accessible")}`,
    );
    expect(await ctx.db.select().from(projects)).toEqual([]);
  });

  it("given the repo generated and the installation unreadable after, when the user comes back, then the page is told the repo may exist already", async () => {
    stubTemplates({ listFailsAfterGenerate: true });
    const ctx = await setup();

    const res = await createAndReturn(ctx);

    expect(res.headers.get("location")).toBe(failed("creee-non-importee"));
    expect(await ctx.db.select().from(projects)).toEqual([]);
  });

  it.each([
    ["the state differs from the cookie", "wrong-state", true],
    ["there is no state cookie", undefined, false],
  ])(
    // Not a creation's return any more: the login's callback runs, and fails for lack of its own state.
    "given %s, when GitHub sends the user back, then it is no creation return and nothing is exchanged",
    async (_name, state, withCookie) => {
      const calls = stubTemplates();
      const ctx = await setup();
      const begun = await begin(ctx);

      const res = await callback(
        ctx,
        `code=gh-code&state=${state ?? begun.state}`,
        withCookie ? begun.cookies : ctx.cookie,
      );

      expect(res.headers.get("location")).toBe("/?erreur=connexion-echouee");
      expect(calls.some((c) => c.method === "POST")).toBe(false);
      expect(await ctx.db.select().from(projects)).toEqual([]);
    },
  );

  it("given the state cookie of another user, when their session comes back with it, then the request has expired, nothing is generated and the first user's request survives", async () => {
    const calls = stubTemplates();
    const ctx = await setup();
    const { state, cookies } = await begin(ctx);
    const [other] = await ctx.db
      .insert(users)
      .values({ githubId: 2000, login: "user2000" })
      .returning({ id: users.id });
    assert(other);
    await ctx.db.insert(sessions).values({
      id: createHash("sha256").update("cookie-of-2000").digest("hex"),
      userId: other.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const res = await callback(
      ctx,
      `code=gh-code&state=${state}`,
      cookies.replace(ctx.cookie, "cockpit_session=cookie-of-2000"),
    );

    expect(res.headers.get("location")).toBe(failed("demande-expiree"));
    expect(calls.some((c) => c.url.endsWith("/generate"))).toBe(false);
    expect(await ctx.db.select().from(templateRequests)).toHaveLength(1);
  });

  it("given a request kept for more than ten minutes, when the user comes back, then it has expired and nothing is exchanged", async () => {
    const calls = stubTemplates();
    const ctx = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { state, cookies } = await begin(ctx);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);

    const res = await callback(ctx, `code=gh-code&state=${state}`, cookies);

    expect(res.headers.get("location")).toBe(failed("demande-expiree"));
    expect(calls.some((c) => c.url === TOKEN_URL)).toBe(false);
    expect(await ctx.db.select().from(projects)).toEqual([]);
  });

  it("given a request already used, when the same return comes again, then it is refused and the repo is generated once", async () => {
    const calls = stubTemplates();
    const ctx = await setup();
    const { state, cookies } = await begin(ctx);
    const query = `code=gh-code&state=${state}`;
    await callback(ctx, query, cookies);

    const again = await callback(ctx, query, cookies);

    expect(again.headers.get("location")).toBe(failed("demande-expiree"));
    expect(calls.filter((c) => c.url.endsWith("/generate"))).toHaveLength(1);
    expect(await ctx.db.select().from(projects)).toHaveLength(1);
  });

  it("given the user refusing the authorization on GitHub, when they come back, then the creation is cancelled and nothing is exchanged", async () => {
    const calls = stubTemplates();
    const ctx = await setup();
    const { state, cookies } = await begin(ctx);

    const res = await callback(
      ctx,
      `error=access_denied&state=${state}`,
      cookies,
    );

    expect(res.headers.get("location")).toBe(failed("annulee"));
    expect(calls.some((c) => c.url === TOKEN_URL)).toBe(false);
    expect(await ctx.db.select().from(projects)).toEqual([]);
  });

  it("given GitHub failing the code exchange, when the user comes back, then the page is told GitHub is unreachable and nothing is generated", async () => {
    const calls = stubTemplates({ tokenStatus: 500 });
    const ctx = await setup();

    const res = await createAndReturn(ctx);

    expect(res.headers.get("location")).toBe(failed("github-injoignable"));
    expect(calls.some((c) => c.url.endsWith("/generate"))).toBe(false);
  });
});
