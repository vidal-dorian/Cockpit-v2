import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import {
  history,
  projectMembers,
  projects,
  sessions,
  users,
} from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { githubCalls, INSTALLATION_ID, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

const INSTALL_URL = "https://github.com/apps/cockpit-test/installations/new";
const ALREADY_TRACKED = "Ce repo est déjà suivi dans Cockpit";

type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

const repo = (id: number, fullName: string) => ({
  id,
  full_name: fullName,
  default_branch: "main",
  private: false,
});

// Stubbed before createApp, so the app sees the stub whenever it looks fetch up.
async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A user with a live session (login user<githubId>); returns the user id and the Cookie header. */
async function userWithSession(db: TestDb, githubId: number) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `user${githubId}` })
    .returning({ id: users.id });
  assert(user);
  const value = `cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: createHash("sha256").update(value).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: user.id, githubId, cookie: `cockpit_session=${value}` };
}

async function seedProject(
  db: TestDb,
  ownerId: number,
  values: { githubRepoId: number; fullName: string; archivedAt?: Date },
) {
  const [project] = await db
    .insert(projects)
    .values({
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
      ...values,
    })
    .returning({ id: projects.id });
  assert(project);
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: ownerId, role: "owner" });
  return project.id;
}

const importRepo = (
  app: ReturnType<typeof createApp>,
  cookie: string,
  body: unknown,
) =>
  app.request("/api/projects", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const archive = (
  app: ReturnType<typeof createApp>,
  cookie: string,
  id: number | string,
) =>
  app.request(`/api/projects/${id}/archive`, {
    method: "POST",
    headers: { cookie },
  });

describe("GET /api/github/repositories", () => {
  it("given the App installed on two repos of which one is already imported by the user, when the list is requested, then installed is true, both repos come with the right imported flag and the install URL is built from the slug", async () => {
    const fetchMock = stubGitHub({
      account: 1000,
      repositories: [repo(1, "user1000/app"), repo(2, "user1000/imported")],
    });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    await seedProject(db, a.id, {
      githubRepoId: 2,
      fullName: "user1000/imported",
    });

    const res = await app.request("/api/github/repositories", {
      headers: { cookie: a.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      installUrl: INSTALL_URL,
      installed: true,
      repositories: [
        {
          githubRepoId: 1,
          fullName: "user1000/app",
          defaultBranch: "main",
          imported: false,
        },
        {
          githubRepoId: 2,
          fullName: "user1000/imported",
          defaultBranch: "main",
          imported: true,
        },
      ],
    });
    // Only the identity of the App is used: a JWT for the installation, then the installation token.
    const calls = githubCalls(fetchMock);
    const lookup = calls.find((c) => c.path === "/users/user1000/installation");
    assert(lookup, "the installation of the logged-in login must be read");
    expect(lookup.authorization).toMatch(/^bearer eyJ/i);
    const list = calls.find((c) => c.path === "/installation/repositories");
    assert(list, "the repositories of the installation must be read");
    expect(list.authorization).toContain("ghs_x");
  });

  it("given the App is not installed (GitHub answers 404), when the list is requested, then installed is false, the list is empty and the install URL is still given", async () => {
    stubGitHub({ account: null });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);

    const res = await app.request("/api/github/repositories", {
      headers: { cookie: a.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      installUrl: INSTALL_URL,
      installed: false,
      repositories: [],
    });
  });

  it("given an installation whose account is another user's, when the list is requested, then installed is false, nothing is listed and the repositories are never read", async () => {
    const fetchMock = stubGitHub({
      account: 2000,
      repositories: [repo(9, "user2000/private")],
    });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);

    const res = await app.request("/api/github/repositories", {
      headers: { cookie: a.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      installUrl: INSTALL_URL,
      installed: false,
      repositories: [],
    });
    expect(
      githubCalls(fetchMock).some(
        (c) => c.path === "/installation/repositories",
      ),
    ).toBe(false);
  });

  it.each([
    ["the installation lookup", { installationStatus: 500 }],
    ["the repository listing", { repositoriesStatus: 500 }],
  ])(
    "given GitHub answers 500 on %s, when the list is requested, then the answer is 502 with an error",
    async (_name, failure) => {
      stubGitHub({
        account: 1000,
        repositories: [repo(1, "user1000/app")],
        ...failure,
      });
      const { app, db } = await setup();
      const a = await userWithSession(db, 1000);

      const res = await app.request("/api/github/repositories", {
        headers: { cookie: a.cookie },
      });

      expect(res.status).toBe(502);
      const body = (await res.json()) as { error?: unknown };
      expect(typeof body.error).toBe("string");
    },
  );
});

describe("POST /api/projects", () => {
  it("given an available repo, when it is imported, then 201, the project comes from GitHub, the caller is its only owner and one import_project/ok entry points at it", async () => {
    stubGitHub({
      account: 1000,
      repositories: [repo(1, "user1000/app"), repo(2, "user1000/other")],
    });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);

    const res = await importRepo(app, a.cookie, { githubRepoId: 1 });

    expect(res.status).toBe(201);
    const [project, ...others] = await db.select().from(projects);
    assert(project);
    expect(others).toHaveLength(0);
    expect(project).toMatchObject({
      githubRepoId: 1,
      fullName: "user1000/app",
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
      archivedAt: null,
    });
    const body = (await res.json()) as { project: object };
    expect(body.project).toMatchObject({
      id: project.id,
      fullName: "user1000/app",
      defaultBranch: "main",
    });
    const members = await db.select().from(projectMembers);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      projectId: project.id,
      userId: a.id,
      role: "owner",
    });
    const entries = await db
      .select()
      .from(history)
      .where(eq(history.action, "import_project"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId: project.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { projectId: project.id },
    });
  });

  it("given a body that also claims a name and a branch, when a repo is imported, then the name, the branch and the installation still come from GitHub", async () => {
    stubGitHub({ account: 1000, repositories: [repo(1, "user1000/app")] });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);

    const res = await importRepo(app, a.cookie, {
      githubRepoId: 1,
      fullName: "evil/other",
      defaultBranch: "evil",
      installationId: 1,
    });

    expect(res.status).toBe(201);
    const [project] = await db.select().from(projects);
    expect(project).toMatchObject({
      fullName: "user1000/app",
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
    });
  });

  it("given a githubRepoId that is not in the caller's installation, when it is imported, then 404 with an error, nothing is created and any history entry holds no repo name", async () => {
    stubGitHub({ account: 1000, repositories: [repo(1, "user1000/app")] });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);

    const res = await importRepo(app, a.cookie, { githubRepoId: 999 });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe("string");
    expect(await db.select().from(projects)).toHaveLength(0);
    expect(await db.select().from(projectMembers)).toHaveLength(0);
    const entries = await db
      .select()
      .from(history)
      .where(eq(history.action, "import_project"));
    for (const entry of entries) expect(entry.result).toBe("refused");
    expect(JSON.stringify(entries)).not.toContain("user1000/app");
  });

  it("given a repo of another user's installation, when the caller has no installation, then 404 and nothing is created", async () => {
    stubGitHub({ account: null, repositories: [repo(1, "user2000/app")] });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);

    const res = await importRepo(app, a.cookie, { githubRepoId: 1 });

    expect(res.status).toBe(404);
    expect(await db.select().from(projects)).toHaveLength(0);
  });

  it.each([
    ["an empty object", {}],
    ["a string id", { githubRepoId: "1" }],
    ["a fractional id", { githubRepoId: 1.5 }],
  ])(
    "given %s as the body, when a repo is imported, then 400, GitHub is not called and nothing is created",
    async (_name, body) => {
      const fetchMock = stubGitHub({
        account: 1000,
        repositories: [repo(1, "user1000/app")],
      });
      const { app, db } = await setup();
      const a = await userWithSession(db, 1000);

      const res = await importRepo(app, a.cookie, body);

      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.select().from(projects)).toHaveLength(0);
    },
  );

  it.each([
    ["active", undefined],
    ["archived", new Date("2026-01-01")],
  ])(
    "given a repo already imported by user B (%s) that A's installation also lists, when A imports it, then 409 with the neutral message, nothing about B is revealed and nothing is created for A",
    async (_name, archivedAt) => {
      stubGitHub({ account: 1000, repositories: [repo(1, "user1000/app")] });
      const { app, db } = await setup();
      const a = await userWithSession(db, 1000);
      const b = await userWithSession(db, 2000);
      await seedProject(db, b.id, {
        githubRepoId: 1,
        fullName: "user2000/secret",
        archivedAt,
      });

      const res = await importRepo(app, a.cookie, { githubRepoId: 1 });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: ALREADY_TRACKED });
      expect(await db.select().from(projects)).toHaveLength(1);
      const members = await db.select().from(projectMembers);
      expect(members).toHaveLength(1);
      expect(members[0]?.userId).toBe(b.id);
      // The project may belong to someone else: the entry must not point at it.
      const entries = await db
        .select()
        .from(history)
        .where(eq(history.action, "import_project"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId: a.id,
        projectId: null,
        result: "refused",
        detail: { reason: "already_tracked" },
      });
    },
  );
});

describe("GET /api/projects", () => {
  it("given projects of two users, some archived, when A lists them, then only A's come back, active ones first and archived ones flagged last", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const b = await userWithSession(db, 2000);
    const old = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/old",
      archivedAt: new Date("2026-01-01"),
    });
    const first = await seedProject(db, a.id, {
      githubRepoId: 2,
      fullName: "user1000/first",
    });
    const second = await seedProject(db, a.id, {
      githubRepoId: 3,
      fullName: "user1000/second",
    });
    await seedProject(db, b.id, {
      githubRepoId: 4,
      fullName: "user2000/theirs",
    });

    const res = await app.request("/api/projects", {
      headers: { cookie: a.cookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: {
        id: number;
        fullName: string;
        defaultBranch: string;
        archived: boolean;
      }[];
    };
    expect(body.projects.map((p) => p.archived)).toEqual([false, false, true]);
    expect(
      body.projects
        .map((p) => p.id)
        .slice(0, 2)
        .sort(),
    ).toEqual([first, second].sort());
    expect(body.projects[2]).toEqual({
      id: old,
      fullName: "user1000/old",
      defaultBranch: "main",
      archived: true,
    });
    expect(JSON.stringify(body)).not.toContain("user2000");
  });
});

describe("POST /api/projects/:id/archive", () => {
  it("given the caller's own project, when it is archived, then 200, archivedAt is set and one archive_project/ok entry points at it", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const id = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
    });

    const res = await archive(app, a.cookie, id);

    expect(res.status).toBe(200);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    assert(project?.archivedAt, "archivedAt must be set");
    expect(Math.abs(project.archivedAt.getTime() - Date.now())).toBeLessThan(
      60_000,
    );
    const entries = await db
      .select()
      .from(history)
      .where(eq(history.action, "archive_project"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId: id,
      result: "ok",
      args: { projectId: id },
    });
  });

  it("given another user's project, when A archives it, then 404 and the project is unchanged", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const b = await userWithSession(db, 2000);
    const id = await seedProject(db, b.id, {
      githubRepoId: 1,
      fullName: "user2000/app",
    });

    const res = await archive(app, a.cookie, id);

    expect(res.status).toBe(404);
    const entries = await db
      .select()
      .from(history)
      .where(eq(history.action, "archive_project"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId: null,
      result: "refused",
    });
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(project?.archivedAt).toBeNull();
  });

  it.each(["abc", "1.5", "99999999999"])(
    "given the id %s in the URL, when it is archived, then 404, a refused archive_project entry and no error entry",
    async (badId) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1000);

      const res = await archive(app, a.cookie, badId);

      expect(res.status).toBe(404);
      const entries = await db
        .select()
        .from(history)
        .where(eq(history.action, "archive_project"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ userId: a.id, result: "refused" });
      expect(entries.some((entry) => entry.result === "error")).toBe(false);
    },
  );

  it("given an unknown id, when it is archived, then 404 and the caller's own project is unchanged", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const own = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
    });

    const res = await archive(app, a.cookie, own + 1000);

    expect(res.status).toBe(404);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, own));
    expect(project?.archivedAt).toBeNull();
  });
});

describe("authentication of the project routes", () => {
  it.each([
    ["GET", "/api/github/repositories"],
    ["GET", "/api/projects"],
    ["POST", "/api/projects"],
    ["POST", "/api/projects/1/archive"],
  ])(
    "given no session, when %s %s is called, then 401 and GitHub is not called",
    async (method, path) => {
      const fetchMock = stubGitHub({ account: 1000 });
      const { app, db } = await setup();

      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body:
          method === "POST" ? JSON.stringify({ githubRepoId: 1 }) : undefined,
      });

      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.select().from(projects)).toHaveLength(0);
    },
  );
});

// Slice 2.2: the health check reads the repo on GitHub at each call (decision 002), nothing is stored.
describe("GET /api/projects/:id/health", () => {
  // What a ready repo holds; each test removes or changes what it is about.
  const COCKPIT_URL = "https://cockpit.example.com/mcp";
  const mcpFile = (servers: Record<string, unknown>) =>
    JSON.stringify({ mcpServers: servers });
  const cockpitServer = (headers?: Record<string, string>) => ({
    type: "http",
    url: COCKPIT_URL,
    ...(headers ? { headers } : {}),
  });
  // "${NAME}": a reference to an environment variable, what a .mcp.json may hold.
  const ref = (name: string) => `\${${name}}`;
  const GOOD_AUTH = { Authorization: `Bearer ${ref("COCKPIT_MCP_TOKEN")}` };
  const AGENT_FILES = [
    ".claude/agents/test-writer.md",
    ".claude/agents/developer.md",
    ".claude/agents/reviewer.md",
    ".claude/skills/dev-us/SKILL.md",
  ];
  const readyRepo = (): Record<string, string> => ({
    "CLAUDE.md": "# Project",
    ".github/workflows/ci.yml": "name: ci",
    ".mcp.json": mcpFile({ cockpit: cockpitServer(GOOD_AUTH) }),
    ...Object.fromEntries(AGENT_FILES.map((path) => [path, "---\n---\n"])),
  });
  // The ok lines carry this fixed detail (the red ones carry their reason).
  const OK = "ok";
  const READY_LINES = [
    { key: "claude_md", ok: true, detail: OK },
    { key: "ci", ok: true, detail: OK },
    { key: "mcp", ok: true, detail: OK },
    { key: "agents", ok: true, detail: OK },
  ];

  type Line = { key: string; ok: boolean; detail: string };
  const health = (
    app: ReturnType<typeof createApp>,
    cookie: string,
    id: number | string,
  ) => app.request(`/api/projects/${id}/health`, { headers: { cookie } });
  const lineOf = async (res: Response, key: string) => {
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: Line[] };
    return body.lines.find((line) => line.key === key);
  };

  // What the server asked of the repo (not the installation token), as "METHOD path?query", sorted: the reads run in parallel. Every read but the root is pinned to the commit sha the root returned (decision 013).
  const repoCalls = (fetchMock: ReturnType<typeof stubGitHub>) =>
    githubCalls(fetchMock)
      .filter((c) => !c.path.startsWith("/app/installations/"))
      // The commit sha the root returned shows as SHA; the tests below check which sha it is.
      .map((c) =>
        `${c.method} ${decodeURIComponent(c.path)}${c.search}`.replace(
          /[0-9a-f]{40}/g,
          "SHA",
        ),
      )
      .sort();
  const REPO = "GET /repos/user1000/app";
  const ROOT = `${REPO}/git/trees/HEAD`;
  const CLAUDE_DIR = `${REPO}/git/trees/SHA:.claude?recursive=1`;
  const WORKFLOWS = `${REPO}/git/trees/SHA:.github/workflows`;
  const MCP_JSON = `${REPO}/contents/.mcp.json?ref=SHA`;
  // Decision 021 H: a repo that does not declare Cockpit in .mcp.json is fine, so an empty repo is red on three lines only.
  const NOTHING_IN_PLACE = [
    { key: "claude_md", ok: false, detail: "missing" },
    { key: "ci", ok: false, detail: "missing" },
    { key: "mcp", ok: true, detail: OK },
    { key: "agents", ok: false, detail: "missing" },
  ];

  /** A user A with one project user1000/app, and the stubbed GitHub holding `files`. */
  async function withRepo(
    files: Record<string, string>,
    stub: Partial<Parameters<typeof stubGitHub>[0]> = {},
    seed: { archivedAt?: Date; installationId?: number } = {},
  ) {
    const fetchMock = stubGitHub({ account: 1000, files, ...stub });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const id = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
      archivedAt: seed.archivedAt,
    });
    if (seed.installationId)
      await db
        .update(projects)
        .set({ installationId: seed.installationId })
        .where(eq(projects.id, id));
    return { fetchMock, app, db, a, id };
  }

  it("given a repo with everything in place, when the health is requested, then 200 with the four lines in order, all ok", async () => {
    const { app, a, id } = await withRepo(readyRepo());

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: READY_LINES });
  });

  it("given an empty repo, when the health is requested, then 200, the other three lines are missing and the mcp line is ok (Cockpit is a connector, decision 021 H), in order", async () => {
    const { app, a, id } = await withRepo({});

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: NOTHING_IN_PLACE });
  });

  it.each([
    ["CLAUDE.md at the root", { "CLAUDE.md": "# x" }, true],
    [".claude/CLAUDE.md", { ".claude/CLAUDE.md": "# x" }, true],
    ["neither of them", { "README.md": "# x", ".claude/other.md": "x" }, false],
  ])(
    "given %s, when the health is requested, then the claude_md line is ok=%s",
    async (_name, files, ok) => {
      const { app, a, id } = await withRepo(files);

      const line = await lineOf(await health(app, a.cookie, id), "claude_md");

      expect(line).toEqual({
        key: "claude_md",
        ok,
        detail: ok ? OK : "missing",
      });
    },
  );

  it.each([
    ["a .yml workflow", { ".github/workflows/ci.yml": "x" }, true],
    ["a .yaml workflow", { ".github/workflows/release.yaml": "x" }, true],
    ["no .github directory", { "README.md": "x" }, false],
    [
      "only other files and a directory called like a workflow",
      {
        ".github/workflows/README.md": "x",
        ".github/workflows/ci.yml.bak": "x",
        ".github/workflows/nested.yml/a.txt": "x",
      },
      false,
    ],
    ["a workflow outside .github/workflows", { "ci.yml": "x" }, false],
  ])(
    "given %s, when the health is requested, then the ci line is ok=%s",
    async (_name, files, ok) => {
      const { app, a, id } = await withRepo(files);

      const line = await lineOf(await health(app, a.cookie, id), "ci");

      expect(line).toEqual({ key: "ci", ok, detail: ok ? OK : "missing" });
    },
  );

  it.each([
    [
      "a Bearer reference to an environment variable",
      mcpFile({ cockpit: cockpitServer(GOOD_AUTH) }),
    ],
    [
      "no headers at all (OAuth, decision 006)",
      mcpFile({ cockpit: cockpitServer() }),
    ],
    [
      "a bare reference in another header",
      mcpFile({ cockpit: cockpitServer({ "X-Token": ref("MY_TOKEN") }) }),
    ],
    [
      "another server holding a literal secret next to a clean Cockpit entry",
      mcpFile({
        github: {
          type: "http",
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer ghp_literal" },
        },
        cockpit: cockpitServer(GOOD_AUTH),
      }),
    ],
  ])(
    "given .mcp.json declares Cockpit with %s, when the health is requested, then the mcp line is ok",
    async (_name, file) => {
      const { app, a, id } = await withRepo({ ".mcp.json": file });

      const line = await lineOf(await health(app, a.cookie, id), "mcp");

      expect(line).toEqual({ key: "mcp", ok: true, detail: OK });
    },
  );

  it.each([
    ["no .mcp.json", undefined],
    ["an empty object", "{}"],
    ["an empty server list", mcpFile({})],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
    ["mcpServers that is not an object", '{"mcpServers":"cockpit"}'],
    [
      "only another server, with a literal secret",
      mcpFile({
        other: {
          type: "http",
          url: "https://other.example.com/mcp",
          headers: { Authorization: "Bearer literal" },
        },
      }),
    ],
    [
      "the right host but not the /mcp path",
      mcpFile({
        cockpit: { type: "http", url: "https://cockpit.example.com/" },
      }),
    ],
    [
      "the /mcp path on another origin",
      mcpFile({
        cockpit: { type: "http", url: "https://evil.example.com/mcp" },
      }),
    ],
    [
      "a server without url",
      mcpFile({ cockpit: { command: "npx", args: ["cockpit"] } }),
    ],
  ])(
    "given %s, when the health is requested, then the mcp line is ok: Cockpit is absent from .mcp.json (decision 021 H)",
    async (_name, file) => {
      const { app, a, id } = await withRepo(
        file === undefined ? {} : { ".mcp.json": file },
      );

      const line = await lineOf(await health(app, a.cookie, id), "mcp");

      expect(line).toEqual({ key: "mcp", ok: true, detail: OK });
    },
  );

  it.each([
    ["not JSON at all", "{ not json"],
    ["an empty file", ""],
  ])(
    "given a .mcp.json that is %s, when the health is requested, then 200 and the mcp line is red with detail invalid_json while the other lines are still computed",
    async (_name, file) => {
      const { app, a, id } = await withRepo({
        ...readyRepo(),
        ".mcp.json": file,
      });

      const res = await health(app, a.cookie, id);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        lines: [
          READY_LINES[0],
          READY_LINES[1],
          { key: "mcp", ok: false, detail: "invalid_json" },
          READY_LINES[3],
        ],
      });
    },
  );

  it.each([
    ["a literal Bearer token", { Authorization: "Bearer abc123" }],
    ["a literal value without Bearer", { Authorization: "abc123" }],
    [
      "a literal prefix before the reference",
      { Authorization: `Bearer prefix-${ref("COCKPIT_MCP_TOKEN")}` },
    ],
    [
      "a literal word after the reference",
      { Authorization: `Bearer ${ref("COCKPIT_MCP_TOKEN")} abc123` },
    ],
    [
      "one clean header and one literal header",
      { Authorization: GOOD_AUTH.Authorization, "X-Api-Key": "abc123" },
    ],
  ])(
    "given the Cockpit entry has %s, when the health is requested, then the mcp line is red with detail secret_in_clear",
    async (_name, headers) => {
      const { app, a, id } = await withRepo({
        ".mcp.json": mcpFile({ cockpit: cockpitServer(headers) }),
      });

      const line = await lineOf(await health(app, a.cookie, id), "mcp");

      expect(line).toEqual({
        key: "mcp",
        ok: false,
        detail: "secret_in_clear",
      });
    },
  );

  it.each([
    [
      "a literal token in env",
      { COCKPIT_MCP_TOKEN: "ghp_real" },
      "secret_in_clear",
    ],
    [
      "env pointing at a variable",
      { COCKPIT_MCP_TOKEN: ref("CI_TOKEN") },
      "ok",
    ],
  ])(
    "given the Cockpit entry has clean headers and %s, when the health is requested, then env is judged like the headers",
    async (_name, env, detail) => {
      const { app, a, id } = await withRepo({
        ".mcp.json": mcpFile({
          cockpit: { ...cockpitServer(GOOD_AUTH), env },
        }),
      });

      const line = await lineOf(await health(app, a.cookie, id), "mcp");

      expect(line).toEqual({ key: "mcp", ok: detail === "ok", detail });
    },
  );

  it.each([
    [
      "a query string carrying a token",
      mcpFile({
        cockpit: { type: "http", url: `${COCKPIT_URL}?token=ghp_x` },
      }),
    ],
    [
      "credentials in the URL",
      mcpFile({
        cockpit: {
          type: "http",
          url: "https://u:ghp_x@cockpit.example.com/mcp",
        },
      }),
    ],
    [
      "a clean entry followed by a second Cockpit entry with a literal header",
      mcpFile({
        first: cockpitServer(GOOD_AUTH),
        second: cockpitServer({ Authorization: "Bearer ghp_x" }),
      }),
    ],
    [
      "a second Cockpit entry with a literal header, then a clean one",
      mcpFile({
        second: cockpitServer({ Authorization: "Bearer ghp_x" }),
        first: cockpitServer(GOOD_AUTH),
      }),
    ],
  ])(
    "given .mcp.json declares Cockpit with %s, when the health is requested, then the mcp line is red with detail secret_in_clear",
    async (_name, file) => {
      const { app, a, id } = await withRepo({ ".mcp.json": file });

      const line = await lineOf(await health(app, a.cookie, id), "mcp");

      expect(line).toEqual({
        key: "mcp",
        ok: false,
        detail: "secret_in_clear",
      });
    },
  );

  it("given .mcp.json is a symlink that the Contents API does not serve as a file, when the health is requested, then 200 and the mcp line is ok (Cockpit is absent, decision 021 H), not a 502", async () => {
    const { app, a, id } = await withRepo(
      {},
      {
        specials: {
          ".mcp.json": { type: "symlink", target: "config/mcp.json" },
        },
      },
    );

    const line = await lineOf(await health(app, a.cookie, id), "mcp");

    expect(line).toEqual({ key: "mcp", ok: true, detail: OK });
  });

  it.each([
    ["CLAUDE.md", "claude_md"],
    [".claude/CLAUDE.md", "claude_md"],
  ] as const)(
    "given %s is a symlink (a blob of mode 120000 in the tree), when the health is requested, then the claude_md line is ok, as GitHub serves it",
    async (path, key) => {
      const { app, a, id } = await withRepo(
        {},
        { specials: { [path]: { type: "symlink", target: "docs/CLAUDE.md" } } },
      );

      const line = await lineOf(await health(app, a.cookie, id), key);

      expect(line).toEqual({ key, ok: true, detail: OK });
    },
  );

  it("given .claude/agents is a submodule (type commit in the tree) next to the skill, when the health is requested, then the agents line is red with detail missing", async () => {
    const { app, a, id } = await withRepo(
      { ".claude/skills/dev-us/SKILL.md": "x" },
      { specials: { ".claude/agents": { type: "submodule" } } },
    );

    const line = await lineOf(await health(app, a.cookie, id), "agents");

    expect(line).toEqual({ key: "agents", ok: false, detail: "missing" });
  });

  it("given .github/workflows only exists as a file and CLAUDE.md as a directory, when the health is requested, then only blobs count: claude_md and ci are red", async () => {
    const { app, a, id } = await withRepo({
      ".github/workflows": "not a directory",
      "CLAUDE.md/notes.md": "# x",
    });

    const res = await health(app, a.cookie, id);

    const lines = ((await res.json()) as { lines: Line[] }).lines;
    expect(lines.find((l) => l.key === "claude_md")?.ok).toBe(false);
    expect(lines.find((l) => l.key === "ci")?.ok).toBe(false);
  });

  it("given an instance whose public URL is https://cp.example.org, when the health is requested, then Cockpit is recognised by that origin and not by a fixed one", async () => {
    stubGitHub({
      account: 1000,
      files: {
        ".mcp.json": mcpFile({
          cockpit: { type: "http", url: "https://cp.example.org/mcp" },
        }),
      },
    });
    const db = await openTestDatabase();
    await configureTestInstance(db, TEST_KEY, {
      publicUrl: "https://cp.example.org",
    });
    const app = createApp(db, "1.2.3", testAppOptions);
    const a = await userWithSession(db, 1000);
    const id = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
    });

    const line = await lineOf(await health(app, a.cookie, id), "mcp");

    expect(line).toEqual({ key: "mcp", ok: true, detail: OK });
  });

  it("given the agents and the skill all present, when the health is requested, then the agents line is ok", async () => {
    const { app, a, id } = await withRepo(
      Object.fromEntries(AGENT_FILES.map((path) => [path, "x"])),
    );

    const line = await lineOf(await health(app, a.cookie, id), "agents");

    expect(line).toEqual({ key: "agents", ok: true, detail: OK });
  });

  it.each(AGENT_FILES)(
    "given %s is the only file missing, when the health is requested, then the agents line is red with the single detail missing",
    async (absent) => {
      const { app, a, id } = await withRepo(
        Object.fromEntries(
          AGENT_FILES.filter((path) => path !== absent).map((path) => [
            path,
            "x",
          ]),
        ),
      );

      const line = await lineOf(await health(app, a.cookie, id), "agents");

      expect(line).toEqual({ key: "agents", ok: false, detail: "missing" });
    },
  );

  it("given an archived project, when its health is requested, then it is still readable", async () => {
    const { app, a, id } = await withRepo(
      readyRepo(),
      {},
      { archivedAt: new Date("2026-01-01") },
    );

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: READY_LINES });
  });

  it("given a project stored with installation 88 and the repo user1000/app, when the health is requested, then GitHub is read with that installation's token, on that repo, through the tree of HEAD (no ref, no branch name)", async () => {
    const { app, db, a, id, fetchMock } = await withRepo(
      readyRepo(),
      { installations: [88] },
      { installationId: 88 },
    );
    await db
      .update(projects)
      .set({ defaultBranch: "stored-branch" })
      .where(eq(projects.id, id));

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    const calls = githubCalls(fetchMock);
    expect(
      calls.some(
        (c) =>
          c.method === "POST" &&
          c.path === "/app/installations/88/access_tokens",
      ),
    ).toBe(true);
    const repoCalls = calls.filter((c) => c.path.startsWith("/repos/"));
    for (const call of repoCalls) {
      expect(call.method).toBe("GET");
      expect(call.path).toMatch(/^\/repos\/user1000\/app(\/|$)/);
      expect(call.authorization).toContain("ghs_88");
      if (call.path.includes("/contents/"))
        expect(call.search).toMatch(/^\?ref=[0-9a-f]{40}$/);
      else expect(call.search).not.toContain("ref=");
      expect(call.path).not.toContain("stored-branch");
      expect(call.search).not.toContain("stored-branch");
    }
    expect(
      repoCalls.filter((c) => c.path === "/repos/user1000/app/git/trees/HEAD"),
    ).toEqual([expect.objectContaining({ search: "", method: "GET" })]);
  });

  it("given a repo with everything in place including .claude, .github and .mcp.json, when the health is requested, then GitHub is called exactly four times besides the installation token: the root, .claude (recursive), .github/workflows and .mcp.json", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(repoCalls(fetchMock)).toEqual(
      [MCP_JSON, CLAUDE_DIR, WORKFLOWS, ROOT].sort(),
    );
  });

  it("given a repo without .mcp.json, when the health is requested, then .mcp.json is not read: three calls, the root, .claude and .github/workflows", async () => {
    const { app, a, id, fetchMock } = await withRepo({
      "CLAUDE.md": "# x",
      ".github/workflows/ci.yml": "x",
      ...Object.fromEntries(AGENT_FILES.map((path) => [path, "x"])),
    });

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(repoCalls(fetchMock)).toEqual([CLAUDE_DIR, WORKFLOWS, ROOT].sort());
  });

  it.each([
    ["a repo with nothing", {}, {}, [ROOT]],
    [
      "a repo with only CLAUDE.md at the root",
      { "CLAUDE.md": "# x" },
      {},
      [ROOT],
    ],
    [
      "a repo with only a .claude directory",
      { ".claude/CLAUDE.md": "# x" },
      {},
      [ROOT, CLAUDE_DIR],
    ],
    [
      "a repo with only a .github directory",
      { ".github/workflows/ci.yml": "x" },
      {},
      [ROOT, WORKFLOWS],
    ],
    [
      "a repo with only a .mcp.json",
      { ".mcp.json": "{}" },
      {},
      [ROOT, MCP_JSON],
    ],
    [
      "a repo whose .claude and .github are files, not directories",
      { ".claude": "x", ".github": "x" },
      {},
      [ROOT],
    ],
    [
      "a repo whose .claude is a submodule",
      {},
      { specials: { ".claude": { type: "submodule" } } },
      [ROOT],
    ],
  ] as const)(
    "given %s, when the health is requested, then only what the root shows is read",
    async (_name, files, stub, calls) => {
      const { app, a, id, fetchMock } = await withRepo({ ...files }, stub);

      const res = await health(app, a.cookie, id);

      expect(res.status).toBe(200);
      expect(repoCalls(fetchMock)).toEqual([...calls].sort());
      expect(repoCalls(fetchMock)).not.toContain(`${ROOT}?recursive=1`);
    },
  );

  it("given a repo with 150,000 files elsewhere (committed dependencies) and the Claude files in place, when the health is requested, then every line is ok and the whole repo is never read recursively", async () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 150_000 }, (_, i) => [
        `node_modules/pkg${i % 1000}/file${i}.js`,
        "",
      ]),
    );
    const { app, a, id, fetchMock } = await withRepo({
      ...dependencies,
      ...readyRepo(),
    });

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: READY_LINES });
    expect(repoCalls(fetchMock)).toEqual(
      [MCP_JSON, CLAUDE_DIR, WORKFLOWS, ROOT].sort(),
    );
  });

  it("given the Claude files are missing in a repo with 150,000 files elsewhere, when the health is requested, then the lines are red for the right reason, not a 502", async () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 150_000 }, (_, i) => [
        `node_modules/pkg${i % 1000}/file${i}.js`,
        "",
      ]),
    );
    const { app, a, id } = await withRepo(dependencies);

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: NOTHING_IN_PLACE });
  });

  it("given .mcp.json is only a directory in the tree, when the health is requested, then it is not read: the mcp line is ok (Cockpit is absent, decision 021 H) and the tree is the only call", async () => {
    const { app, a, id, fetchMock } = await withRepo({
      ".mcp.json/other.json": "{}",
    });

    const line = await lineOf(await health(app, a.cookie, id), "mcp");

    expect(line).toEqual({ key: "mcp", ok: true, detail: OK });
    expect(
      githubCalls(fetchMock).filter((c) => c.path.includes("/contents/")),
    ).toEqual([]);
  });

  it("given the recursive read of .claude is truncated, when the health is requested, then .claude, .claude/agents and .claude/skills/dev-us are read one by one and the lines are correct", async () => {
    const { app, a, id, fetchMock } = await withRepo(
      {
        ".claude/CLAUDE.md": "# x",
        ...Object.fromEntries(AGENT_FILES.map((path) => [path, "x"])),
      },
      { treesTruncated: { "HEAD:.claude": true } },
    );

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [
        READY_LINES[0],
        { key: "ci", ok: false, detail: "missing" },
        { key: "mcp", ok: true, detail: OK },
        READY_LINES[3],
      ],
    });
    expect(repoCalls(fetchMock)).toEqual(
      [
        ROOT,
        CLAUDE_DIR,
        `${REPO}/git/trees/SHA:.claude`,
        `${REPO}/git/trees/SHA:.claude/agents`,
        `${REPO}/git/trees/SHA:.claude/skills/dev-us`,
      ].sort(),
    );
  });

  it("given the recursive read of .claude is truncated and agents and skills do not exist, when the health is requested, then those 404s mean absent: 200, agents red, claude_md ok", async () => {
    const { app, a, id } = await withRepo(
      { ".claude/CLAUDE.md": "# x", ".claude/settings.json": "{}" },
      { treesTruncated: { "HEAD:.claude": true } },
    );

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [
        READY_LINES[0],
        { key: "ci", ok: false, detail: "missing" },
        { key: "mcp", ok: true, detail: OK },
        { key: "agents", ok: false, detail: "missing" },
      ],
    });
  });

  it("given the recursive read of .claude is truncated and the skill folder lacks SKILL.md, when the health is requested, then agents is red", async () => {
    const { app, a, id } = await withRepo(
      {
        ...Object.fromEntries(AGENT_FILES.slice(0, 3).map((p) => [p, "x"])),
        ".claude/skills/dev-us/notes.md": "x",
      },
      { treesTruncated: { "HEAD:.claude": true } },
    );

    const line = await lineOf(await health(app, a.cookie, id), "agents");

    expect(line).toEqual({ key: "agents", ok: false, detail: "missing" });
  });

  it.each([
    [
      ".github/workflows is a file",
      { ".github/workflows": "not a directory", "CLAUDE.md": "# x" },
      {},
    ],
    [
      ".github/workflows is a submodule",
      { "CLAUDE.md": "# x" },
      { specials: { ".github/workflows": { type: "submodule" } } },
    ],
  ] as const)(
    "given %s (GitHub answers 422 on its tree), when the health is requested, then 200 and ci is red with detail missing, not a 502",
    async (_name, files, stub) => {
      const { app, a, id } = await withRepo({ ...files }, stub);

      const res = await health(app, a.cookie, id);

      expect(await lineOf(res, "ci")).toEqual({
        key: "ci",
        ok: false,
        detail: "missing",
      });
    },
  );

  it.each([
    [
      ".claude/agents is a file",
      {
        ".claude/CLAUDE.md": "# x",
        ".claude/agents": "not a directory",
        ".claude/skills/dev-us/SKILL.md": "x",
      },
    ],
    [
      ".claude/skills/dev-us is a file",
      {
        ".claude/CLAUDE.md": "# x",
        ...Object.fromEntries(
          AGENT_FILES.slice(0, 3).map((path) => [path, "x"]),
        ),
        ".claude/skills/dev-us": "not a directory",
      },
    ],
  ])(
    "given the recursive read of .claude is truncated and %s (GitHub answers 422), when the health is requested, then 200, claude_md ok and agents red with detail missing, not a 502",
    async (_name, files) => {
      const { app, a, id } = await withRepo(files, {
        treesTruncated: { "HEAD:.claude": true },
      });

      const res = await health(app, a.cookie, id);

      expect(res.status).toBe(200);
      const lines = ((await res.json()) as { lines: Line[] }).lines;
      expect(lines.find((l) => l.key === "claude_md")).toEqual(READY_LINES[0]);
      expect(lines.find((l) => l.key === "agents")).toEqual({
        key: "agents",
        ok: false,
        detail: "missing",
      });
    },
  );

  it.each([
    ["CLAUDE.md at the root", { "CLAUDE.md": "# x" }, true],
    ["no CLAUDE.md at the root", { "README.md": "# x" }, false],
  ])(
    "given .claude is a tree at the root but its own read answers 404 (a race) and %s, when the health is requested, then 200, claude_md comes from the root only (ok=%s) and agents is missing",
    async (_name, rootFiles, ok) => {
      const { app, a, id } = await withRepo(
        {
          ...rootFiles,
          ".claude/CLAUDE.md": "# x",
          ...Object.fromEntries(AGENT_FILES.map((path) => [path, "x"])),
        },
        { treesStatus: { "HEAD:.claude": 404 } },
      );

      const res = await health(app, a.cookie, id);

      expect(res.status).toBe(200);
      const lines = ((await res.json()) as { lines: Line[] }).lines;
      expect(lines.find((l) => l.key === "claude_md")).toEqual({
        key: "claude_md",
        ok,
        detail: ok ? OK : "missing",
      });
      expect(lines.find((l) => l.key === "agents")).toEqual({
        key: "agents",
        ok: false,
        detail: "missing",
      });
    },
  );

  it("given a repo that is not truncated, when the health is requested, then there is no fallback read of .claude", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());

    await health(app, a.cookie, id);

    expect(repoCalls(fetchMock)).not.toContain(`${REPO}/git/trees/SHA:.claude`);
  });

  it("given a successful check, when it is done, then nothing is written to the history and the project is unchanged", async () => {
    const { app, db, a, id } = await withRepo(readyRepo());
    const before = await db.select().from(projects);

    expect((await health(app, a.cookie, id)).status).toBe(200);
    expect((await health(app, a.cookie, id)).status).toBe(200);

    expect(await db.select().from(history)).toHaveLength(0);
    expect(await db.select().from(projects)).toEqual(before);
    expect(await db.select().from(projectMembers)).toHaveLength(1);
  });

  it("given the repo changes on GitHub between two requests, when the health is requested twice, then the second answer reflects it (nothing is cached or stored)", async () => {
    const { app, a, id } = await withRepo({});
    expect(await lineOf(await health(app, a.cookie, id), "claude_md")).toEqual({
      key: "claude_md",
      ok: false,
      detail: "missing",
    });
    stubGitHub({ account: 1000, files: { "CLAUDE.md": "# x" } });

    const line = await lineOf(await health(app, a.cookie, id), "claude_md");

    expect(line).toEqual({ key: "claude_md", ok: true, detail: OK });
  });

  it.each([
    ["a 500 on the tree", { treesStatus: 500 }],
    ["a 502 on the tree", { treesStatus: 502 }],
    ["a 403 on the tree", { treesStatus: 403 }],
    ["a 500 on .mcp.json", { contentsStatus: { ".mcp.json": 500 } }],
    ["a 500 on the .claude tree", { treesStatus: { "HEAD:.claude": 500 } }],
    [
      "a 500 on .github/workflows",
      { treesStatus: { "HEAD:.github/workflows": 500 } },
    ],
    [
      "a 500 on a fallback read of .claude/agents",
      {
        treesTruncated: { "HEAD:.claude": true },
        treesStatus: { "HEAD:.claude/agents": 500 },
      },
    ],
    ["a network error", { networkError: true }],
    ["an installation token that cannot be issued", { tokenStatus: 500 }],
  ])(
    "given GitHub fails with %s, when the health is requested, then 502 github_unavailable, no partial answer, nothing from GitHub is relayed and no history entry",
    async (_name, failure) => {
      const { app, db, a, id } = await withRepo(readyRepo(), failure);

      const res = await health(app, a.cookie, id);

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "github_unavailable" });
      expect(await db.select().from(history)).toHaveLength(0);
    },
  );

  it("given the installation token request answers 404 (the App was uninstalled), when the health is requested, then 409 repo_unreachable and no history entry", async () => {
    const { app, db, a, id } = await withRepo(readyRepo(), {
      tokenStatus: 404,
    });

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_unreachable" });
    expect(await db.select().from(history)).toHaveLength(0);
  });

  it("given the tree answers 404 (the App lost access to the repo), when the health is requested, then 409 repo_unreachable, with no other call to GitHub than the tree, and no history entry", async () => {
    const { app, db, a, id, fetchMock } = await withRepo(readyRepo(), {
      treesStatus: 404,
    });

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_unreachable" });
    expect(await db.select().from(history)).toHaveLength(0);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
  });

  it("given .github exists but holds no workflows directory (404), when the health is requested, then 200 and ci is missing", async () => {
    const { app, a, id, fetchMock } = await withRepo({
      ".github/CODEOWNERS": "* @me",
      "CLAUDE.md": "# x",
    });

    const res = await health(app, a.cookie, id);

    expect(await lineOf(res, "ci")).toEqual({
      key: "ci",
      ok: false,
      detail: "missing",
    });
    expect(repoCalls(fetchMock)).toEqual([ROOT, WORKFLOWS].sort());
  });

  it("given an empty repository (the tree answers 409 Git Repository is empty), when the health is requested, then 200 with the lines of an empty repo (mcp ok, decision 021 H), in order, after a single call to the tree", async () => {
    const { app, a, id, fetchMock } = await withRepo({}, { emptyRepo: true });

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: NOTHING_IN_PLACE });
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
  });

  it("given a repo that holds none of the files (an empty tree), when the health is requested, then it is a normal 200 and not repo_unreachable", async () => {
    const { app, a, id } = await withRepo({});

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
  });

  it("given another user's project, when A requests its health, then 404, GitHub is not called and nothing is written", async () => {
    const fetchMock = stubGitHub({ account: 1000, files: readyRepo() });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const b = await userWithSession(db, 2000);
    const theirs = await seedProject(db, b.id, {
      githubRepoId: 1,
      fullName: "user2000/app",
    });

    // Control: the route exists and answers A for A's own project.
    const own = await seedProject(db, a.id, {
      githubRepoId: 2,
      fullName: "user1000/own",
    });
    expect((await health(app, a.cookie, own)).status).toBe(200);
    fetchMock.mockClear();

    const res = await health(app, a.cookie, theirs);

    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("user2000");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(history)).toHaveLength(0);
  });

  it.each(["abc", "1.5", "0", "99999999999"])(
    "given the id %s in the URL, when the health is requested, then 404, GitHub is not called and nothing is written",
    async (badId) => {
      const fetchMock = stubGitHub({ account: 1000, files: readyRepo() });
      const { app, db } = await setup();
      const a = await userWithSession(db, 1000);
      const own = await seedProject(db, a.id, {
        githubRepoId: 1,
        fullName: "user1000/app",
      });
      // Control: the route exists and answers for a real id.
      expect((await health(app, a.cookie, own)).status).toBe(200);
      fetchMock.mockClear();

      const res = await health(app, a.cookie, badId);

      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.select().from(history)).toHaveLength(0);
    },
  );

  it("given an unknown id, when the health is requested, then 404 and GitHub is not called", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    // Control: the route exists and answers for the real id.
    expect((await health(app, a.cookie, id)).status).toBe(200);
    fetchMock.mockClear();

    const res = await health(app, a.cookie, id + 1000);

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("given no session, when the health is requested, then 401 and GitHub is not called", async () => {
    const fetchMock = stubGitHub({ account: 1000, files: readyRepo() });
    const { app } = await setup();

    const res = await app.request("/api/projects/1/health");

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("given an instance the wizard has not configured, when the health is requested, then 503 whoever asks", async () => {
    const fetchMock = stubGitHub({ account: 1000, files: readyRepo() });
    const db = await openTestDatabase();
    const app = createApp(db, "1.2.3", testAppOptions);

    const res = await app.request("/api/projects/1/health");

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The health cache (decision 013 G): per repo, in the memory of the app, addressed by the commit sha GitHub returns for HEAD.
  // Each test builds its own app with `setup()` / `withRepos()`, and the cache lives in that app, so every test starts empty.
  const ROOT_PATH = "/repos/user1000/app/git/trees/HEAD";
  const rootCalls = (fetchMock: ReturnType<typeof stubGitHub>) =>
    githubCalls(fetchMock).filter((c) => c.path === ROOT_PATH);
  // The status GitHub answered to each call, same order as githubCalls.
  const statuses = (fetchMock: ReturnType<typeof stubGitHub>) =>
    Promise.all(
      fetchMock.mock.results.map(async (r) => (await r.value).status as number),
    );
  const ALL_FOUR = [MCP_JSON, CLAUDE_DIR, WORKFLOWS, ROOT].sort();
  const linesOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return ((await res.json()) as { lines: Line[] }).lines;
  };
  // The repo without the reviewer agent: the agents line is red until the reviewer is added.
  const withoutReviewer = () => {
    const files = readyRepo();
    delete files[".claude/agents/reviewer.md"];
    return files;
  };

  /** A user A with one project per entry of `repos` (user1000/<name>, the given files); `healthCacheSize` is the hook that lowers the limit of the cache. */
  async function withRepos(
    repos: Record<string, Record<string, string>>,
    healthCacheSize?: number,
  ) {
    const fetchMock = stubGitHub({
      account: 1000,
      repoFiles: Object.fromEntries(
        Object.entries(repos).map(([name, files]) => [
          `user1000/${name}`,
          files,
        ]),
      ),
    });
    const db = await openTestDatabase();
    await configureTestInstance(db, TEST_KEY);
    // A variable, not a literal: typechecks before `healthCacheSize` exists in AppOptions.
    const appOptions: typeof testAppOptions & { healthCacheSize?: number } = {
      ...testAppOptions,
      ...(healthCacheSize ? { healthCacheSize } : {}),
    };
    const app = createApp(db, "1.2.3", appOptions);
    const a = await userWithSession(db, 1000);
    const ids: Record<string, number> = {};
    let githubRepoId = 1;
    for (const name of Object.keys(repos))
      ids[name] = await seedProject(db, a.id, {
        githubRepoId: githubRepoId++,
        fullName: `user1000/${name}`,
      });
    // What the server asked of this repo only, as repoCalls shows it.
    const callsOn = (name: string) =>
      repoCalls(fetchMock).filter((c) =>
        c.startsWith(`GET /repos/user1000/${name}/`),
      );
    return { fetchMock, app, db, a, ids, callsOn };
  }

  it("given an unchanged repo already checked, when the health is requested again, then the only call to the repo is the root with If-None-Match, GitHub answers 304 and the same four lines come back", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    const first = await health(app, a.cookie, id);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    fetchMock.mockClear();

    const second = await health(app, a.cookie, id);

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(firstBody).toEqual({ lines: READY_LINES });
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    const [root] = rootCalls(fetchMock);
    expect(root?.ifNoneMatch).toMatch(/^W\/"/);
    expect(await statuses(fetchMock)).toContain(304);
  });

  it("given a push that adds a file under .claude between two displays, when the health is requested again, then the root answers 200 with a new sha, the sub-reads happen and the new lines are returned", async () => {
    const { app, a, id, fetchMock } = await withRepo(withoutReviewer());
    expect((await linesOf(await health(app, a.cookie, id)))[3]).toEqual({
      key: "agents",
      ok: false,
      detail: "missing",
    });
    fetchMock.update({ files: readyRepo() });
    fetchMock.mockClear();

    const lines = await linesOf(await health(app, a.cookie, id));

    expect(lines).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual(ALL_FOUR);
    expect(rootCalls(fetchMock)[0]?.ifNoneMatch).not.toBe("");
    expect(await statuses(fetchMock)).not.toContain(304);
    // The new state is what is cached now.
    fetchMock.mockClear();
    expect(await linesOf(await health(app, a.cookie, id))).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
  });

  it("given a change that touches only a file read by the health (.mcp.json), when the health is requested again, then the new text is read and judged", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    expect(await linesOf(await health(app, a.cookie, id))).toEqual(READY_LINES);
    fetchMock.mockClear();
    await health(app, a.cookie, id);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    fetchMock.update({
      files: {
        ...readyRepo(),
        ".mcp.json": mcpFile({
          cockpit: cockpitServer({ Authorization: "Bearer ghp_x" }),
        }),
      },
    });

    const lines = await linesOf(await health(app, a.cookie, id));

    expect(lines[2]).toEqual({
      key: "mcp",
      ok: false,
      detail: "secret_in_clear",
    });
  });

  it("given GitHub answers 200 on the root with the same commit sha but another ETag, when the health is requested again, then the cached lines come back and nothing else is read", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    await health(app, a.cookie, id);
    fetchMock.rotateEtag();
    fetchMock.mockClear();

    const res = await health(app, a.cookie, id);

    expect(await linesOf(res)).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    expect(await statuses(fetchMock)).not.toContain(304);
  });

  it("given the ETag rotated with the same commit sha, when the health is requested a third time, then the root is sent with the new ETag and GitHub answers 304", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    await health(app, a.cookie, id);
    fetchMock.rotateEtag();
    await health(app, a.cookie, id);
    const [, second] = rootCalls(fetchMock);
    fetchMock.mockClear();

    const res = await health(app, a.cookie, id);

    expect(await linesOf(res)).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    expect(rootCalls(fetchMock)[0]?.ifNoneMatch).not.toBe(second?.ifNoneMatch);
    expect(await statuses(fetchMock)).toContain(304);
  });

  // The commit sha of each read that is not the root: trees `<sha>:<dir>` and Contents `?ref=<sha>`.
  const pinnedShas = (fetchMock: ReturnType<typeof stubGitHub>) =>
    githubCalls(fetchMock)
      .filter((c) => c.path.startsWith("/repos/") && !c.path.endsWith("/HEAD"))
      .map(
        (c) =>
          /\/trees\/([^/:]+):/.exec(decodeURIComponent(c.path))?.[1] ??
          new URLSearchParams(c.search).get("ref"),
      );

  it("given a repo with everything in place, when the health is requested, then every sub-read is pinned to the commit sha the root returned: .claude, .github/workflows and .mcp.json, never HEAD", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());

    expect((await health(app, a.cookie, id)).status).toBe(200);

    const [sha] = fetchMock.served;
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(pinnedShas(fetchMock)).toEqual([sha, sha, sha]);
    expect(
      githubCalls(fetchMock).filter((c) =>
        decodeURIComponent(c.path).includes("HEAD:"),
      ),
    ).toEqual([]);
  });

  it("given a push that lands after the root was read and before the sub-reads, when the health is requested, then the lines describe the commit the root returned, and the next display re-reads the new commit", async () => {
    const { app, a, id, fetchMock } = await withRepo(withoutReviewer());
    fetchMock.afterNextRoot(() => fetchMock.update({ files: readyRepo() }));

    const first = await linesOf(await health(app, a.cookie, id));

    // The old commit: the reviewer was not there yet. The new files are not mixed in.
    expect(first[3]).toEqual({ key: "agents", ok: false, detail: "missing" });
    expect(first).toEqual([
      READY_LINES[0],
      READY_LINES[1],
      READY_LINES[2],
      { key: "agents", ok: false, detail: "missing" },
    ]);
    const [oldSha] = fetchMock.served;
    expect(pinnedShas(fetchMock)).toEqual([oldSha, oldSha, oldSha]);
    fetchMock.mockClear();

    const second = await linesOf(await health(app, a.cookie, id));

    expect(second).toEqual(READY_LINES);
    expect(fetchMock.served).toHaveLength(2);
    const newSha = fetchMock.served[1];
    expect(newSha).not.toBe(oldSha);
    expect(repoCalls(fetchMock)).toEqual(ALL_FOUR);
    expect(pinnedShas(fetchMock)).toEqual([newSha, newSha, newSha]);
  });

  it("given a good check cached and a 500 on the root, when the health is requested, then 502 github_unavailable, and once GitHub answers 304 again the good cached lines are returned", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    await health(app, a.cookie, id);
    const [firstRoot] = rootCalls(fetchMock);
    fetchMock.update({ treesStatus: 500 });

    const failed = await health(app, a.cookie, id);

    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "github_unavailable" });
    fetchMock.update({ treesStatus: undefined });
    fetchMock.mockClear();

    const third = await health(app, a.cookie, id);

    expect(await linesOf(third)).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    // The error left the entry as it was: same ETag as the first success.
    expect(rootCalls(fetchMock)[0]?.ifNoneMatch).not.toBe("");
    expect(await statuses(fetchMock)).toContain(304);
    expect(firstRoot?.ifNoneMatch).toBe("");
  });

  it("given a good check cached and a 500 on a sub-read after a push, when the health is requested, then 502, and the old entry is not replaced by a partial one", async () => {
    const { app, a, id, fetchMock } = await withRepo(withoutReviewer());
    await health(app, a.cookie, id);
    fetchMock.update({
      files: readyRepo(),
      contentsStatus: { ".mcp.json": 500 },
    });

    expect((await health(app, a.cookie, id)).status).toBe(502);

    fetchMock.update({ contentsStatus: undefined });
    fetchMock.mockClear();
    // The push is still not cached: the repo is read in full and the new lines come back.
    expect(await linesOf(await health(app, a.cookie, id))).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual(ALL_FOUR);
    // The entry of the old state is still the one sent.
    expect(rootCalls(fetchMock)[0]?.ifNoneMatch).not.toBe("");
  });

  it("given a good check cached and the root now answers 404 (access lost), when the health is requested, then 409 repo_unreachable, and the cache is still good once access is back", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    await health(app, a.cookie, id);
    fetchMock.update({ treesStatus: 404 });

    const lost = await health(app, a.cookie, id);

    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: "repo_unreachable" });
    fetchMock.update({ treesStatus: undefined });
    fetchMock.mockClear();

    expect(await linesOf(await health(app, a.cookie, id))).toEqual(READY_LINES);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    expect(await statuses(fetchMock)).toContain(304);
  });

  it("given a good check cached and the repo is now empty (409 Git Repository is empty), when the health is requested, then 200 with the lines of an empty repo (mcp ok, decision 021 H) as without a cache, not the cached lines", async () => {
    const { app, a, id, fetchMock } = await withRepo(readyRepo());
    await health(app, a.cookie, id);
    fetchMock.mockClear();
    await health(app, a.cookie, id);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    fetchMock.update({ emptyRepo: true });

    const res = await health(app, a.cookie, id);

    expect(await linesOf(res)).toEqual(NOTHING_IN_PLACE);
  });

  it("given two projects on different repos, when each is displayed twice, then each keeps its own lines and only ever sends its own ETag", async () => {
    const { app, a, ids, fetchMock, callsOn } = await withRepos({
      app: readyRepo(),
      bare: {},
    });
    const lines = async (name: string) =>
      linesOf(await health(app, a.cookie, ids[name] as number));
    expect(await lines("app")).toEqual(READY_LINES);
    expect(await lines("bare")).toEqual(NOTHING_IN_PLACE);
    fetchMock.mockClear();

    expect(await lines("bare")).toEqual(NOTHING_IN_PLACE);
    expect(await lines("app")).toEqual(READY_LINES);

    expect(callsOn("app")).toEqual([ROOT]);
    expect(callsOn("bare")).toEqual([
      `GET /repos/user1000/bare/git/trees/HEAD`,
    ]);
    const sent = githubCalls(fetchMock)
      .filter((c) => c.path.endsWith("/git/trees/HEAD"))
      .map((c) => c.ifNoneMatch);
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toBe("");
    expect(sent[1]).not.toBe("");
    expect(sent[0]).not.toBe(sent[1]);
  });

  it("given the same repo path tracked under another installation, when it is displayed for the first time, then it is read in full and sent without If-None-Match: the cache is keyed on the installation too", async () => {
    const fetchMock = stubGitHub({
      account: 1000,
      files: readyRepo(),
      installations: [INSTALLATION_ID, 88],
    });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const first = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
    });
    const second = await seedProject(db, a.id, {
      githubRepoId: 2,
      fullName: "user1000/app",
    });
    await db
      .update(projects)
      .set({ installationId: 88 })
      .where(eq(projects.id, second));
    expect((await health(app, a.cookie, first)).status).toBe(200);
    fetchMock.mockClear();
    expect((await health(app, a.cookie, first)).status).toBe(200);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    fetchMock.mockClear();

    const res = await health(app, a.cookie, second);

    expect(res.status).toBe(200);
    expect(repoCalls(fetchMock)).toEqual(ALL_FOUR);
    expect(rootCalls(fetchMock).map((c) => c.ifNoneMatch)).toEqual([""]);
  });

  it("given a repo cached for user A, when a user who is not a member asks for that project, then 404 and GitHub is not called", async () => {
    const fetchMock = stubGitHub({ account: 1000, files: readyRepo() });
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const b = await userWithSession(db, 2000);
    const id = await seedProject(db, a.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
    });
    expect((await health(app, a.cookie, id)).status).toBe(200);
    fetchMock.mockClear();
    expect((await health(app, a.cookie, id)).status).toBe(200);
    expect(repoCalls(fetchMock)).toEqual([ROOT]);
    fetchMock.mockClear();

    const res = await health(app, b.cookie, id);

    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("READY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("given a cache limited to 2 repos and three repos displayed in turn, when the first is displayed again, then it is read in full while the last one is still served from the cache", async () => {
    const { app, a, ids, fetchMock, callsOn } = await withRepos(
      { r1: readyRepo(), r2: readyRepo(), r3: readyRepo() },
      2,
    );
    const show = async (name: string) =>
      linesOf(await health(app, a.cookie, ids[name] as number));
    await show("r1");
    await show("r2");
    await show("r3");
    fetchMock.mockClear();

    await show("r3");
    expect(callsOn("r3")).toEqual(["GET /repos/user1000/r3/git/trees/HEAD"]);
    fetchMock.mockClear();

    expect(await show("r1")).toEqual(READY_LINES);
    expect(callsOn("r1")).toEqual(
      [
        "GET /repos/user1000/r1/contents/.mcp.json?ref=SHA",
        "GET /repos/user1000/r1/git/trees/SHA:.claude?recursive=1",
        "GET /repos/user1000/r1/git/trees/SHA:.github/workflows",
        "GET /repos/user1000/r1/git/trees/HEAD",
      ].sort(),
    );
  });

  it("given a cache limited to 2 repos, when the first repo is displayed again before a third one comes, then the least recently used one (the second) is the one evicted", async () => {
    const { app, a, ids, fetchMock, callsOn } = await withRepos(
      { r1: readyRepo(), r2: readyRepo(), r3: readyRepo() },
      2,
    );
    const show = async (name: string) =>
      linesOf(await health(app, a.cookie, ids[name] as number));
    await show("r1");
    await show("r2");
    await show("r1");
    await show("r3");
    fetchMock.mockClear();

    await show("r1");
    expect(callsOn("r1")).toEqual(["GET /repos/user1000/r1/git/trees/HEAD"]);
    fetchMock.mockClear();

    await show("r2");
    expect(callsOn("r2")).toHaveLength(4);
  });
});
