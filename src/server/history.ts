import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { history } from "./db/schema.ts";

const PAGE_SIZE = 25;

export function historyRoutes(db: Db) {
  return new Hono().get("/api/history", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    // `before` is the id of the last entry displayed; it must be one of the caller's own (decision 028 F).
    const before = c.req.query("before");
    let after: ReturnType<typeof or> | undefined;
    if (before !== undefined) {
      const id = /^[1-9]\d*$/.test(before) ? Number(before) : Number.NaN;
      const [cursor] = Number.isSafeInteger(id)
        ? await db
            .select({ id: history.id, at: history.at })
            .from(history)
            .where(and(eq(history.id, id), eq(history.userId, user.userId)))
        : [];
      if (!cursor) return c.json({ error: "invalid_cursor" }, 400);
      after = or(
        lt(history.at, cursor.at),
        and(eq(history.at, cursor.at), lt(history.id, cursor.id)),
      );
    }

    // Only the caller's own entries; entries without a user are for nobody yet (decision 010 G).
    // One more than a page tells whether there is a next one.
    const rows = await db
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
      .where(and(eq(history.userId, user.userId), after))
      .orderBy(desc(history.at), desc(history.id))
      .limit(PAGE_SIZE + 1);
    // The Journal names a received webhook by its event; every other entry keeps to its own fields, `args` stay on the server.
    return c.json({
      entries: rows
        .slice(0, PAGE_SIZE)
        .map(({ args, ...entry }) =>
          entry.action === "receive_webhook"
            ? { ...entry, event: String(args.event) }
            : entry,
        ),
      hasMore: rows.length > PAGE_SIZE,
    });
  });
}
