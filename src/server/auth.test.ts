import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";

type App = ReturnType<typeof createApp>;

const baseConfig = {
  githubClientId: "Iv1.client",
  githubClientSecret: "secret",
  publicUrl: "https://cockpit.example.com",
  allowedLogins: ["octocat"],
};
const octocat = {
  id: 1,
  login: "octocat",
  name: "The Octocat",
  avatar_url: "https://avatars/1",
};
const TOKEN = "gho_token";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

async function setup(config: Partial<typeof baseConfig> = {}) {
  const db = await openTestDatabase();
  const app = createApp(db, "1.2.3", { ...baseConfig, ...config });
  return { db, app };
}

/** Stubs the global fetch the server uses to talk to GitHub; any other URL fails loudly. */
function stubGitHub(
  options: {
    user?: object;
    tokenStatus?: number;
    tokenBody?: object;
    userStatus?: number;
  } = {},
) {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw);
      const where = url.origin + url.pathname;
      if (where === TOKEN_URL) {
        return Response.json(options.tokenBody ?? { access_token: TOKEN }, {
          status: options.tokenStatus ?? 200,
        });
      }
      if (where === USER_URL) {
        return Response.json(options.user ?? octocat, {
          status: options.userStatus ?? 200,
        });
      }
      throw new Error(`Unexpected fetch ${raw} ${init?.method ?? ""}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The "name=value" part of a Set-Cookie header. */
function pairOf(setCookie: string) {
  return setCookie.split(";")[0] ?? "";
}

function cookieValue(setCookie: string) {
  const pair = pairOf(setCookie);
  return pair.slice(pair.indexOf("=") + 1);
}

/** What a browser sends back: every cookie the response set and did not clear. */
function cookieHeader(res: Response) {
  return res.headers
    .getSetCookie()
    .filter((c) => cookieValue(c) !== "")
    .map(pairOf)
    .join("; ");
}

function sessionSetCookie(res: Response) {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith("cockpit_session="));
}

async function beginLogin(app: App) {
  const res = await app.request("/api/auth/login");
  const location = res.headers.get("location");
  assert(location, "login must redirect");
  const state = new URL(location).searchParams.get("state");
  assert(state, "login must send a state");
  return { state, cookies: cookieHeader(res) };
}

function callback(app: App, query: string, cookies: string) {
  return app.request(`/api/auth/callback?${query}`, {
    headers: cookies ? { cookie: cookies } : {},
  });
}

/** Full login with the GitHub stub already in place; returns the callback response. */
async function logIn(app: App) {
  const { state, cookies } = await beginLogin(app);
  return callback(
    app,
    `code=gh-code&state=${encodeURIComponent(state)}`,
    cookies,
  );
}

/** Logs in and returns the Cookie header of the new session, with the raw cookie value. */
async function loggedInCookie(app: App) {
  stubGitHub();
  const res = await logIn(app);
  const setCookie = sessionSetCookie(res);
  assert(setCookie, "the callback must set cockpit_session");
  return { cookie: pairOf(setCookie), value: cookieValue(setCookie) };
}

describe("GET /api/auth/login", () => {
  it("given no session, when the user asks to log in, then it redirects to GitHub with the client id, the redirect_uri and a state kept in an HttpOnly cookie", async () => {
    const { app } = await setup();

    const res = await app.request("/api/auth/login");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(AUTHORIZE_URL);
    expect(location.searchParams.get("client_id")).toBe("Iv1.client");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://cockpit.example.com/api/auth/callback",
    );
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    const stateCookie = res.headers
      .getSetCookie()
      .find((c) => cookieValue(c) === state);
    assert(stateCookie, "a cookie must carry the state");
    expect(stateCookie).toMatch(/;\s*HttpOnly/i);
  });
});

describe("GET /api/auth/callback, state check", () => {
  it.each([
    ["the state differs from the cookie", "wrong-state", true],
    ["there is no state cookie at all", "any-state", false],
    ["the callback has no state", "", true],
  ])(
    "given a callback where %s, when it is called, then it redirects to connexion-echouee, never calls GitHub and opens no session",
    async (_name, queryState, withCookie) => {
      const { app, db } = await setup();
      const fetchMock = stubGitHub();
      const { cookies } = await beginLogin(app);
      const query = queryState
        ? `code=gh-code&state=${queryState}`
        : "code=gh-code";

      const res = await callback(app, query, withCookie ? cookies : "");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?erreur=connexion-echouee");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.select().from(sessions)).toHaveLength(0);
      expect(await db.select().from(users)).toHaveLength(0);
    },
  );
});

describe("GET /api/auth/callback, successful login", () => {
  it("given a matching state and an allowed GitHub account, when the callback is called, then the user and a hashed session are stored and the cookie is hardened", async () => {
    const { app, db } = await setup();
    const fetchMock = stubGitHub();

    const res = await logIn(app);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((u) => u.startsWith(TOKEN_URL))).toBe(true);
    expect(urls.some((u) => u.startsWith(USER_URL))).toBe(true);
    const userCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith(USER_URL),
    );
    expect(new Headers(userCall?.[1]?.headers).get("authorization")).toContain(
      TOKEN,
    );

    const [user, ...otherUsers] = await db.select().from(users);
    assert(user);
    expect(otherUsers).toHaveLength(0);
    expect(user).toMatchObject({
      githubId: 1,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars/1",
    });

    const setCookie = sessionSetCookie(res);
    assert(setCookie, "the callback must set cockpit_session");
    const value = cookieValue(setCookie);
    expect(value.length).toBeGreaterThanOrEqual(32);
    const [session, ...otherSessions] = await db.select().from(sessions);
    assert(session);
    expect(otherSessions).toHaveLength(0);
    expect(session.id).toBe(createHash("sha256").update(value).digest("hex"));
    expect(session.id).not.toBe(value);
    expect(session.userId).toBe(user.id);
    const lifetime = session.expiresAt.getTime() - Date.now();
    expect(Math.abs(lifetime - THIRTY_DAYS * 1000)).toBeLessThan(60_000);

    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*Path=\/(;|$)/i);
    expect(setCookie).toMatch(
      new RegExp(`;\\s*Max-Age=${THIRTY_DAYS}(;|$)`, "i"),
    );
  });

  it("given a PUBLIC_URL in http, when the user logs in, then the session cookie is not Secure", async () => {
    const { app } = await setup({ publicUrl: "http://127.0.0.1:3000" });
    stubGitHub();

    const res = await logIn(app);

    const setCookie = sessionSetCookie(res);
    assert(setCookie, "the callback must set cockpit_session");
    expect(setCookie).not.toMatch(/;\s*Secure/i);
  });

  it("given a returning user whose login and name changed on GitHub, when they log in again, then there is still one users row, updated", async () => {
    const { app, db } = await setup();
    const [existing] = await db
      .insert(users)
      .values({ githubId: 1, login: "old-login", name: "Old", avatarUrl: "x" })
      .returning();
    assert(existing);
    stubGitHub({
      user: { ...octocat, login: "octocat", name: "New Name", avatar_url: "y" },
    });

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: existing.id,
      githubId: 1,
      login: "octocat",
      name: "New Name",
      avatarUrl: "y",
    });
    const [session] = await db.select().from(sessions);
    expect(session?.userId).toBe(existing.id);
  });
});

describe("allow-list", () => {
  it("given a GitHub account that is not in the allow-list, when the callback is called, then it redirects to compte-non-autorise with the login and creates nothing", async () => {
    const { app, db } = await setup({ allowedLogins: ["someone-else"] });
    stubGitHub();

    const res = await logIn(app);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/?erreur=compte-non-autorise&login=octocat",
    );
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(sessionSetCookie(res)).toBeUndefined();
  });

  it("given an allow-list written OctoCat, when octocat logs in, then they get in (case-insensitive)", async () => {
    const { app, db } = await setup({ allowedLogins: ["OctoCat"] });
    stubGitHub();

    const res = await logIn(app);

    expect(res.headers.get("location")).toBe("/");
    expect(await db.select().from(sessions)).toHaveLength(1);
  });
});

describe("GitHub failures", () => {
  it("given GitHub answers error=access_denied on the callback, when it is called, then it redirects to connexion-echouee and opens no session", async () => {
    const { app, db } = await setup();
    stubGitHub();
    const { state, cookies } = await beginLogin(app);

    const res = await callback(
      app,
      `error=access_denied&state=${encodeURIComponent(state)}`,
      cookies,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?erreur=connexion-echouee");
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it.each([
    [
      "answers an error in a 200",
      { tokenBody: { error: "bad_verification_code" } },
    ],
    ["answers a non-OK status", { tokenStatus: 500, tokenBody: {} }],
    ["is fine but the user fetch fails", { userStatus: 401, user: {} }],
  ])(
    "given the GitHub exchange %s, when the callback is called, then it redirects to connexion-echouee and opens no session",
    async (_name, stub) => {
      const { app, db } = await setup();
      stubGitHub(stub);

      const res = await logIn(app);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/?erreur=connexion-echouee");
      expect(await db.select().from(sessions)).toHaveLength(0);
      expect(await db.select().from(users)).toHaveLength(0);
    },
  );
});

describe("GET /api/me", () => {
  it("given a logged-in user, when /api/me is called with the session cookie, then it answers the account", async () => {
    const { app } = await setup();
    const { cookie } = await loggedInCookie(app);

    const res = await app.request("/api/me", { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars/1",
    });
  });

  it("given no cookie, when /api/me is called, then it answers 401 with an error", async () => {
    const { app } = await setup();

    const res = await app.request("/api/me");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: unknown };
    expect(typeof body.error).toBe("string");
  });

  it("given an unknown session cookie, when /api/me is called, then it answers 401", async () => {
    const { app } = await setup();

    const res = await app.request("/api/me", {
      headers: { cookie: "cockpit_session=not-a-session" },
    });

    expect(res.status).toBe(401);
  });

  it("given a session whose expiry is in the past, when /api/me is called, then it answers 401 and deletes the session", async () => {
    const { app, db } = await setup();
    const [user] = await db
      .insert(users)
      .values({ githubId: 1, login: "octocat" })
      .returning();
    assert(user);
    const value = "expired-cookie-value";
    await db.insert(sessions).values({
      id: createHash("sha256").update(value).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await app.request("/api/me", {
      headers: { cookie: `cockpit_session=${value}` },
    });

    expect(res.status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe("POST /api/auth/logout", () => {
  it("given a logged-in user, when they log out, then the session is deleted, the cookie is cleared and the old cookie no longer works", async () => {
    const { app, db } = await setup();
    const { cookie } = await loggedInCookie(app);
    expect(await db.select().from(sessions)).toHaveLength(1);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    });

    expect(res.ok).toBe(true);
    expect(await db.select().from(sessions)).toHaveLength(0);
    const cleared = sessionSetCookie(res);
    assert(cleared, "logout must clear cockpit_session");
    const expires = /;\s*Expires=([^;]+)/i.exec(cleared)?.[1];
    expect(
      /;\s*Max-Age=0(;|$)/i.test(cleared) ||
        (expires !== undefined && new Date(expires).getTime() < Date.now()),
    ).toBe(true);

    const me = await app.request("/api/me", { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  it("given no session cookie, when a cross-site POST /api/auth/logout arrives, then it answers OK and does not clear the cockpit_session cookie", async () => {
    const { app } = await setup();

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(res.ok).toBe(true);
    expect(sessionSetCookie(res)).toBeUndefined();
  });
});
