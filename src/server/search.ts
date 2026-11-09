import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db/db.ts";
import {
  projectMembers,
  projects,
  runs,
  tickets,
  userStories,
} from "./db/schema.ts";
import { signedIn } from "./routines.ts";
import { storyStatuses } from "./stories.ts";
import { noNul, ticketStep } from "./tickets.ts";

export const MAX_RESULTS = 20;

/** Rows of a project the user belongs to and has not archived (what the search and `list_tickets_needing_us` look at). */
export const activeOf = (userId: number) =>
  and(eq(projectMembers.userId, userId), isNull(projects.archivedAt));

/** The search of the MCP tool and of the page (decision 073 A): every word must appear, whatever the case, in a project name, a ticket title or a story narrative. `projectId` leaves out the projects and keeps that project's tickets and stories. */
export async function searchWork(
  db: Db,
  userId: number,
  query: string,
  projectId?: number,
) {
  // LIKE wildcards in the query are plain characters.
  const words = query.split(/\s+/).map((w) => w.replace(/[\\%_]/g, "\\$&"));
  const matching = (column: AnyPgColumn | SQL) =>
    and(...words.map((word) => ilike(column, `%${word}%`)));
  const mine = activeOf(userId);
  const found =
    projectId === undefined
      ? await db
          .select({ id: projects.id, fullName: projects.fullName })
          .from(projects)
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(and(mine, matching(projects.fullName)))
          .orderBy(asc(projects.id))
          .limit(MAX_RESULTS)
      : [];
  const foundTickets = await db
    .select({ ticket: tickets })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        mine,
        matching(tickets.title),
        projectId === undefined ? undefined : eq(tickets.projectId, projectId),
      ),
    )
    .orderBy(asc(tickets.id))
    .limit(MAX_RESULTS);
  const foundStories = await db
    .select({ story: userStories, projectId: tickets.projectId })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        mine,
        matching(
          sql`${userStories.asA} || ' ' || ${userStories.iWant} || ' ' || ${userStories.soThat}`,
        ),
        projectId === undefined ? undefined : eq(tickets.projectId, projectId),
      ),
    )
    .orderBy(asc(userStories.id))
    .limit(MAX_RESULTS);
  const statuses = await storyStatuses(
    db,
    foundTickets.map(({ ticket }) => ticket.id),
  );
  return {
    projects: found,
    tickets: foundTickets.map(({ ticket }) => ({
      id: ticket.id,
      title: ticket.title,
      projectId: ticket.projectId,
      step: ticketStep(ticket, statuses.get(ticket.id) ?? []),
    })),
    stories: foundStories.map(({ story, projectId }) => ({
      id: story.id,
      title: story.iWant,
      projectId,
      ticketId: story.ticketId,
      status: story.status,
    })),
  };
}

const query = z.string().trim().min(2).max(200).refine(noNul);

/** The page's search (decision 073 A): the groups of the MCP tool, plus the runs of the stories found and the run whose number is typed (« 17 » or « run 17 »). */
export function searchRoutes(db: Db) {
  return new Hono<{ Variables: { userId: number } }>()
    .use("/api/search", signedIn(db))
    .get("/api/search", async (c) => {
      const parsed = query.safeParse(c.req.query("q"));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const userId = c.get("userId");
      const found = await searchWork(db, userId, parsed.data);
      const number = /^(?:run\s+)?(\d{1,9})$/i.exec(parsed.data)?.[1];
      const byStory = found.stories.map((s) => s.id);
      const foundRuns =
        number === undefined && byStory.length === 0
          ? []
          : await db
              .select({
                id: runs.id,
                storyId: runs.storyId,
                projectId: tickets.projectId,
                status: runs.status,
              })
              .from(runs)
              .innerJoin(userStories, eq(userStories.id, runs.storyId))
              .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
              .innerJoin(projects, eq(projects.id, tickets.projectId))
              .innerJoin(
                projectMembers,
                eq(projectMembers.projectId, projects.id),
              )
              .where(
                and(
                  activeOf(userId),
                  or(
                    number === undefined
                      ? undefined
                      : eq(runs.id, Number(number)),
                    byStory.length === 0
                      ? undefined
                      : inArray(runs.storyId, byStory),
                  ),
                ),
              )
              .orderBy(desc(runs.id))
              .limit(MAX_RESULTS);
      return c.json({ ...found, runs: foundRuns });
    });
}
