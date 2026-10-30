import { asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { instanceSettings, sessions, users } from "./db/schema.ts";
import type { InstanceSettings, ReadInstance } from "./instance.ts";
import { NOT_CONFIGURED } from "./projects.ts";
import { checkPublicUrl } from "./setup.ts";

const publicUrlBody = z.object({ publicUrl: z.string() });

type Env = { Variables: { adminId: number; settings: InstanceSettings } };

/** The administrator's user list and block list (decision 012 G), and the public address (decision 023 C). */
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
    .get("/api/settings/users", async (c) => {
      const all = await db
        .select({
          id: users.id,
          login: users.login,
          isAdmin: users.isAdmin,
          blockedAt: users.blockedAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(asc(users.id));
      return c.json({ users: all });
    })
    .get("/api/settings/public-url", async (c) => {
      const { publicUrl, githubAppSlug } = c.get("settings");
      return c.json({
        publicUrl,
        appSettingsUrl: `https://github.com/settings/apps/${githubAppSlug}`,
      });
    })
    .put("/api/settings/public-url", async (c) => {
      const body = publicUrlBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) return c.json({ error: "Bad request" }, 400);
      const checked = checkPublicUrl(body.data.publicUrl);
      if (checked.error !== undefined)
        return c.json({ error: checked.error }, 400);
      // Neither address in the entry (decision 010 D).
      const entry: Entry = {
        userId: c.get("adminId"),
        actor: "human",
        origin: "ui",
        action: "change_public_url",
        args: {},
      };
      await act(db, entry, async (tx) => {
        await tx
          .update(instanceSettings)
          .set({ publicUrl: checked.origin })
          .where(eq(instanceSettings.id, 1));
      });
      readInstance.forget();
      return c.json({ publicUrl: checked.origin });
    })
    .post("/api/settings/users/:id/block", (c) => setBlocked(c, true))
    .post("/api/settings/users/:id/unblock", (c) => setBlocked(c, false));
}
