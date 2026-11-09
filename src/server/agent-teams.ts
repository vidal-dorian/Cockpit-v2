import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act } from "./action.ts";
import type { Db } from "./db/db.ts";
import { agentTeams } from "./db/schema.ts";
import { entryOf, signedIn } from "./routines.ts";
import { AGENT_NAME, MAX_TEAM_NAME, parseTeam } from "./team.ts";
import { body } from "./tickets.ts";

const MAX_TEXT = 1024 * 1024;
const putBody = z.object({
  text: z
    .string()
    .refine((text) => Buffer.byteLength(text) <= MAX_TEXT)
    .refine((text) => parseTeam(text) !== null),
});

/** Decision 072 B: the agent teams of the user, in the `team.md` format; only theirs are visible or writable. */
export function agentTeamRoutes(db: Db) {
  const signed = signedIn(db);
  return new Hono<{ Variables: { userId: number } }>()
    .use("/api/agent-teams", signed)
    .use("/api/agent-teams/*", signed)
    .get("/api/agent-teams", async (c) =>
      c.json({
        teams: await db
          .select({
            id: agentTeams.id,
            name: agentTeams.name,
            text: agentTeams.text,
          })
          .from(agentTeams)
          .where(eq(agentTeams.userId, c.get("userId")))
          .orderBy(agentTeams.name),
      }),
    )
    .put("/api/agent-teams/:name", body(putBody), async (c) => {
      const name = c.req.param("name");
      if (!AGENT_NAME.test(name) || name.length > MAX_TEAM_NAME)
        return c.json({ error: "Bad request" }, 400);
      const userId = c.get("userId");
      const { text } = c.req.valid("json");
      const entry = entryOf(userId, "save_agent_team");
      const saved = await act(db, entry, async (tx) => {
        const [row] = await tx
          .insert(agentTeams)
          .values({ userId, name, text })
          .onConflictDoUpdate({
            target: [agentTeams.userId, agentTeams.name],
            set: { text, updatedAt: new Date() },
          })
          .returning({ id: agentTeams.id });
        entry.args = { teamId: (row as { id: number }).id };
        return row as { id: number };
      });
      return c.json({ id: saved.id, name, text });
    })
    .delete("/api/agent-teams/:name", async (c) => {
      const userId = c.get("userId");
      const name = c.req.param("name");
      const mine = and(
        eq(agentTeams.userId, userId),
        eq(agentTeams.name, name),
      );
      // Looked up before `act`: an unknown team leaves no history entry.
      const [team] = await db
        .select({ id: agentTeams.id })
        .from(agentTeams)
        .where(mine);
      if (!team) return c.json({ error: "Not found" }, 404);
      await act(
        db,
        { ...entryOf(userId, "delete_agent_team"), args: { teamId: team.id } },
        (tx) => tx.delete(agentTeams).where(mine),
      );
      return c.json({ ok: true });
    });
}
