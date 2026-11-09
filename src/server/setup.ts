import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { CLAIM_COOKIE, sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { instanceSettings, users } from "./db/schema.ts";
import type { ReadInstance } from "./instance.ts";
import { encrypt } from "./secrets.ts";

const SETUP_COOKIE = "cockpit_setup";
// GitHub only accepts the manifest conversion within the hour.
const SETUP_SECONDS = 60 * 60;
// Shorter than Cloudflare's ~100 s limit, so a slow GitHub ends on our error page, not a 524 (as in auth.ts).
const GITHUB_TIMEOUT_MS = 10_000;
// GitHub refuses App names longer than 34 characters.
const NAME_MAX = 34;
const FAILED = "/installation?erreur=setup-echoue";

const codeBody = z.object({ code: z.string() });
// What we read of GitHub's answer; anything else is ignored.
const conversion = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1),
  pem: z.string().min(1),
});

/** The whole MVP at once, so nothing has to be changed by hand on GitHub later (decision 012 D). */
function manifest(publicUrl: string) {
  return {
    name: `Cockpit ${new URL(publicUrl).host}`.slice(0, NAME_MAX),
    url: publicUrl,
    hook_attributes: { url: `${publicUrl}/api/webhooks/github`, active: true },
    redirect_url: `${publicUrl}/api/setup/callback`,
    callback_urls: [`${publicUrl}/api/auth/callback`],
    setup_url: `${publicUrl}/projets`,
    setup_on_update: true,
    public: true,
    default_permissions: {
      metadata: "read",
      contents: "write",
      issues: "write",
      pull_requests: "write",
      checks: "read",
      statuses: "read",
      actions: "read",
      // Decision 052 A: the alerts of GitHub.
      dependabot_alerts: "read",
      security_events: "read",
      secret_scanning_alerts: "read",
      // Decision 067 D: a commit that touches .github/workflows needs it.
      workflows: "write",
    },
    // The installation events are always sent to an App and cannot be listed here.
    default_events: [
      "issues",
      "pull_request",
      "pull_request_review",
      "check_suite",
      "status",
      "workflow_run",
      "dependabot_alert",
      "code_scanning_alert",
      "secret_scanning_alert",
    ],
  };
}

/** The origin of an http(s) URL, or null. */
function originOf(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.origin;
  } catch {}
  return null;
}

const HTTPS_ONLY =
  "Ouvre Cockpit par son adresse en https:// pour l'installer : claude.ai l'exige pour le connecteur.";
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** The scheme CF-Visitor reports (`{"scheme":"https"}`), or undefined when absent or unreadable. */
function visitorScheme(header: string | undefined) {
  try {
    const { scheme } = JSON.parse(header ?? "");
    if (scheme === "http" || scheme === "https") return scheme;
  } catch {}
  return undefined;
}

/** The address the visitor typed. The proxy (Cloudflare) tells it: CF-Visitor is the visitor's scheme, X-Forwarded-Proto may be the one behind the tunnel (decision 023 A). */
function detectUrl(c: Context) {
  const proto =
    visitorScheme(c.req.header("cf-visitor")) ??
    c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (
    c.req.header("x-forwarded-host") ??
    (proto ? c.req.header("host") : undefined)
  )
    ?.split(",")[0]
    ?.trim();
  return (
    (proto && host && originOf(`${proto}://${host}`)) ||
    new URL(c.req.url).origin
  );
}

/** Equal-length digests of the code without case, spaces or dashes, so a copy typed loosely still matches and the comparison takes the same time whatever the guess. */
function sameCode(given: string, expected: string) {
  const digest = (value: string) =>
    createHash("sha256")
      .update(value.toUpperCase().replace(/[\s-]/g, ""))
      .digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The cookie that lets the person who proved they know the setup code become the first administrator. */
function giveClaim(c: Context, publicUrl: string, claim: string) {
  setCookie(c, CLAIM_COOKIE, claim, {
    httpOnly: true,
    sameSite: "Lax",
    secure: publicUrl.startsWith("https:"),
    path: "/api/auth",
    maxAge: SETUP_SECONDS,
  });
}

export function setupRoutes(
  db: Db,
  readInstance: ReadInstance,
  encryptionKey: Buffer,
  setupCode: string,
) {
  // shortcut: in memory, so a restart forgets them; fine for one instance (decision 008), the person just starts again.
  const pending = new Map<string, { publicUrl: string; expiresAt: number }>();

  async function adminExists() {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isAdmin, true))
      .limit(1);
    return admin !== undefined;
  }

  return new Hono()
    .get("/api/setup/status", async (c) => {
      const detectedUrl = detectUrl(c);
      if (!(await readInstance()))
        return c.json({ configured: false as const, detectedUrl });
      // Configured but nobody is administrator: the page offers to claim it (see /api/setup/claim).
      return c.json({
        configured: true as const,
        hasAdmin: await adminExists(),
        detectedUrl,
      });
    })
    .post("/api/setup/claim", async (c) => {
      const settings = await readInstance();
      // Only for an instance whose App exists but that has no administrator.
      if (!settings || (await adminExists()))
        return c.json({ error: "Rien à récupérer sur ce Cockpit" }, 409);
      const body = codeBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "Bad request" }, 400);
      if (!sameCode(body.data.code, setupCode))
        return c.json({ error: "Code de démarrage incorrect" }, 403);
      const claim = randomBytes(32).toString("hex");
      await act(
        db,
        {
          userId: null,
          actor: "human",
          origin: "ui",
          action: "claim_admin",
          args: {},
        },
        async (tx) => {
          await tx
            .update(instanceSettings)
            .set({ adminClaimHash: sha256(claim) })
            .where(eq(instanceSettings.id, 1));
        },
      );
      giveClaim(c, settings.publicUrl, claim);
      return c.json({ next: "/api/auth/login" });
    })
    .post("/api/setup/start", async (c) => {
      if (await readInstance())
        return c.json({ error: "Cockpit est déjà installé" }, 409);
      const body = codeBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "Bad request" }, 400);
      if (!sameCode(body.data.code, setupCode))
        return c.json({ error: "Code de démarrage incorrect" }, 403);
      // The address is the one the visitor opened Cockpit with: https, or http on this machine only (decision 028 J).
      const publicUrl = detectUrl(c);
      const { protocol, hostname } = new URL(publicUrl);
      if (protocol !== "https:" && !LOOPBACK.includes(hostname))
        return c.json({ error: HTTPS_ONLY }, 400);

      const now = Date.now();
      for (const [state, entry] of pending)
        if (entry.expiresAt <= now) pending.delete(state);
      const state = randomBytes(32).toString("hex");
      pending.set(state, { publicUrl, expiresAt: now + SETUP_SECONDS * 1000 });
      setCookie(c, SETUP_COOKIE, state, {
        httpOnly: true,
        sameSite: "Lax",
        secure: publicUrl.startsWith("https:"),
        path: "/api/setup",
        maxAge: SETUP_SECONDS,
      });
      return c.json({
        action: `https://github.com/settings/apps/new?state=${state}`,
        manifest: manifest(publicUrl),
      });
    })
    .get("/api/setup/callback", async (c) => {
      const cookie = getCookie(c, SETUP_COOKIE);
      // The state is single-use: whatever happens next, it is gone.
      deleteCookie(c, SETUP_COOKIE, { path: "/api/setup" });
      const { code, state } = c.req.query();
      const setup = state ? pending.get(state) : undefined;
      if (state) pending.delete(state);
      if (
        (await readInstance()) ||
        !code ||
        !setup ||
        setup.expiresAt <= Date.now() ||
        state !== cookie
      ) {
        console.error("GitHub App setup failed: invalid_callback");
        return c.redirect(FAILED);
      }

      const claim = randomBytes(32).toString("hex");
      // No user yet, and nothing secret in the entry (decision 010 D).
      const entry: Entry = {
        userId: null,
        actor: "human",
        origin: "ui",
        action: "setup_github_app",
        args: {},
      };
      try {
        await act(db, entry, async (tx) => {
          const res = await fetch(
            `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
            {
              method: "POST",
              headers: {
                accept: "application/vnd.github+json",
                "user-agent": "cockpit",
              },
              signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
            },
          );
          if (!res.ok) throw new Error(`conversion_http_${res.status}`);
          const app = conversion.safeParse(await res.json());
          if (!app.success) throw new Error("invalid_github_answer");
          const stored = await tx
            .insert(instanceSettings)
            .values({
              id: 1,
              publicUrl: setup.publicUrl,
              githubAppId: String(app.data.id),
              githubAppSlug: app.data.slug,
              githubClientId: app.data.client_id,
              githubClientSecret: encrypt(
                encryptionKey,
                app.data.client_secret,
              ),
              githubPrivateKey: encrypt(encryptionKey, app.data.pem),
              githubWebhookSecret: encrypt(
                encryptionKey,
                app.data.webhook_secret,
              ),
              adminClaimHash: sha256(claim),
            })
            .onConflictDoNothing()
            .returning({ id: instanceSettings.id });
          // A parallel callback got there first.
          if (stored.length === 0) throw new Refused("already_configured");
        });
      } catch (error) {
        // Fixed codes only: GitHub's answer holds the secrets, a failed request may hold a URL.
        console.error(
          "GitHub App setup failed:",
          error instanceof Error && !(error instanceof SyntaxError)
            ? error.message
            : "error",
        );
        return c.redirect(FAILED);
      }
      giveClaim(c, setup.publicUrl, claim);
      // The person who just created the App is the first to log in: that makes them administrator.
      return c.redirect("/api/auth/login");
    });
}
