import { asc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { sessions, users } from "./db/schema.ts";
import type { InstanceSettings, ReadInstance } from "./instance.ts";
import { proCodeRoutes } from "./pro-codes.ts";
import { NOT_CONFIGURED } from "./projects.ts";

type Env = { Variables: { adminId: number; settings: InstanceSettings } };

/** The administrator's user list and block list (decision 012 G). */
export function accountRoutes(db: Db, readInstance: ReadInstance) {
  /** 503 before the session check, as the other routes; then 401 without a session and 403 for a non-administrator. */
  const adminOnly = createMiddleware<Env>(async (c, next) => {
    const settings = await readInstance();
    if (!settings) return c.json({ error: NOT_CONFIGURED }, 503);
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (!user.isAdmin) return c.json({ error: "Forbidden" }, 403);
    c.set("adminId", user.userId);
    c.set("settings", settings);
    await next();
  });

  /** Blocks or unblocks the user in the path; the entry holds the user id only, a login is personal data (decision 010 D). */
  const setBlocked = async (c: Context<Env>, blocked: boolean) => {
    const id = Number(c.req.param("id"));
    // Not a PostgreSQL integer: no such user, and the query must not run (it would fail).
    if (!Number.isInteger(id) || id < 1 || id > 2147483647)
      return c.json({ error: "Not found" }, 404);
    const entry: Entry = {
      userId: c.get("adminId"),
      actor: "human",
      origin: "ui",
      action: blocked ? "block_user" : "unblock_user",
      args: { userId: id },
    };
    try {
      await act(db, entry, async (tx) => {
        // Locks the row: a login racing with this block waits for it (see auth.ts).
        const [user] = await tx
          .select({ isAdmin: users.isAdmin, blockedAt: users.blockedAt })
          .from(users)
          .where(eq(users.id, id))
          .for("update");
        if (!user) throw new Refused("not_found");
        if (blocked && user.isAdmin) throw new Refused("cannot_block_admin");
        if (blocked && user.blockedAt) throw new Refused("already_blocked");
        if (!blocked && !user.blockedAt) throw new Refused("not_blocked");
        await tx
          .update(users)
          .set({ blockedAt: blocked ? new Date() : null })
          .where(eq(users.id, id));
        if (blocked) await tx.delete(sessions).where(eq(sessions.userId, id));
      });
      return c.body(null, 204);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return error.message === "not_found"
        ? c.json({ error: "Not found" }, 404)
        : c.json({ error: error.message }, 409);
    }
  };

  return new Hono<Env>()
    .use("/api/settings/*", adminOnly)
    .route("/", proCodeRoutes(db))
    .get("/api/settings/users", async (c) => {
      const all = await db
        .select({
          id: users.id,
          login: users.login,
          isAdmin: users.isAdmin,
          blockedAt: users.blockedAt,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
          // Decision 076 H: how many projects they belong to, never which.
          projects: sql<number>`(select count(*)::int from project_members m where m.user_id = ${users.id})`,
        })
        .from(users)
        .orderBy(asc(users.id));
      return c.json({ users: all });
    })
    .post("/api/settings/users/:id/block", (c) => setBlocked(c, true))
    .post("/api/settings/users/:id/unblock", (c) => setBlocked(c, false));
}
