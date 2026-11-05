import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser, sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { mcpTokens, users } from "./db/schema.ts";
import type { ReadInstance } from "./instance.ts";
import { liveToken, MAX_ACTIVE_TOKENS } from "./tokens.ts";

// Decisions 021 and 006: Cockpit as a connector of claude.ai (OAuth 2.1 with PKCE, clients known by a CIMD document).
// Decision 021 amended: exactly these two client_id values (claude.ai and Claude Code), nothing else is ever fetched.
const CLAUDE_AI_CLIENT = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CODE_CLIENT =
  "https://claude.ai/oauth/claude-code-client-metadata";
const KNOWN_CLIENTS = [CLAUDE_AI_CLIENT, CLAUDE_CODE_CLIENT];
const CIMD_TIMEOUT_MS = 5_000;
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_CACHE_MS = 10 * 60_000;
// A failed read is kept too, so a client_id that never answers cannot make us fetch at every request.
const CIMD_FAILURE_CACHE_MS = 60_000;
const CIMD_CACHE_MAX = 300;
const CODE_MS = 60_000;
const ACCESS_SECONDS = 3_600;
const REFRESH_MS = 90 * 24 * 3_600_000;
// Not under /api: the global limit does not cover it. A token request is a few hundred bytes.
const TOKEN_BODY_LIMIT = 16 * 1024;

// What we read of the CIMD document; anything else is ignored.
const clientDocument = z.object({
  client_id: z.string(),
  redirect_uris: z.array(z.string()).min(1),
});

// The authorize query, as the page and the JSON body of the approval carry it (RFC 7636: a S256 challenge is 43 base64url characters).
const authorizeRequest = z.object({
  response_type: z.literal("code"),
  client_id: z.string().max(2048),
  redirect_uri: z.string().max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  // Up to what a `next` of /autoriser can carry through the login (auth.ts safeNext).
  // A longer state could not survive the login cookie of next (auth.ts): refused here rather than lost there.
  state: z.string().max(2048).optional(),
  resource: z.string().max(2048).optional(),
});
const approveBody = authorizeRequest.extend({
  decision: z.enum(["approve", "deny"]),
});

type AuthorizationCode = {
  userId: number;
  clientId: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
};

type Env = { Variables: { userId: number } };

/** The pages call these routes with the authorize query as plain text fields; `checkRequest` is what judges them (a repeated key is not a string, so it is refused here). */
const fieldsOf = z.record(z.string(), z.string());

const newSecret = () => randomBytes(32).toString("base64url");

const isLoopback = (url: URL) =>
  url.protocol === "http:" &&
  (url.hostname === "localhost" || url.hostname === "127.0.0.1");

/** Listed as is, or a loopback address on another port (RFC 8252 7.3: Claude Code picks a free port each time). Only https, or http on loopback: a document may list `javascript:` or `data:`. */
function redirectAllowed(requested: string, listed: string[]) {
  const url = URL.parse(requested);
  if (!url || url.hash) return false;
  if (url.protocol !== "https:" && !isLoopback(url)) return false;
  return listed.some((entry) => {
    if (entry === requested) return true;
    const other = URL.parse(entry);
    return (
      other !== null &&
      isLoopback(url) &&
      isLoopback(other) &&
      url.hostname === other.hostname &&
      url.pathname === other.pathname &&
      url.search === other.search
    );
  });
}

/** The body of a response, or null when it is over `max` bytes. */
async function readCapped(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Constant-time comparison of two secrets or hashes. */
const sameHash = (a: string | null, b: string) =>
  a !== null &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

const pkceMatches = (verifier: string, challenge: string) =>
  sameHash(
    challenge,
    createHash("sha256").update(verifier).digest("base64url"),
  );

const refusedPage = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Demande d'autorisation invalide</title></head>
<body>
<h1>Demande d'autorisation invalide</h1>
<p>Cockpit ne peut pas traiter cette demande de connexion. Retourne dans Claude et recommence l'ajout du connecteur depuis le début.</p>
</body>
</html>`;

/** The OAuth server of the connector (decision 021) and what the Réglages and /autoriser pages read. */
export function oauthRoutes(
  db: Db,
  readInstance: ReadInstance,
  fetchClientMetadata: (url: string, init?: RequestInit) => Promise<Response>,
  now: () => number,
) {
  // In memory, as decision 006 says: a restart only makes a connection in progress start again. Keyed by the hash of the code.
  const codes = new Map<string, AuthorizationCode>();
  // Read results by client_id, null for a failed read; the oldest go first past CIMD_CACHE_MAX.
  const documents = new Map<
    string,
    { redirectUris: string[] | null; at: number }
  >();
  const reading = new Map<string, Promise<string[] | null>>();

  /** The redirect URIs of a client's CIMD document, or null when it cannot be trusted. */
  async function clientRedirects(clientId: string) {
    const cached = documents.get(clientId);
    if (
      cached &&
      now() - cached.at <
        (cached.redirectUris ? CIMD_CACHE_MS : CIMD_FAILURE_CACHE_MS)
    )
      return cached.redirectUris;
    // One fetch per address at a time: concurrent requests wait for it.
    let pending = reading.get(clientId);
    if (!pending) {
      pending = readClientDocument(clientId)
        .then((redirectUris) => {
          documents.delete(clientId);
          documents.set(clientId, { redirectUris, at: now() });
          for (const key of documents.keys()) {
            if (documents.size <= CIMD_CACHE_MAX) break;
            documents.delete(key);
          }
          return redirectUris;
        })
        .finally(() => reading.delete(clientId));
      reading.set(clientId, pending);
    }
    return pending;
  }

  /** Fetches and checks the document: its redirect URIs, or null. Never throws. */
  async function readClientDocument(clientId: string) {
    try {
      const res = await fetchClientMetadata(clientId, {
        signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
        // A redirect could lead anywhere: the document is at this address or nowhere.
        redirect: "error",
      });
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      const text = await readCapped(res, CIMD_MAX_BYTES);
      if (text === null) return null;
      const parsed = clientDocument.safeParse(JSON.parse(text));
      if (!parsed.success || parsed.data.client_id !== clientId) return null;
      return parsed.data.redirect_uris;
    } catch (error) {
      // Names only, never the document nor its address.
      console.error(
        "Client metadata not read:",
        error instanceof Error ? error.name : "error",
      );
      return null;
    }
  }

  /** The checked authorize request, or null: the same checks run on the GET, the page's read and the approval. */
  async function checkRequest(input: unknown) {
    const parsed = authorizeRequest.safeParse(input);
    if (!parsed.success || !KNOWN_CLIENTS.includes(parsed.data.client_id))
      return null;
    const request = parsed.data;
    const redirects = await clientRedirects(request.client_id);
    if (!redirects || !redirectAllowed(request.redirect_uri, redirects))
      return null;
    return {
      ...request,
      clientName:
        request.client_id === CLAUDE_CODE_CLIENT ? "Claude Code" : "claude.ai",
      returnHost: new URL(request.redirect_uri).hostname,
    };
  }

  /** Locks the user, like decision 015 D, and refuses a blocked one: a block committed after the check of the session or the code must stop what follows (decision 012 G). */
  async function lockUser(tx: Tx, userId: number) {
    const [owner] = await tx
      .select({ blockedAt: users.blockedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!owner || owner.blockedAt) throw new Refused("account_blocked");
  }

  // The session comes first: a stranger learns nothing about the validation.
  const session = createMiddleware<Env>(async (c, next) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.set("userId", user.userId);
    await next();
  });
  const fields = <T extends "query" | "json">(target: T) =>
    validator(target, (value, c) => {
      const parsed = fieldsOf.safeParse(value);
      return parsed.success
        ? parsed.data
        : c.json({ error: "invalid_request" }, 400);
    });

  const tokenError = (c: Context, error: string) => c.json({ error }, 400);

  async function protectedResource(c: Context) {
    const config = await readInstance();
    if (!config) return c.json({ error: "Not found" }, 404);
    return c.json({
      resource: `${config.publicUrl}/mcp`,
      authorization_servers: [config.publicUrl],
    });
  }

  return new Hono<Env>()
    .get("/.well-known/oauth-protected-resource", protectedResource)
    .get("/.well-known/oauth-protected-resource/mcp", protectedResource)
    .get("/.well-known/oauth-authorization-server", async (c) => {
      const config = await readInstance();
      if (!config) return c.json({ error: "Not found" }, 404);
      const base = config.publicUrl;
      return c.json({
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        client_id_metadata_document_supported: true,
      });
    })
    .get("/oauth/authorize", async (c) => {
      // The request first: an invalid one never reaches a login nor a redirect to the address it names.
      if (!(await checkRequest(c.req.query()))) return c.html(refusedPage, 400);
      const page = `/autoriser${new URL(c.req.url).search}`;
      return c.redirect(
        (await currentUser(db, c))
          ? page
          : `/api/auth/login?next=${encodeURIComponent(page)}`,
      );
    })
    .get("/api/oauth/request", session, fields("query"), async (c) => {
      const request = await checkRequest(c.req.valid("query"));
      if (!request) return c.json({ error: "invalid_request" }, 400);
      return c.json({
        clientName: request.clientName,
        returnHost: request.returnHost,
      });
    })
    .post("/api/oauth/approve", session, fields("json"), async (c) => {
      const userId = c.get("userId");
      const body = approveBody.safeParse(c.req.valid("json"));
      const request = body.success && (await checkRequest(body.data));
      if (!body.success || !request)
        return c.json({ error: "invalid_request" }, 400);
      const approve = body.data.decision === "approve";
      // Only the decision: the client, the challenge and the code stay out of the history (decision 010 D).
      const entry: Entry = {
        userId,
        actor: "human",
        origin: "ui",
        action: "oauth_authorize",
        args: { decision: body.data.decision },
      };
      try {
        await act(db, entry, async (tx) => {
          if (approve) await lockUser(tx, userId);
        });
      } catch (error) {
        if (error instanceof Refused)
          return c.json({ error: "account_blocked" }, 403);
        throw error;
      }
      const returnUrl = new URL(request.redirect_uri);
      if (approve) {
        const code = newSecret();
        const at = now();
        for (const [key, value] of codes)
          if (value.expiresAt <= at) codes.delete(key);
        codes.set(sha256(code), {
          userId,
          clientId: request.client_id,
          redirectUri: request.redirect_uri,
          challenge: request.code_challenge,
          expiresAt: at + CODE_MS,
        });
        returnUrl.searchParams.set("code", code);
      } else returnUrl.searchParams.set("error", "access_denied");
      if (request.state !== undefined)
        returnUrl.searchParams.set("state", request.state);
      return c.json({ redirectUrl: returnUrl.href });
    })
    .get("/api/me/connect", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const config = await readInstance();
      if (!config) return c.json({ error: "Not found" }, 404);
      const [latest] = await db
        .select({
          createdAt: mcpTokens.createdAt,
          clientId: mcpTokens.clientId,
        })
        .from(mcpTokens)
        .where(
          and(
            eq(mcpTokens.userId, user.userId),
            isNotNull(mcpTokens.clientId),
            liveToken,
          ),
        )
        .orderBy(desc(mcpTokens.createdAt), desc(mcpTokens.id))
        .limit(1);
      return c.json({
        mcpUrl: `${config.publicUrl}/mcp`,
        connected: latest !== undefined,
        connectedAt: latest?.createdAt ?? null,
        client: latest
          ? latest.clientId === CLAUDE_CODE_CLIENT
            ? ("Claude Code" as const)
            : ("claude.ai" as const)
          : null,
      });
    })
    .post(
      "/oauth/token",
      bodyLimit({ maxSize: TOKEN_BODY_LIMIT }),
      async (c) => {
        // Never cached (RFC 6749 5.1): the answer holds secrets.
        c.header("Cache-Control", "no-store");
        if (
          !c.req
            .header("content-type")
            ?.startsWith("application/x-www-form-urlencoded")
        )
          return tokenError(c, "invalid_request");
        const form = Object.fromEntries(
          new URLSearchParams(await c.req.text()),
        );
        const { grant_type: grant } = form;
        if (!grant) return tokenError(c, "invalid_request");
        if (grant !== "authorization_code" && grant !== "refresh_token")
          return tokenError(c, "unsupported_grant_type");

        const access = `ckp_${newSecret()}`;
        const refresh = newSecret();
        const issuedAt = now();
        const fresh = {
          tokenHash: sha256(access),
          lastFour: access.slice(-4),
          refreshHash: sha256(refresh),
          expiresAt: new Date(issuedAt + ACCESS_SECONDS * 1000),
          refreshExpiresAt: new Date(issuedAt + REFRESH_MS),
        };
        const answer = () =>
          c.json({
            access_token: access,
            token_type: "Bearer",
            expires_in: ACCESS_SECONDS,
            refresh_token: refresh,
          });

        if (grant === "authorization_code") {
          const { code, redirect_uri, client_id, code_verifier } = form;
          if (!code || !redirect_uri || !client_id || !code_verifier)
            return tokenError(c, "invalid_request");
          // Single use: gone as soon as it is presented, whatever follows.
          const key = sha256(code);
          const issued = codes.get(key);
          codes.delete(key);
          if (
            !issued ||
            issued.expiresAt <= issuedAt ||
            issued.clientId !== client_id ||
            issued.redirectUri !== redirect_uri ||
            !pkceMatches(code_verifier, issued.challenge)
          )
            return tokenError(c, "invalid_grant");
          const entry: Entry = {
            userId: issued.userId,
            actor: "claude",
            origin: "mcp",
            action: "oauth_token",
            args: { grant },
          };
          try {
            await act(db, entry, async (tx) => {
              await lockUser(tx, issued.userId);
              const [{ active } = { active: 0 }] = await tx
                .select({ active: sql<number>`count(*)::int` })
                .from(mcpTokens)
                .where(and(eq(mcpTokens.userId, issued.userId), liveToken));
              if (active >= MAX_ACTIVE_TOKENS)
                throw new Refused("too_many_tokens");
              const [inserted] = await tx
                .insert(mcpTokens)
                .values({
                  ...fresh,
                  userId: issued.userId,
                  name:
                    client_id === CLAUDE_CODE_CLIENT
                      ? "Claude Code"
                      : "claude.ai",
                  clientId: client_id,
                })
                .returning({ id: mcpTokens.id });
              if (!inserted) throw new Error("token not created");
              entry.tokenId = inserted.id;
              entry.args = { tokenId: inserted.id, grant };
            });
          } catch (error) {
            if (!(error instanceof Refused)) throw error;
            return tokenError(
              c,
              error.message === "too_many_tokens"
                ? "invalid_request"
                : "invalid_grant",
            );
          }
          return answer();
        }

        const { refresh_token, client_id } = form;
        if (!refresh_token) return tokenError(c, "invalid_request");
        const [found] = await db
          .select({
            id: mcpTokens.id,
            userId: mcpTokens.userId,
            clientId: mcpTokens.clientId,
          })
          .from(mcpTokens)
          .where(eq(mcpTokens.refreshHash, sha256(refresh_token)));
        // Nobody is known yet: nothing to write (decision 010 E).
        if (!found || (client_id && client_id !== found.clientId))
          return tokenError(c, "invalid_grant");
        const entry: Entry = {
          userId: found.userId,
          tokenId: found.id,
          actor: "claude",
          origin: "mcp",
          action: "oauth_token",
          args: { tokenId: found.id, grant },
        };
        try {
          await act(db, entry, async (tx) => {
            // Locked and read again: two refreshes with the same token cannot both win.
            const [row] = await tx
              .select({
                refreshHash: mcpTokens.refreshHash,
                refreshExpiresAt: mcpTokens.refreshExpiresAt,
                revokedAt: mcpTokens.revokedAt,
              })
              .from(mcpTokens)
              .where(eq(mcpTokens.id, found.id))
              .for("update");
            if (
              !row ||
              row.revokedAt ||
              !sameHash(row.refreshHash, sha256(refresh_token)) ||
              !row.refreshExpiresAt ||
              row.refreshExpiresAt.getTime() <= issuedAt
            )
              throw new Refused("invalid_grant");
            await lockUser(tx, found.userId);
            await tx
              .update(mcpTokens)
              .set(fresh)
              .where(eq(mcpTokens.id, found.id));
          });
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          return tokenError(c, "invalid_grant");
        }
        return answer();
      },
    );
}
