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
import {
  githubAppConfig,
  githubCalls,
  INSTALLATION_ID,
  stubGitHub,
} from "./test-github.ts";

const config = {
  githubClientId: "Iv1.client",
  githubClientSecret: "secret",
  publicUrl: "https://cockpit.example.com",
  allowedLogins: ["user1000", "user2000"],
  ...githubAppConfig,
};
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
  const app = createApp(db, "1.2.3", config);
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
