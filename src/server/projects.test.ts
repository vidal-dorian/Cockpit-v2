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

  it("given an empty repo, when the health is requested, then 200 and the four lines are missing, in order", async () => {
    const { app, a, id } = await withRepo({});

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [
        { key: "claude_md", ok: false, detail: "missing" },
        { key: "ci", ok: false, detail: "missing" },
        { key: "mcp", ok: false, detail: "missing" },
        { key: "agents", ok: false, detail: "missing" },
      ],
    });
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
    "given %s, when the health is requested, then the mcp line is red with detail missing",
    async (_name, file) => {
      const { app, a, id } = await withRepo(
        file === undefined ? {} : { ".mcp.json": file },
      );

      const line = await lineOf(await health(app, a.cookie, id), "mcp");

      expect(line).toEqual({ key: "mcp", ok: false, detail: "missing" });
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

  it.each([
    [".claude/agents", { type: "submodule" }, "agents"],
    [".github/workflows", { type: "submodule" }, "ci"],
    ["CLAUDE.md", { type: "symlink", target: "docs/CLAUDE.md" }, "claude_md"],
    [".mcp.json", { type: "symlink", target: "config/mcp.json" }, "mcp"],
  ] as const)(
    "given %s is served by the Contents API as a submodule or a symlink, when the health is requested, then 200 and its line is red with detail missing, not a 502",
    async (path, special, key) => {
      const { app, a, id } = await withRepo(
        {},
        { specials: { [path]: special } },
      );

      const line = await lineOf(await health(app, a.cookie, id), key);

      expect(line).toEqual({ key, ok: false, detail: "missing" });
    },
  );

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

  it("given a project stored with installation 88 and the repo user1000/app, when the health is requested, then GitHub is read with that installation's token, on that repo, on the default branch (no ref)", async () => {
    const { app, a, id, fetchMock } = await withRepo(
      readyRepo(),
      { installations: [88] },
      { installationId: 88 },
    );

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
    expect(repoCalls.length).toBeGreaterThan(0);
    for (const call of repoCalls) {
      expect(call.method).toBe("GET");
      expect(call.path).toMatch(/^\/repos\/user1000\/app(\/|$)/);
      expect(call.authorization).toContain("ghs_88");
      expect(call.search).not.toContain("ref=");
    }
    expect(
      repoCalls.some((c) => c.path.includes("/contents/")),
      "the files are read through the Contents API",
    ).toBe(true);
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
    ["a 500 on a file", { contentsStatus: 500 }],
    ["a 500 on .mcp.json alone", { contentsStatus: { ".mcp.json": 500 } }],
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

  it("given the repo is no longer reachable by the installation (GET /repos/{owner}/{repo} answers 404), when the health is requested, then 409 repo_unreachable and no history entry", async () => {
    const { app, db, a, id } = await withRepo(readyRepo(), {
      repoStatus: 404,
    });

    const res = await health(app, a.cookie, id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repo_unreachable" });
    expect(await db.select().from(history)).toHaveLength(0);
  });

  it("given the repo exists but holds none of the files (404 on every file, 200 on the repo), when the health is requested, then it is a normal 200 and not repo_unreachable", async () => {
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
});
