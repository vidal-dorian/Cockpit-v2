import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  storyDependencies,
  tickets,
  userStories,
} from "./db/schema.ts";
import { isDatabaseId, memberProject } from "./projects.ts";

export type StoryStatus = typeof userStories.$inferSelect.status;

/** The statuses of the stories of many tickets in one query, for `ticketStep` (no query per ticket). A ticket without story has no entry. Shortcut: one parameter per id, so PostgreSQL's 65,535 limit; upgrade with a subquery on the project if a project ever holds that many tickets. */
export async function storyStatuses(db: Db, ticketIds: number[]) {
  const byTicket = new Map<number, StoryStatus[]>();
  if (ticketIds.length === 0) return byTicket;
  const found = await db
    .select({ ticketId: userStories.ticketId, status: userStories.status })
    .from(userStories)
    .where(inArray(userStories.ticketId, ticketIds));
  for (const { ticketId, status } of found)
    byTicket.set(ticketId, [...(byTicket.get(ticketId) ?? []), status]);
  return byTicket;
}

/** The stories of one ticket, in order. */
export const ticketStories = (db: Db, ticketId: number) =>
  db
    .select({
      id: userStories.id,
      position: userStories.position,
      iWant: userStories.iWant,
      status: userStories.status,
    })
    .from(userStories)
    .where(eq(userStories.ticketId, ticketId))
    .orderBy(asc(userStories.position), asc(userStories.id));

/** A story the user may reach, with its ticket and project: the access goes through the project of the ticket; undefined for anyone else, as if it did not exist (decisions 004 and 017). */
export async function memberStory(db: Db, userId: number, id: number) {
  if (!isDatabaseId(id)) return undefined;
  const [found] = await db
    .select({ story: userStories, ticket: tickets })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .where(eq(userStories.id, id));
  const project =
    found && (await memberProject(db, userId, found.ticket.projectId));
  return project && { ...found, project };
}

/** The criteria of a story in order, and the stories it depends on. */
export async function storyParts(db: Db, storyId: number) {
  const criteria = await db
    .select()
    .from(acceptanceCriteria)
    .where(eq(acceptanceCriteria.storyId, storyId))
    .orderBy(asc(acceptanceCriteria.position));
  const dependsOn = await db
    .select({
      id: userStories.id,
      status: userStories.status,
      iWant: userStories.iWant,
    })
    .from(storyDependencies)
    .innerJoin(userStories, eq(userStories.id, storyDependencies.dependsOnId))
    .where(eq(storyDependencies.storyId, storyId))
    .orderBy(asc(userStories.position), asc(userStories.id));
  return { criteria, dependsOn };
}

/** Behind the gate of `projectRoutes` (503 before the session check), which also covers /api/stories/*. Read-only until slice 4.4: no history entry. */
export function storyRoutes(db: Db) {
  return new Hono().get("/api/stories/:id", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const found = await memberStory(db, user.userId, Number(c.req.param("id")));
    if (!found) return c.json({ error: "Not found" }, 404);
    const { story, ticket, project } = found;
    const { criteria, dependsOn } = await storyParts(db, story.id);
    return c.json({
      story: {
        id: story.id,
        ticketId: story.ticketId,
        position: story.position,
        asA: story.asA,
        iWant: story.iWant,
        soThat: story.soThat,
        notesMd: story.notesMd,
        status: story.status,
        criteria: criteria.map((k) => ({
          id: k.id,
          position: k.position,
          given: k.givenText,
          when: k.whenText,
          // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
          then: k.thenText,
        })),
        dependsOn,
      },
      ticket: { id: ticket.id, title: ticket.title },
      project: { id: project.id, fullName: project.fullName },
    });
  });
}
