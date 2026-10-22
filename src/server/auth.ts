import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Db } from "./db/db.ts";
import { sessions, users } from "./db/schema.ts";

export type AuthConfig = {
  githubClientId: string;
  githubClientSecret: string;
  publicUrl: string;
  allowedLogins: string[];
};

const SESSION_COOKIE = "cockpit_session";
const STATE_COOKIE = "cockpit_oauth_state";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const STATE_SECONDS = 10 * 60;
// Shorter than Cloudflare's ~100 s limit, so a slow GitHub ends on our error page, not a 524.
const GITHUB_TIMEOUT_MS = 10_000;
const FAILED = "/?erreur=connexion-echouee";

// What we read of GitHub's answers; anything else is ignored.
const tokenAnswer = z.object({ access_token: z.string().min(1) });
const githubUser = z.object({
  id: z.number().int(),
  login: z.string().min(1),
  name: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function authRoutes(db: Db, config: AuthConfig) {
  const secure = config.publicUrl.startsWith("https:");
  const allowed = config.allowedLogins.map((login) => login.toLowerCase());

  /** Asks GitHub who the code belongs to; the token is used here and forgotten. */
  async function fetchGitHubUser(code: string) {
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
        body: JSON.stringify({
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          code,
          redirect_uri: `${config.publicUrl}/api/auth/callback`,
        }),
      },
    );
    if (!tokenRes.ok)
      throw new Error(`token exchange: HTTP ${tokenRes.status}`);
    const token = tokenAnswer.parse(await tokenRes.json());

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token.access_token}`,
        "user-agent": "cockpit",
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!userRes.ok) throw new Error(`user fetch: HTTP ${userRes.status}`);
    return githubUser.parse(await userRes.json());
  }

  return new Hono()
    .get("/api/auth/login", (c) => {
      const state = randomBytes(32).toString("hex");
      setCookie(c, STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "Lax",
        secure,
        path: "/api/auth",
        maxAge: STATE_SECONDS,
      });
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.search = new URLSearchParams({
        client_id: config.githubClientId,
        redirect_uri: `${config.publicUrl}/api/auth/callback`,
        state,
      }).toString();
      return c.redirect(authorize.href);
    })
    .get("/api/auth/callback", async (c) => {
      const expectedState = getCookie(c, STATE_COOKIE);
      // The state is single-use: whatever happens next, it is gone.
      deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
      try {
        const { code, state, error } = c.req.query();
        if (error)
          throw new Error(`GitHub answered error=${JSON.stringify(error)}`);
        if (!expectedState || state !== expectedState)
          throw new Error("state does not match the cookie");
        if (!code) throw new Error("no code in the callback");

        const profile = await fetchGitHubUser(code);
        if (!allowed.includes(profile.login.toLowerCase())) {
          const query = new URLSearchParams({
            erreur: "compte-non-autorise",
            login: profile.login,
          });
          return c.redirect(`/?${query}`);
        }

        const values = {
          githubId: profile.id,
          login: profile.login,
          name: profile.name ?? null,
          avatarUrl: profile.avatar_url ?? null,
        };
        const [user] = await db
          .insert(users)
          .values(values)
          .onConflictDoUpdate({ target: users.githubId, set: values })
          .returning({ id: users.id });
        if (!user) throw new Error("user upsert returned no row");

        const value = randomBytes(32).toString("hex");
        await db.insert(sessions).values({
          id: sha256(value),
          userId: user.id,
          expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
        });
        setCookie(c, SESSION_COOKIE, value, {
          httpOnly: true,
          sameSite: "Lax",
          secure,
          path: "/",
          maxAge: SESSION_SECONDS,
        });
        return c.redirect("/");
      } catch (error) {
        console.error(
          "GitHub login failed:",
          error instanceof Error ? error.message : error,
        );
        return c.redirect(FAILED);
      }
    })
    .post("/api/auth/logout", async (c) => {
      const value = getCookie(c, SESSION_COOKIE);
      // No cookie sent: nothing to end, and a cross-site POST must not clear the victim's cookie.
      if (value) {
        await db.delete(sessions).where(eq(sessions.id, sha256(value)));
        deleteCookie(c, SESSION_COOKIE, { path: "/" });
      }
      return c.json({ ok: true });
    })
    .get("/api/me", async (c) => {
      const value = getCookie(c, SESSION_COOKIE);
      const [row] = value
        ? await db
            .select({
              id: sessions.id,
              expiresAt: sessions.expiresAt,
              login: users.login,
              name: users.name,
              avatarUrl: users.avatarUrl,
            })
            .from(sessions)
            .innerJoin(users, eq(users.id, sessions.userId))
            .where(eq(sessions.id, sha256(value)))
        : [];
      if (!row) return c.json({ error: "Unauthorized" }, 401);
      if (row.expiresAt.getTime() <= Date.now()) {
        await db.delete(sessions).where(eq(sessions.id, row.id));
        return c.json({ error: "Unauthorized" }, 401);
      }
      const { login, name, avatarUrl } = row;
      return c.json({ login, name, avatarUrl });
    });
}
