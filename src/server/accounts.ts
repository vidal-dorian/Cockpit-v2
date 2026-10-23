import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { allowedAccounts, sessions, users } from "./db/schema.ts";
import type { ReadInstance } from "./instance.ts";
import { NOT_CONFIGURED } from "./projects.ts";

// GitHub's rule: 1 to 39 letters, digits and single inner hyphens.
const allowBody = z.object({
  login: z.string().regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i),
});

const sameLogin = (column: typeof users.login, login: string) =>
  sql`lower(${column}) = lower(${login})`;

type Env = { Variables: { adminId: number } };

/** The administrator's allow-list (decision 012 G). */
export function accountRoutes(db: Db, readInstance: ReadInstance) {
  /** 503 before the session check, as the other routes; then 401 without a session and 403 for a non-administrator. */
  const adminOnly = createMiddleware<Env>(async (c, next) => {
    if (!(await readInstance())) return c.json({ error: NOT_CONFIGURED }, 503);
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (!user.isAdmin) return c.json({ error: "Forbidden" }, 403);
    c.set("adminId", user.userId);
    await next();
  });

  return new Hono<Env>()
    .use("/api/settings/*", adminOnly)
    .get("/api/settings/accounts", async (c) => {
      const accounts = await db
        .select()
        .from(allowedAccounts)
        .orderBy(asc(allowedAccounts.id));
      return c.json({ accounts });
    })
    .post(
      "/api/settings/accounts",
      validator("json", (value, c) => {
        const parsed = allowBody.safeParse(value);
        if (!parsed.success) return c.json({ error: "Bad request" }, 400);
        return parsed.data;
      }),
      async (c) => {
        const { login } = c.req.valid("json");
        // The login is personal data: it stays out of the history (decision 010 D), only the account id goes in.
        const entry: Entry = {
          userId: c.get("adminId"),
          actor: "human",
          origin: "ui",
          action: "allow_account",
          args: {},
        };
        try {
          const account = await act(db, entry, async (tx) => {
            const [admin] = await tx
              .select({ id: users.id })
              .from(users)
              .where(
                and(eq(users.isAdmin, true), sameLogin(users.login, login)),
              );
            if (admin) throw new Refused("already_allowed");
            // The unique index on lower(login) decides, so two parallel requests cannot both win.
            const [created] = await tx
              .insert(allowedAccounts)
              .values({ login })
              .onConflictDoNothing()
              .returning();
            if (!created) throw new Refused("already_allowed");
            entry.args = { accountId: created.id };
            return created;
          });
          return c.json({ account }, 201);
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          return c.json({ error: "already_allowed" }, 409);
        }
      },
    )
    .delete("/api/settings/accounts/:id", async (c) => {
      const id = Number(c.req.param("id"));
      // Not a PostgreSQL integer: no such account, and the query must not run (it would fail).
      if (!Number.isInteger(id) || id < 1 || id > 2147483647)
        return c.json({ error: "Not found" }, 404);
      const entry: Entry = {
        userId: c.get("adminId"),
        actor: "human",
        origin: "ui",
        action: "revoke_account",
        args: { accountId: id },
      };
      try {
        await act(db, entry, async (tx) => {
          const [removed] = await tx
            .delete(allowedAccounts)
            .where(eq(allowedAccounts.id, id))
            .returning({ login: allowedAccounts.login });
          if (!removed) throw new Refused("not_found");
          // Their open sessions end now; the users row stays, the history points at it.
          await tx.delete(sessions).where(
            inArray(
              sessions.userId,
              tx
                .select({ id: users.id })
                .from(users)
                .where(
                  and(
                    eq(users.isAdmin, false),
                    sameLogin(users.login, removed.login),
                  ),
                ),
            ),
          );
        });
        return c.body(null, 204);
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return c.json({ error: "Not found" }, 404);
      }
    });
}
