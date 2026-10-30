import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { history } from "./db/schema.ts";

const LIMIT = 100;

export function historyRoutes(db: Db) {
  return new Hono().get("/api/history", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    // Only the caller's own entries; entries without a user are for nobody yet (decision 010 G).
    const entries = await db
      .select({
        id: history.id,
        at: history.at,
        actor: history.actor,
        origin: history.origin,
        action: history.action,
        result: history.result,
        args: history.args,
      })
      .from(history)
      .where(eq(history.userId, user.userId))
      .orderBy(desc(history.at), desc(history.id))
      .limit(LIMIT);
    // The Journal names a received webhook by its event; every other entry keeps to its own fields, `args` stay on the server.
    return c.json({
      entries: entries.map(({ args, ...entry }) =>
        entry.action === "receive_webhook"
          ? { ...entry, event: String(args.event) }
          : entry,
      ),
    });
  });
}
