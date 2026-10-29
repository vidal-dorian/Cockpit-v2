import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import type { Db } from "./db/db.ts";
import { instanceSettings, sessions, users } from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import type { InstanceSettings, ReadInstance } from "./instance.ts";

const SESSION_COOKIE = "cockpit_session";
export const CLAIM_COOKIE = "cockpit_admin_claim";
const STATE_COOKIE = "cockpit_oauth_state";
const NEXT_COOKIE = "cockpit_login_next";
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

/** Errors thrown here become log lines and history reasons: fixed codes only, never GitHub's content. */
function parseAnswer<T extends z.ZodType>(schema: T, answer: unknown) {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw new Error("invalid_github_answer");
  return parsed.data as z.output<T>;
}

/** Where a login may lead back to (decision 021 C): the /autoriser page and its query, never another address or page. Printable ASCII only, so nothing can split the redirect header. */
function safeNext(value: string | undefined) {
  return value !== undefined &&
    value.length <= 2048 &&
    /^\/autoriser(\?[\x21-\x7e]*)?$/.test(value) &&
    !value.includes("\\")
    ? value
    : undefined;
}

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** The account behind the session cookie, or null; an expired session is deleted on the way. */
export async function currentUser(db: Db, c: Context) {
  const value = getCookie(c, SESSION_COOKIE);
  const [row] = value
    ? await db
        .select({
          id: sessions.id,
          expiresAt: sessions.expiresAt,
          userId: users.id,
          isAdmin: users.isAdmin,
          githubId: users.githubId,
          login: users.login,
          name: users.name,
          avatarUrl: users.avatarUrl,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, sha256(value)))
    : [];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.id));
    return null;
  }
  return row;
}

/** The wizard's claim: valid once, and only while nobody is administrator yet. The update decides, so two parallel logins cannot both win. */
async function spendAdminClaim(tx: Tx, claim: string) {
  const [admin] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isAdmin, true))
    .limit(1);
  if (admin) return false;
  const spent = await tx
    .update(instanceSettings)
    .set({ adminClaimHash: null })
    .where(
      and(
        eq(instanceSettings.id, 1),
        eq(instanceSettings.adminClaimHash, sha256(claim)),
      ),
    )
    .returning({ id: instanceSettings.id });
  return spent.length > 0;
}

export function authRoutes(
  db: Db,
  readInstance: ReadInstance,
  readGitHub: ReadGitHub,
) {
  /** Where a fresh login lands (decision 012 H); a failing check never blocks the login. */
  async function landingPage(login: string, githubId: number) {
    try {
      const ready = await readGitHub();
      const installation = await ready?.github.findUserInstallation(
        login,
        githubId,
      );
      return installation === null ? "/bienvenue" : "/";
    } catch (error) {
      console.error(
        "Installation check failed:",
        error instanceof Error ? error.message : error,
      );
      return "/";
    }
  }

  /** Asks GitHub who the code belongs to; the token is used here and forgotten. */
  async function fetchGitHubUser(config: InstanceSettings, code: string) {
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
    if (!tokenRes.ok) throw new Error(`token_http_${tokenRes.status}`);
    const token = parseAnswer(tokenAnswer, await tokenRes.json());

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token.access_token}`,
        "user-agent": "cockpit",
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!userRes.ok) throw new Error(`user_http_${userRes.status}`);
    return parseAnswer(githubUser, await userRes.json());
  }

  return new Hono()
    .get("/api/auth/login", async (c) => {
      const config = await readInstance();
      // Nothing to log in to before the wizard has created the GitHub App.
      if (!config) return c.redirect("/installation");
      const secure = config.publicUrl.startsWith("https:");
      const state = randomBytes(32).toString("hex");
      setCookie(c, STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "Lax",
        secure,
        path: "/api/auth",
        maxAge: STATE_SECONDS,
      });
      // Carried through the login in a cookie like the state: the callback checks it again, since a cookie can be set from elsewhere.
      const next = safeNext(c.req.query("next"));
      if (next)
        setCookie(c, NEXT_COOKIE, next, {
          httpOnly: true,
          sameSite: "Lax",
          secure,
          path: "/api/auth",
          maxAge: STATE_SECONDS,
        });
      else deleteCookie(c, NEXT_COOKIE, { path: "/api/auth" });
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.search = new URLSearchParams({
        client_id: config.githubClientId,
        redirect_uri: `${config.publicUrl}/api/auth/callback`,
        state,
      }).toString();
      return c.redirect(authorize.href);
    })
    .get("/api/auth/callback", async (c) => {
      const config = await readInstance();
      if (!config) return c.redirect("/installation");
      const secure = config.publicUrl.startsWith("https:");
      const expectedState = getCookie(c, STATE_COOKIE);
      // The state is single-use: whatever happens next, it is gone.
      deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
      const next = safeNext(getCookie(c, NEXT_COOKIE));
      deleteCookie(c, NEXT_COOKIE, { path: "/api/auth" });
      const { code, state, error } = c.req.query();
      // Not a login started from Cockpit: no history row, so strangers cannot grow the table.
      if (!expectedState || state !== expectedState) {
        console.error("GitHub login failed: state_mismatch");
        return c.redirect(FAILED);
      }
      // Nothing identifying in the entry: an account that is refused has no users row to anonymize (decision 010 E).
      const entry: Entry = {
        userId: null,
        actor: "human",
        origin: "ui",
        action: "login",
        args: {},
      };
      let profile: Awaited<ReturnType<typeof fetchGitHubUser>>;
      try {
        if (error) {
          // The value is the visitor's to write: log only, never the history.
          console.error("GitHub answered error=", JSON.stringify(error));
          throw new Error("github_error");
        }
        if (!code) throw new Error("no_code");
        profile = await fetchGitHubUser(config, code);
      } catch (failure) {
        console.error(
          "GitHub login failed:",
          failure instanceof Error ? failure.message : failure,
        );
        // act records the failure as an error entry, then rethrows it.
        await act(db, entry, () => Promise.reject(failure)).catch((error) => {
          // act rethrows `failure` (already logged); anything else means the entry itself was not written.
          if (error !== failure) console.error("History write failed:", error);
        });
        return c.redirect(FAILED);
      }

      try {
        const value = randomBytes(32).toString("hex");
        const claim = getCookie(c, CLAIM_COOKIE);
        let claimed = false;
        await act(db, entry, async (tx) => {
          // Open sign-up (decision 012 G): anyone gets in unless blocked. Looked up by GitHub id, so a renamed login stays blocked.
          // FOR UPDATE: a concurrent block waits for this login, then deletes the session it opened.
          const [known] = await tx
            .select({
              id: users.id,
              isAdmin: users.isAdmin,
              blockedAt: users.blockedAt,
            })
            .from(users)
            .where(eq(users.githubId, profile.id))
            .for("update");
          if (known?.blockedAt) {
            entry.userId = known.id;
            throw new Refused("account blocked");
          }
          if (!known?.isAdmin && claim)
            claimed = await spendAdminClaim(tx, claim);
          const values = {
            githubId: profile.id,
            login: profile.login,
            name: profile.name ?? null,
            avatarUrl: profile.avatar_url ?? null,
            // Never promoted by a login: only the claim makes an administrator.
            isAdmin: known?.isAdmin === true || claimed,
          };
          const [user] = await tx
            .insert(users)
            .values(values)
            .onConflictDoUpdate({ target: users.githubId, set: values })
            .returning({ id: users.id, blockedAt: users.blockedAt });
          if (!user) throw new Error("user upsert returned no row");
          // A new account has no row to lock above: a block landing between that read and this upsert is caught here.
          if (user.blockedAt) {
            entry.userId = user.id;
            throw new Refused("account blocked");
          }
          await tx.insert(sessions).values({
            id: sha256(value),
            userId: user.id,
            expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
          });
          // The user is only known here; act reads the entry once the work is done.
          entry.userId = user.id;
        });
        if (claimed) deleteCookie(c, CLAIM_COOKIE, { path: "/api/auth" });
        setCookie(c, SESSION_COOKIE, value, {
          httpOnly: true,
          sameSite: "Lax",
          secure,
          path: "/",
          maxAge: SESSION_SECONDS,
        });
        return c.redirect(
          next ?? (await landingPage(profile.login, profile.id)),
        );
      } catch (error) {
        // The only refusal is a blocked account; no login in the URL, nothing to echo.
        if (error instanceof Refused)
          return c.redirect("/?erreur=compte-bloque");
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
        // An unknown or expired session ends nothing, so it leaves no entry.
        const user = await currentUser(db, c);
        if (user) {
          try {
            await act(
              db,
              {
                userId: user.userId,
                actor: "human",
                origin: "ui",
                action: "logout",
                args: {},
              },
              async (tx) => {
                const ended = await tx
                  .delete(sessions)
                  .where(eq(sessions.id, user.id))
                  .returning({ id: sessions.id });
                // A parallel logout got there first: it already logged.
                if (ended.length === 0) throw new Refused("no_session");
              },
            );
          } catch (error) {
            if (!(error instanceof Refused)) throw error;
          }
        }
        deleteCookie(c, SESSION_COOKIE, { path: "/" });
      }
      return c.json({ ok: true });
    })
    .get("/api/me", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const { login, name, avatarUrl, isAdmin } = user;
      return c.json({ login, name, avatarUrl, isAdmin });
    });
}
