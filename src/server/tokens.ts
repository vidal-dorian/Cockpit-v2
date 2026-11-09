import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser, sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  history,
  mcpTokens,
  sessions,
  users,
  webhookDeliveries,
} from "./db/schema.ts";
import { isDatabaseId } from "./projects.ts";

// Limits of decision 015. PostgreSQL text cannot hold a NUL character: refused here, not left to fail as a 500.
export const MAX_ACTIVE_TOKENS = 20;
const createBody = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((name) => !name.includes("\0")),
});

/** Never the hash: the secret is only in the answer of the creation. */
const present = (t: typeof mcpTokens.$inferSelect) => ({
  id: t.id,
  name: t.name,
  // OAuth connections (decision 021 E) are the rows with a client; the page tells them from the manual tokens.
  kind: t.clientId ? ("oauth" as const) : ("manual" as const),
  lastFour: t.lastFour,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
  revokedAt: t.revokedAt,
});

/** Not revoked, and not an OAuth connection whose refresh token has expired: that one can never be used again (decision 021 E). */
export const liveToken = and(
  isNull(mcpTokens.revokedAt),
  or(
    isNull(mcpTokens.refreshExpiresAt),
    sql`${mcpTokens.refreshExpiresAt} > now()`,
  ),
);

const PURGE_EVERY_MS = 24 * 3_600_000;

/**
 * Deletes the tokens revoked, or dead by the expiry of their refresh token, more than 3 calendar months before `now`, and only those (decision 015 G).
 * The history entry is written in the same transaction, only when something was deleted.
 */
export async function purgeRevokedTokens(
  db: Db,
  now = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(mcpTokens)
      .where(
        sql`least(${mcpTokens.revokedAt}, ${mcpTokens.refreshExpiresAt}) < ${now.toISOString()}::timestamptz - interval '3 months'`,
      )
      .returning({ id: mcpTokens.id });
    if (deleted.length > 0)
      await tx.insert(history).values({
        userId: null,
        actor: "system",
        origin: "system",
        action: "purge_revoked_tokens",
        args: { count: deleted.length },
        result: "ok",
      });
    return deleted.length;
  });
}

/** Deletes the webhook deliveries received more than 30 days ago, processed or not (decision 024 H). */
const purgeWebhookDeliveries = (db: Db) =>
  db
    .delete(webhookDeliveries)
    .where(sql`${webhookDeliveries.receivedAt} < now() - interval '30 days'`);

/** Purges now, then every 24 hours; a failed run is logged and the next one tries again. */
export function schedulePurge(db: Db): NodeJS.Timeout {
  const run = () =>
    Promise.all([
      purgeRevokedTokens(db).catch((error) =>
        console.error("Purge of revoked tokens failed:", error),
      ),
      purgeWebhookDeliveries(db).catch((error) =>
        console.error("Purge of webhook deliveries failed:", error),
      ),
      // A session is otherwise deleted only when its expired cookie comes back, so an abandoned one stayed forever.
      db
        .delete(sessions)
        .where(sql`${sessions.expiresAt} < now()`)
        .catch((error) =>
          console.error("Purge of expired sessions failed:", error),
        ),
    ]);
  void run();
  return setInterval(run, PURGE_EVERY_MS).unref();
}

type Env = { Variables: { userId: number } };

/** A user's own MCP tokens (decision 015): personal, so the administrator has no more right on them than anyone. */
export function tokenRoutes(db: Db) {
  const entryOf = (userId: number, action: string): Entry => ({
    userId,
    actor: "human",
    origin: "ui",
    action,
    args: {},
  });

  return new Hono<Env>()
    .get("/api/me/tokens", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const rows = await db
        .select()
        .from(mcpTokens)
        .where(and(eq(mcpTokens.userId, user.userId), liveToken))
        .orderBy(desc(mcpTokens.id));
      return c.json({ tokens: rows.map(present) });
    })
    .post(
      "/api/me/tokens",
      // The session comes first: a stranger learns nothing about the validation.
      createMiddleware<Env>(async (c, next) => {
        const user = await currentUser(db, c);
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        c.set("userId", user.userId);
        await next();
      }),
      validator("json", (value, c) => {
        const parsed = createBody.safeParse(value);
        return parsed.success
          ? parsed.data
          : c.json({ error: "Bad request" }, 400);
      }),
      async (c) => {
        const userId = c.get("userId");
        const secret = `ckp_${randomBytes(32).toString("base64url")}`;
        const entry = entryOf(userId, "create_token");
        try {
          const row = await act(db, entry, async (tx) => {
            // Locks the user: two creations at once wait for each other, so the count cannot be passed.
            // It also reads the block: one that committed after the session check must stop the creation (decision 012 G).
            const [owner] = await tx
              .select({ blockedAt: users.blockedAt })
              .from(users)
              .where(eq(users.id, userId))
              .for("update");
            if (owner?.blockedAt) throw new Refused("account_blocked");
            const [{ active } = { active: 0 }] = await tx
              .select({ active: sql<number>`count(*)::int` })
              .from(mcpTokens)
              .where(and(eq(mcpTokens.userId, userId), liveToken));
            if (active >= MAX_ACTIVE_TOKENS)
              throw new Refused("too_many_tokens");
            const [inserted] = await tx
              .insert(mcpTokens)
              .values({
                userId: userId,
                name: c.req.valid("json").name,
                tokenHash: sha256(secret),
                lastFour: secret.slice(-4),
              })
              .returning();
            if (!inserted) throw new Error("token not created");
            entry.args = { tokenId: inserted.id };
            return inserted;
          });
          return c.json({ token: present(row), secret }, 201);
        } catch (error) {
          if (error instanceof Refused)
            return c.json(
              { error: error.message },
              error.message === "account_blocked" ? 403 : 409,
            );
          throw error;
        }
      },
    )
    .post("/api/me/tokens/:id/revoke", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const id = Number(c.req.param("id"));
      if (!isDatabaseId(id)) return c.json({ error: "Not found" }, 404);
      const [own] = await db
        .select({ id: mcpTokens.id })
        .from(mcpTokens)
        .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, user.userId)));
      // Someone else's token looks like no token, and leaves no entry.
      if (!own) return c.json({ error: "Not found" }, 404);
      const entry = {
        ...entryOf(user.userId, "revoke_token"),
        args: { tokenId: id },
      };
      try {
        await act(db, entry, async (tx) => {
          const [token] = await tx
            .select({ revokedAt: mcpTokens.revokedAt })
            .from(mcpTokens)
            .where(eq(mcpTokens.id, id))
            .for("update");
          // Gone since the ownership check: the purge deleted it meanwhile.
          if (!token) throw new Refused("not_found");
          if (token.revokedAt) throw new Refused("already_revoked");
          await tx
            .update(mcpTokens)
            .set({ revokedAt: sql`now()` })
            .where(eq(mcpTokens.id, id));
        });
        return c.body(null, 204);
      } catch (error) {
        if (error instanceof Refused)
          return error.message === "not_found"
            ? c.json({ error: "Not found" }, 404)
            : c.json({ error: error.message }, 409);
        throw error;
      }
    });
}
