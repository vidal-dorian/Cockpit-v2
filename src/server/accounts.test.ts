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

// Slice 1.6 (decision 012 G and H): allowed accounts, login of allowed accounts, installation check.

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

const asJson = (cookie: string) => ({
  cookie,
  "content-type": "application/json",
});

const allow = (app: App, cookie: string, body: unknown) =>
  app.request("/api/settings/accounts", {
    method: "POST",
    headers: asJson(cookie),
    body: JSON.stringify(body),
  });

const list = (app: App, cookie: string) =>
  app.request("/api/settings/accounts", { headers: { cookie } });

const revoke = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/settings/accounts/${id}`, {
    method: "DELETE",
    headers: { cookie },
  });

type Account = { id: number; login: string; createdAt: string };

/** Allows a login and returns the stored account. */
async function allowed(app: App, cookie: string, login: string) {
  const res = await allow(app, cookie, { login });
  expect(res.status).toBe(201);
  return ((await res.json()) as { account: Account }).account;
}

const entriesOf = (db: TestDb, action: string) =>
  db
    .select()
    .from(history)
    .where(eq(history.action, action))
    .orderBy(history.id);

describe("GET /api/settings/accounts", () => {
  it("given an admin and no allowed account, when the list is requested, then it is empty: the admin is not in it", async () => {
    const { app, admin } = await setup();

    const res = await list(app, admin.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it("given two allowed accounts, when the list is requested, then it answers them oldest first as { id, login, createdAt }", async () => {
    const { app, admin } = await setup();
    const first = await allowed(app, admin.cookie, "Alice-Dev");
    const second = await allowed(app, admin.cookie, "bob");

    const res = await list(app, admin.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [first, second] });
    expect(first.id).toBeLessThan(second.id);
    expect(Object.keys(first).sort()).toEqual(["createdAt", "id", "login"]);
    expect(Math.abs(Date.parse(first.createdAt) - Date.now())).toBeLessThan(
      60_000,
    );
  });
});

describe("POST /api/settings/accounts", () => {
  it("given an admin, when Alice-Dev is allowed, then 201 with the account, the login is stored as given and one allow_account entry holds the account id only", async () => {
    const { app, db, admin } = await setup();

    const res = await allow(app, admin.cookie, { login: "Alice-Dev" });

    expect(res.status).toBe(201);
    const { account } = (await res.json()) as { account: Account };
    expect(account).toMatchObject({ login: "Alice-Dev" });
    expect(typeof account.id).toBe("number");
    const entries = await entriesOf(db, "allow_account");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: admin.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { accountId: account.id },
    });
    // Rule D of decision 010: a GitHub login is personal data.
    expect(JSON.stringify(entries[0]).toLowerCase()).not.toContain("alice");
  });

  it("given a login of 39 characters with inner hyphens and digits, when it is allowed, then 201", async () => {
    const { app, admin } = await setup();

    const res = await allow(app, admin.cookie, {
      login: `a-1${"b".repeat(35)}z`,
    });

    expect(res.status).toBe(201);
  });

  it.each([
    ["empty", ""],
    ["40 characters", "a".repeat(40)],
    ["a leading hyphen", "-alice"],
    ["a trailing hyphen", "alice-"],
    ["a double hyphen", "al--ice"],
    ["a space", "al ice"],
    ["an underscore", "alice_dev"],
    ["a dot", "alice.dev"],
    ["an accent", "alicé"],
    ["a slash", "alice/dev"],
    ["surrounding spaces", " alice "],
  ])(
    "given a login with %s, when it is allowed, then 400, nothing is stored and no history entry is written (zod before act)",
    async (_name, login) => {
      const { app, db, admin } = await setup();

      const res = await allow(app, admin.cookie, { login });

      expect(res.status).toBe(400);
      expect(await (await list(app, admin.cookie)).json()).toEqual({
        accounts: [],
      });
      expect(await entriesOf(db, "allow_account")).toHaveLength(0);
    },
  );

  it.each([
    ["no login", {}],
    ["a login that is not a string", { login: 42 }],
  ])("given a body with %s, when it is posted, then 400", async (_n, body) => {
    const { app, admin } = await setup();

    const res = await allow(app, admin.cookie, body);

    expect(res.status).toBe(400);
  });

  it.each([
    ["the same login", "alice-dev"],
    ["the same login in another case", "ALICE-DEV"],
    ["the login of an administrator (any case)", "Admin99"],
  ])(
    "given alice-dev is already allowed, when %s is allowed again, then 409 already_allowed, nothing new is stored and a refused entry holds no login",
    async (_name, login) => {
      const { app, db, admin } = await setup();
      const existing = await allowed(app, admin.cookie, "alice-dev");

      const res = await allow(app, admin.cookie, { login });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "already_allowed" });
      expect(await (await list(app, admin.cookie)).json()).toEqual({
        accounts: [existing],
      });
      const entries = await entriesOf(db, "allow_account");
      expect(entries.map((e) => e.result)).toEqual(["ok", "refused"]);
      expect(entries[1]).toMatchObject({
        userId: admin.id,
        detail: { reason: "already_allowed" },
      });
      const text = JSON.stringify(entries[1]).toLowerCase();
      expect(text).not.toContain("alice");
      expect(text).not.toContain("admin99");
    },
  );
});

describe("DELETE /api/settings/accounts/:id", () => {
  it("given an allowed account, when the admin removes it, then 204, it is gone from the list and one revoke_account entry holds the account id only", async () => {
    const { app, db, admin } = await setup();
    const alice = await allowed(app, admin.cookie, "Alice-Dev");
    const bob = await allowed(app, admin.cookie, "bob");

    const res = await revoke(app, admin.cookie, alice.id);

    expect(res.status).toBe(204);
    expect(await (await list(app, admin.cookie)).json()).toEqual({
      accounts: [bob],
    });
    const entries = await entriesOf(db, "revoke_account");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: admin.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { accountId: alice.id },
    });
    expect(JSON.stringify(entries[0]).toLowerCase()).not.toContain("alice");
  });

  it("given a user logged in as alice-dev (stored as Alice-Dev) with two sessions, when the account is removed, then both sessions are deleted and nobody else's", async () => {
    const { app, db, admin } = await setup();
    const alice = await allowed(app, admin.cookie, "alice-dev");
    const aliceUser = await userWithSession(db, 7, "Alice-Dev");
    await db.insert(sessions).values({
      id: createHash("sha256").update("second-cookie").digest("hex"),
      userId: aliceUser.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const bobUser = await userWithSession(db, 8, "bob");

    const res = await revoke(app, admin.cookie, alice.id);

    expect(res.status).toBe(204);
    const left = await db.select({ userId: sessions.userId }).from(sessions);
    expect(left.map((s) => s.userId).sort()).toEqual(
      [admin.id, bobUser.id].sort(),
    );
    const me = await app.request("/api/me", {
      headers: { cookie: aliceUser.cookie },
    });
    expect(me.status).toBe(401);
  });

  it.each([
    ["an unknown id", "999"],
    ["a non-numeric id", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
    ["an id beyond a PostgreSQL integer", "99999999999"],
    ["a decimal id", "1.5"],
  ])("given %s, when it is removed, then 404", async (_name, id) => {
    const { app, admin } = await setup();
    const alice = await allowed(app, admin.cookie, "alice-dev");

    const res = await revoke(app, admin.cookie, id);

    expect(res.status).toBe(404);
    expect(await (await list(app, admin.cookie)).json()).toEqual({
      accounts: [alice],
    });
  });

  it("given an account already removed, when it is removed again, then 404", async () => {
    const { app, admin } = await setup();
    const alice = await allowed(app, admin.cookie, "alice-dev");
    await revoke(app, admin.cookie, alice.id);

    const res = await revoke(app, admin.cookie, alice.id);

    expect(res.status).toBe(404);
  });
});

describe("access to /api/settings/accounts", () => {
  const routes: [
    string,
    (app: App, cookie: string) => Response | Promise<Response>,
  ][] = [
    ["GET", (app, cookie) => list(app, cookie)],
    ["POST", (app, cookie) => allow(app, cookie, { login: "carol" })],
    ["DELETE", (app, cookie) => revoke(app, cookie, 1)],
  ];

  it.each(routes)(
    "given a session that is not an administrator, when %s is called, then 403 and nothing changes",
    async (_method, call) => {
      const { app, db, admin } = await setup();
      const alice = await allowed(app, admin.cookie, "alice-dev");
      const user = await userWithSession(db, 5);

      const res = await call(app, user.cookie);

      expect(res.status).toBe(403);
      expect(await (await list(app, admin.cookie)).json()).toEqual({
        accounts: [alice],
      });
    },
  );

  it.each(routes)(
    "given no session, when %s is called, then 401",
    async (_method, call) => {
      const { app } = await setup();

      const res = await call(app, "");

      expect(res.status).toBe(401);
    },
  );

  it.each(routes)(
    "given an instance the wizard has not configured, when %s is called, then 503 whoever asks",
    async (_method, call) => {
      const db = await openTestDatabase();
      const app = createApp(db, "1.2.3", testAppOptions);

      const res = await call(app, "");

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

  it("given an allowed account that is not an administrator, when /api/me is called, then isAdmin is false", async () => {
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

describe("login of allowed accounts", () => {
  it("given alice is allowed (as Alice), when alice completes the GitHub login, then a non-administrator row is created and a session opens", async () => {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, db, admin } = await setup();
    await allowed(app, admin.cookie, "Alice");

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
  });

  it("given a known non-administrator whose account is allowed, when they log in again, then they stay a non-administrator", async () => {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, db, admin } = await setup();
    await allowed(app, admin.cookie, "alice");
    await db.insert(users).values({ githubId: 5, login: "alice-old" });

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    const [alice] = await db.select().from(users).where(eq(users.githubId, 5));
    expect(alice).toMatchObject({ login: "alice", isAdmin: false });
  });

  it("given bob is neither allowed nor administrator, when bob completes the GitHub login, then he is refused as before: nothing is created", async () => {
    stubLogin({ id: 6, login: "bob" }, { account: 6 });
    const { app, db, admin } = await setup();
    await allowed(app, admin.cookie, "alice");

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe(
      "/?erreur=compte-non-autorise&login=bob",
    );
    expect(sessionCookieOf(res)).toBeUndefined();
    expect((await db.select().from(users)).map((u) => u.id)).toEqual([
      admin.id,
    ]);
    expect(await db.select().from(sessions)).toHaveLength(1);
    const logins = await entriesOf(db, "login");
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({
      userId: null,
      result: "refused",
      detail: { reason: "account not allowed" },
    });
  });

  it("given alice was allowed then removed, when alice completes the GitHub login, then she is refused", async () => {
    stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, db, admin } = await setup();
    const alice = await allowed(app, admin.cookie, "alice");
    await revoke(app, admin.cookie, alice.id);

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe(
      "/?erreur=compte-non-autorise&login=alice",
    );
    expect(sessionCookieOf(res)).toBeUndefined();
    expect(await db.select().from(users).where(eq(users.githubId, 5))).toEqual(
      [],
    );
  });
});

describe("where the login callback sends the user (decision 012 H)", () => {
  it("given an allowed account that has not installed the App, when the login succeeds, then it redirects to /bienvenue, after asking GitHub about that login", async () => {
    const installation = stubLogin(
      { id: 5, login: "alice" },
      { account: null },
    );
    const { app, admin } = await setup();
    await allowed(app, admin.cookie, "alice");

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

  it("given an allowed account that installed the App, when the login succeeds, then it redirects to /", async () => {
    const installation = stubLogin({ id: 5, login: "alice" }, { account: 5 });
    const { app, admin } = await setup();
    await allowed(app, admin.cookie, "alice");

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
    const { app, db, admin } = await setup();
    await allowed(app, admin.cookie, "alice");

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    expect(sessionCookieOf(res)).toBeDefined();
    expect(await db.select().from(sessions)).toHaveLength(2);
    expect(githubCalls(installation).map((c) => c.path)).toContain(
      "/users/alice/installation",
    );
  });
});
