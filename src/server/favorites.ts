import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db/db.ts";
import { projectMembers, users } from "./db/schema.ts";
import { isDatabaseId } from "./projects.ts";
import { signedIn } from "./routines.ts";
import { body } from "./tickets.ts";

/** The star of a project and the theme of the user (decision 073 F, H): preferences of the user, so no history entry (like the notification switches). */
export function favoriteRoutes(db: Db) {
  return new Hono<{ Variables: { userId: number } }>()
    .use("/api/projects/:id/favorite", signedIn(db))
    .use("/api/me/theme", signedIn(db))
    .put(
      "/api/projects/:id/favorite",
      body(z.object({ favorite: z.boolean() })),
      async (c) => {
        const id = Number(c.req.param("id"));
        const { favorite } = c.req.valid("json");
        // Only the caller's own membership matches: someone else's project looks like no project.
        const [row] = isDatabaseId(id)
          ? await db
              .update(projectMembers)
              .set({ favorite })
              .where(
                and(
                  eq(projectMembers.projectId, id),
                  eq(projectMembers.userId, c.get("userId")),
                ),
              )
              .returning({ favorite: projectMembers.favorite })
          : [];
        return row ? c.json(row) : c.json({ error: "Not found" }, 404);
      },
    )
    .put(
      "/api/me/theme",
      body(z.object({ theme: z.enum(["dark", "light", "system"]) })),
      async (c) => {
        const [row] = await db
          .update(users)
          .set(c.req.valid("json"))
          .where(eq(users.id, c.get("userId")))
          .returning({ theme: users.theme });
        return c.json(row);
      },
    );
}
