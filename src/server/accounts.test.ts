import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { history, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { githubCalls, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  createAdminWithSession,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Slice 1.6 (decision 012 G, reopened): open sign-up, the administrator's block list, installation check.

type App = ReturnType<typeof createApp>;
type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

const INSTALL_URL = "https://github.com/apps/cockpit-test/installations/new";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

// Stubbed before createApp, so the app sees the stub whenever it looks fetch up.
async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  const admin = await createAdminWithSession(db, 99);
  return { db, app, admin };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A non-administrator with a live session (login user<githubId>, or `login`). */
async function userWithSession(db: TestDb, githubId: number, login?: string) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: login ?? `user${githubId}` })
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

const list = (app: App, cookie: string) =>
  app.request("/api/settings/users", { headers: { cookie } });

const block = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/settings/users/${id}/block`, {
    method: "POST",
    headers: { cookie },
  });

const unblock = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/settings/users/${id}/unblock`, {
    method: "POST",
    headers: { cookie },
  });

type Listed = {
  id: number;
  login: string;
  isAdmin: boolean;
  blockedAt: string | null;
  createdAt: string;
};

async function listed(app: App, cookie: string) {
  const res = await list(app, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { users: Listed[] }).users;
}

const entriesOf = (db: TestDb, action: string) =>
  db
    .select()
    .from(history)
    .where(eq(history.action, action))
    .orderBy(history.id);

describe("GET /api/settings/users", () => {
  it("given only the admin, when the list is requested, then it holds the admin as { id, login, isAdmin, blockedAt, createdAt }", async () => {
    const { app, admin } = await setup();

    const res = await list(app, admin.cookie);

    expect(res.status).toBe(200);
    const { users: all } = (await res.json()) as { users: Listed[] };
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: admin.id,
      login: "admin99",
      isAdmin: true,
      blockedAt: null,
    });
    expect(Object.keys(all[0] ?? {}).sort()).toEqual([
      "blockedAt",
      "createdAt",
      "id",
      "isAdmin",
      "login",
    ]);
    expect(
      Math.abs(Date.parse(all[0]?.createdAt ?? "") - Date.now()),
    ).toBeLessThan(60_000);
  });

  it("given the admin, a user and a blocked user, when the list is requested, then all three come oldest first with blockedAt set for the blocked one only", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5, "Alice-Dev");
    const bob = await userWithSession(db, 6, "bob");
    expect((await block(app, admin.cookie, bob.id)).status).toBe(204);

    const all = await listed(app, admin.cookie);

    expect(all.map((u) => u.id)).toEqual([admin.id, alice.id, bob.id]);
    expect(all.map((u) => u.login)).toEqual(["admin99", "Alice-Dev", "bob"]);
    expect(all.map((u) => u.isAdmin)).toEqual([true, false, false]);
    expect(all.map((u) => u.blockedAt === null)).toEqual([true, true, false]);
    expect(
      Math.abs(Date.parse(all[2]?.blockedAt ?? "") - Date.now()),
    ).toBeLessThan(60_000);
  });
});

describe("POST /api/settings/users/:id/block", () => {
  it("given a user with two sessions and another user, when the admin blocks the first, then 204, blocked_at is set, only their sessions are deleted and one block_user entry holds the user id only", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5, "Alice-Dev");
    await db.insert(sessions).values({
      id: createHash("sha256").update("second-cookie").digest("hex"),
      userId: alice.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const bob = await userWithSession(db, 6, "bob");

    const res = await block(app, admin.cookie, alice.id);

    expect(res.status).toBe(204);
    const [row] = await db.select().from(users).where(eq(users.id, alice.id));
    expect(row?.blockedAt).toBeInstanceOf(Date);
    const left = await db.select({ userId: sessions.userId }).from(sessions);
    expect(left.map((s) => s.userId).sort()).toEqual([admin.id, bob.id].sort());
    const entries = await entriesOf(db, "block_user");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: admin.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { userId: alice.id },
    });
    // Rule D of decision 010: a GitHub login is personal data.
    expect(JSON.stringify(entries[0]).toLowerCase()).not.toContain("alice");
  });

  it("given a user who has a live session, when the admin blocks them, then their old cookie no longer opens /api/me and the admin's still does", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5);
    const before = await app.request("/api/me", {
      headers: { cookie: alice.cookie },
    });
    expect(before.status).toBe(200);

    await block(app, admin.cookie, alice.id);

    const me = await app.request("/api/me", {
      headers: { cookie: alice.cookie },
    });
    expect(me.status).toBe(401);
    const adminMe = await app.request("/api/me", {
      headers: { cookie: admin.cookie },
    });
    expect(adminMe.status).toBe(200);
  });

  it("given another administrator, when the admin blocks them, then 409 cannot_block_admin, nothing changes and a refused entry holds the reason and no login", async () => {
    const { app, db, admin } = await setup();
    const other = await createAdminWithSession(db, 98);

    const res = await block(app, admin.cookie, other.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_block_admin" });
    const all = await listed(app, admin.cookie);
    expect(all.every((u) => u.blockedAt === null)).toBe(true);
    expect(await db.select().from(sessions)).toHaveLength(2);
    const entries = await entriesOf(db, "block_user");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: admin.id,
      result: "refused",
      detail: { reason: "cannot_block_admin" },
    });
    expect(JSON.stringify(entries[0]).toLowerCase()).not.toContain("admin98");
  });

  it("given the admin, when they block themselves, then 409 cannot_block_admin and their session stays open", async () => {
    const { app, admin } = await setup();

    const res = await block(app, admin.cookie, admin.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cannot_block_admin" });
    const me = await app.request("/api/me", {
      headers: { cookie: admin.cookie },
    });
    expect(me.status).toBe(200);
  });

  it("given a user already blocked, when they are blocked again, then 409 already_blocked, blocked_at keeps its first value and the entries are ok then refused", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5);
    await block(app, admin.cookie, alice.id);
    const first = (await listed(app, admin.cookie)).find(
      (u) => u.id === alice.id,
    )?.blockedAt;
    expect(first).toBeTruthy();

    const res = await block(app, admin.cookie, alice.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_blocked" });
    const again = (await listed(app, admin.cookie)).find(
      (u) => u.id === alice.id,
    )?.blockedAt;
    expect(again).toBe(first);
    const entries = await entriesOf(db, "block_user");
    expect(entries.map((e) => e.result)).toEqual(["ok", "refused"]);
    expect(entries[1]).toMatchObject({
      userId: admin.id,
      detail: { reason: "already_blocked" },
    });
  });

  it.each([
    ["an unknown id", "999"],
    ["a non-numeric id", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
    ["an id beyond a PostgreSQL integer", "99999999999"],
    ["a decimal id", "1.5"],
  ])(
    "given %s, when it is blocked, then 404 and nobody is blocked",
    async (_name, id) => {
      const { app, db, admin } = await setup();
      await userWithSession(db, 5);

      const res = await block(app, admin.cookie, id);

      expect(res.status).toBe(404);
      const all = await listed(app, admin.cookie);
      expect(all.every((u) => u.blockedAt === null)).toBe(true);
    },
  );
});

describe("POST /api/settings/users/:id/unblock", () => {
  it("given a blocked user, when the admin unblocks them, then 204, blocked_at is null again and one unblock_user entry holds the user id only", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5, "Alice-Dev");
    await block(app, admin.cookie, alice.id);

    const res = await unblock(app, admin.cookie, alice.id);

    expect(res.status).toBe(204);
    const all = await listed(app, admin.cookie);
    expect(all.find((u) => u.id === alice.id)?.blockedAt).toBeNull();
    const entries = await entriesOf(db, "unblock_user");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: admin.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { userId: alice.id },
    });
    expect(JSON.stringify(entries[0]).toLowerCase()).not.toContain("alice");
  });

  it("given a user who is not blocked, when they are unblocked, then 409 not_blocked and a refused entry holds the reason", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5);

    const res = await unblock(app, admin.cookie, alice.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_blocked" });
    const entries = await entriesOf(db, "unblock_user");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: admin.id,
      result: "refused",
      detail: { reason: "not_blocked" },
    });
  });

  it.each([
    ["an unknown id", "999"],
    ["a non-numeric id", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
    ["an id beyond a PostgreSQL integer", "99999999999"],
    ["a decimal id", "1.5"],
  ])(
    "given %s, when it is unblocked, then 404 and a blocked user stays blocked",
    async (_name, id) => {
      const { app, db, admin } = await setup();
      const alice = await userWithSession(db, 5);
      expect((await block(app, admin.cookie, alice.id)).status).toBe(204);

      const res = await unblock(app, admin.cookie, id);

      expect(res.status).toBe(404);
      const found = (await listed(app, admin.cookie)).find(
        (u) => u.id === alice.id,
      );
      expect(found?.blockedAt).not.toBeNull();
    },
  );
});

describe("access to /api/settings/users", () => {
  const routes: [
    string,
    (
      app: App,
      cookie: string,
      victimId: number,
    ) => Response | Promise<Response>,
  ][] = [
    ["GET /api/settings/users", (app, cookie) => list(app, cookie)],
    [
      "POST /api/settings/users/:id/block",
      (app, cookie, victimId) => block(app, cookie, victimId),
    ],
    [
      "POST /api/settings/users/:id/unblock",
      (app, cookie, victimId) => unblock(app, cookie, victimId),
    ],
  ];

  it.each(routes)(
    "given a session that is not an administrator, when %s is called, then 403 and nothing changes",
    async (_route, call) => {
      const { app, db, admin } = await setup();
      const victim = await userWithSession(db, 4);
      const user = await userWithSession(db, 5);

      const res = await call(app, user.cookie, victim.id);

      expect(res.status).toBe(403);
      const all = await listed(app, admin.cookie);
      expect(all.every((u) => u.blockedAt === null)).toBe(true);
      expect(await db.select().from(sessions)).toHaveLength(3);
    },
  );

  it.each(routes)(
    "given no session, when %s is called, then 401",
    async (_route, call) => {
      const { app } = await setup();

      const res = await call(app, "", 1);

      expect(res.status).toBe(401);
    },
  );

  it.each(routes)(
    "given an instance the wizard has not configured, when %s is called, then 503 whoever asks",
    async (_route, call) => {
      const db = await openTestDatabase();
      const app = createApp(db, "1.2.3", testAppOptions);

      const res = await call(app, "", 1);

      expect(res.status).toBe(503);
    },
  );
});

describe("GET /api/me", () => {
  it("given an administrator, when /api/me is called, then isAdmin is true", async () => {
    const { app, admin } = await setup();

    const res = await app.request("/api/me", {
      headers: { cookie: admin.cookie },
    });

    expect(await res.json()).toMatchObject({ isAdmin: true });
  });

  it("given a user who is not an administrator, when /api/me is called, then isAdmin is false", async () => {
    const { app, db } = await setup();
    const user = await userWithSession(db, 5);

    const res = await app.request("/api/me", {
      headers: { cookie: user.cookie },
    });

    expect(await res.json()).toMatchObject({ isAdmin: false });
  });
});

describe("GET /api/installation", () => {
  it("given a user who installed the App, when it is requested, then installed is true with the install URL, asked of GitHub with the user's login", async () => {
    const fetchMock = stubGitHub({ account: 5 });
    const { app, db } = await setup();
    const user = await userWithSession(db, 5);

    const res = await app.request("/api/installation", {
      headers: { cookie: user.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      installed: true,
      installUrl: INSTALL_URL,
    });
    expect(githubCalls(fetchMock).map((c) => c.path)).toContain(
      "/users/user5/installation",
    );
  });

  it("given a user who has not installed the App, when it is requested, then installed is false", async () => {
    stubGitHub({ account: null });
    const { app, db } = await setup();
    const user = await userWithSession(db, 5);

    const res = await app.request("/api/installation", {
      headers: { cookie: user.cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      installed: false,
      installUrl: INSTALL_URL,
    });
  });

  it("given an installation that belongs to another account (the login changed hands), when it is requested, then installed is false", async () => {
    stubGitHub({ account: 6 });
    const { app, db } = await setup();
    const user = await userWithSession(db, 5);

    const res = await app.request("/api/installation", {
      headers: { cookie: user.cookie },
    });

    expect(await res.json()).toMatchObject({ installed: false });
  });

  it("given GitHub fails, when it is requested, then 502 github_unavailable", async () => {
    stubGitHub({ account: 5, installationStatus: 500 });
    const { app, db } = await setup();
    const user = await userWithSession(db, 5);

    const res = await app.request("/api/installation", {
      headers: { cookie: user.cookie },
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
  });

  it("given no session, when it is requested, then 401 and GitHub is not called", async () => {
    const fetchMock = stubGitHub({ account: 5 });
    const { app } = await setup();

    const res = await app.request("/api/installation");

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("given an instance the wizard has not configured, when it is requested, then 503", async () => {
    const db = await openTestDatabase();
    const app = createApp(db, "1.2.3", testAppOptions);

    const res = await app.request("/api/installation");

    expect(res.status).toBe(503);
  });
});

// -- Login ------------------------------------------------------------------

type Profile = { id: number; login: string };

/** GitHub's OAuth answers plus the installation endpoints of test-github.ts; stub before createApp. */
function stubLogin(
  profile: Profile,
  install: Parameters<typeof stubGitHub>[0],
) {
  const installation = stubGitHub(install);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw);
      const where = url.origin + url.pathname;
      if (where === TOKEN_URL) return Response.json({ access_token: "gho_x" });
      if (where === USER_URL) return Response.json(profile);
      return installation(input, init);
    }),
  );
  return installation;
}

const pairOf = (setCookie: string) => setCookie.split(";")[0] ?? "";

/** Full GitHub login of the stubbed profile; returns the callback response. */
async function logIn(app: App) {
  const start = await app.request("/api/auth/login");
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  assert(state, "login must send a state");
  const cookies = start.headers.getSetCookie().map(pairOf).join("; ");
  return app.request(
    `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookies } },
  );
}

const sessionCookieOf = (res: Response) =>
  res.headers.getSetCookie().find((c) => c.startsWith("cockpit_session="));

describe("sign-up: any GitHub account may create its Cockpit account", () => {
  it("given a GitHub account unknown to Cockpit, when it completes the login, then a non-administrator row is created, a session opens and one ok login entry holds the user id and no login", async () => {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, db, admin } = await setup();

    const res = await logIn(app);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const [alice] = await db.select().from(users).where(eq(users.githubId, 5));
    expect(alice).toMatchObject({ login: "alice", isAdmin: false });
    expect(sessionCookieOf(res)).toBeDefined();
    const opened = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, alice?.id ?? -1));
    expect(opened).toHaveLength(1);
    const logins = await entriesOf(db, "login");
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({ userId: alice?.id, result: "ok" });
    expect(JSON.stringify(logins[0]).toLowerCase()).not.toContain("alice");
    // The administrator is untouched.
    const [still] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(still?.isAdmin).toBe(true);
  });

  it("given a signed-up user, when /api/me is called with the cookie of that login, then it answers their login and isAdmin false", async () => {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app } = await setup();
    const res = await logIn(app);
    const cookie = pairOf(sessionCookieOf(res) ?? "");

    const me = await app.request("/api/me", { headers: { cookie } });

    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ login: "alice", isAdmin: false });
  });

  it("given a known non-administrator, when they log in again with a new login, then they stay a non-administrator with their login updated and no second row", async () => {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, db } = await setup();
    await db.insert(users).values({ githubId: 5, login: "alice-old" });

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    const rows = await db.select().from(users).where(eq(users.githubId, 5));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ login: "alice", isAdmin: false });
    expect(sessionCookieOf(res)).toBeDefined();
  });

  it("given an unknown account whose login is the one of an administrator in another case, when it logs in, then it signs up as a separate non-administrator and the administrator is unchanged", async () => {
    stubLogin({ id: 7, login: "ADMIN99" }, { account: 7 });
    const { app, db, admin } = await setup();

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    const [newcomer] = await db
      .select()
      .from(users)
      .where(eq(users.githubId, 7));
    expect(newcomer).toMatchObject({ isAdmin: false });
    expect(newcomer?.id).not.toBe(admin.id);
    const [still] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(still).toMatchObject({ githubId: 99, isAdmin: true });
  });
});

describe("login of a blocked user", () => {
  async function blockedAlice() {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, db, admin } = await setup();
    const [alice] = await db
      .insert(users)
      .values({ githubId: 5, login: "alice" })
      .returning({ id: users.id });
    assert(alice);
    const res = await block(app, admin.cookie, alice.id);
    expect(
      res.status,
      "blocking must work for this test to mean anything",
    ).toBe(204);
    return { app, db, admin, aliceId: alice.id };
  }

  it("given a blocked user, when they complete the GitHub login, then it redirects to /?erreur=compte-bloque with no login in the URL, no session opens and nothing else is created", async () => {
    const { app, db, admin, aliceId } = await blockedAlice();
    const sessionsBefore = await db.select().from(sessions);

    const res = await logIn(app);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?erreur=compte-bloque");
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(await db.select().from(sessions)).toEqual(sessionsBefore);
    expect((await db.select().from(users)).map((u) => u.id).sort()).toEqual(
      [admin.id, aliceId].sort(),
    );
  });

  it("given a blocked user, when they are refused, then one refused login entry holds the user id and the reason account blocked, never the login", async () => {
    const { app, db, aliceId } = await blockedAlice();

    await logIn(app);

    const logins = await entriesOf(db, "login");
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({
      userId: aliceId,
      result: "refused",
      detail: { reason: "account blocked" },
    });
    const text = JSON.stringify(logins[0]).toLowerCase();
    expect(text).not.toContain("alice");
  });

  it("given a blocked user whose login changed on GitHub, when they complete the login, then they are refused all the same (the block follows the GitHub id)", async () => {
    stubLogin({ id: 5, login: "alice-renamed" }, { account: 5 });
    const { app, db, admin } = await setup();
    const [alice] = await db
      .insert(users)
      .values({ githubId: 5, login: "alice-old" })
      .returning({ id: users.id });
    assert(alice);
    expect((await block(app, admin.cookie, alice.id)).status).toBe(204);

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/?erreur=compte-bloque");
    expect(sessionCookieOf(res)).toBeUndefined();
    const [row] = await db
      .select({ login: users.login })
      .from(users)
      .where(eq(users.id, alice.id));
    expect(row?.login).toBe("alice-old");
  });

  it("given a blocked user who is then unblocked, when they complete the GitHub login, then a session opens and they are still a non-administrator", async () => {
    const { app, db, admin, aliceId } = await blockedAlice();
    expect((await unblock(app, admin.cookie, aliceId)).status).toBe(204);

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    expect(sessionCookieOf(res)).toBeDefined();
    const [alice] = await db.select().from(users).where(eq(users.id, aliceId));
    expect(alice).toMatchObject({ isAdmin: false });
  });
});

describe("where the login callback sends the user (decision 012 H)", () => {
  it("given a user who has not installed the App, when the login succeeds, then it redirects to /bienvenue, after asking GitHub about that login", async () => {
    const installation = stubLogin(
      { id: 5, login: "alice" },
      { account: null },
    );
    const { app } = await setup();

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/bienvenue");
    expect(sessionCookieOf(res)).toBeDefined();
    expect(githubCalls(installation).map((c) => c.path)).toContain(
      "/users/alice/installation",
    );
  });

  it("given an administrator who has not installed the App, when the login succeeds, then it redirects to /bienvenue too", async () => {
    stubLogin({ id: 99, login: "admin99" }, { account: null });
    const { app } = await setup();

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/bienvenue");
  });

  it("given a user who installed the App, when the login succeeds, then it redirects to /", async () => {
    const installation = stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app } = await setup();

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    // Not vacuous: the redirect to / must come from an answered check.
    expect(githubCalls(installation).map((c) => c.path)).toContain(
      "/users/alice/installation",
    );
  });

  it("given GitHub fails when the installation is checked, when the login succeeds, then the session opens and it redirects to /", async () => {
    const installation = stubLogin(
      { id: 5, login: "alice" },
      { account: 5, installationStatus: 500 },
    );
    const { app, db } = await setup();

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    expect(sessionCookieOf(res)).toBeDefined();
    expect(await db.select().from(sessions)).toHaveLength(2);
    expect(githubCalls(installation).map((c) => c.path)).toContain(
      "/users/alice/installation",
    );
  });
});
