import { desc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { projects, tickets, userStories } from "./db/schema.ts";
import { isDatabaseId, memberProject } from "./projects.ts";
import { type StoryStatus, storyStatuses, ticketStories } from "./stories.ts";

const unauthorized = { error: "Unauthorized" };
const notFound = { error: "Not found" };

// Limits of decision 014; the title is trimmed first, the description is kept as typed.
// PostgreSQL text cannot hold a NUL character: it is refused here, not left to fail as a 500.
export const noNul = (text: string) => !text.includes("\0");
export const title = z.string().trim().min(1).max(200).refine(noNul);
export const descriptionMd = z.string().max(50_000).refine(noNul);
const createBody = z.object({ title, descriptionMd: descriptionMd.optional() });
const editBody = z
  .object({ title: title.optional(), descriptionMd: descriptionMd.optional() })
  .refine((body) => Object.keys(body).length > 0);

/** A zod schema as a route validator: a body that does not fit is a 400, before any work and any history entry. */
const body = <T extends z.ZodType>(schema: T) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: "Bad request" }, 400);
    return parsed.data as z.output<T>;
  });

/** The step of a ticket (decision 002): computed from the ticket and the statuses of its stories, the first rule that applies wins. */
export function ticketStep(
  ticket: Pick<typeof tickets.$inferSelect, "abandonedAt">,
  statuses: StoryStatus[],
) {
  const any = (...wanted: StoryStatus[]) =>
    statuses.some((status) => wanted.includes(status));
  const only = (...wanted: StoryStatus[]) =>
    statuses.every((status) => wanted.includes(status));
  if (ticket.abandonedAt || (statuses.length > 0 && only("abandoned")))
    return "abandoned";
  if (statuses.length === 0) return "new";
  if (any("in_progress", "in_review")) return "in_progress";
  if (any("to_validate", "to_rewrite")) return "to_validate";
  if (only("done", "abandoned")) return "done";
  // Left: ready, done and abandoned stories. A done one next to a ready one means the work has begun.
  if (any("done")) return "in_progress";
  return "validated";
}

const present = (t: typeof tickets.$inferSelect, statuses: StoryStatus[]) => ({
  id: t.id,
  projectId: t.projectId,
  title: t.title,
  descriptionMd: t.descriptionMd,
  step: ticketStep(t, statuses),
  storiesWrittenAt: t.storiesWrittenAt,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

/** A ticket the user may reach, with its project; undefined for anyone else, as if it did not exist (decisions 002 and 011 E). */
export async function memberTicket(db: Db, userId: number, id: number) {
  if (!isDatabaseId(id)) return undefined;
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
  const project = ticket && (await memberProject(db, userId, ticket.projectId));
  return project && { ticket, project };
}

/** Read-only once archived (decision 014 D). Called inside the transaction of the action: `for share` makes a concurrent archiving wait for it, so none slips between the check and the write. */
export async function assertActive(tx: Tx, projectId: number) {
  const [project] = await tx
    .select({ archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("share");
  if (project?.archivedAt) throw new Refused("project_archived");
}

/** Creates a ticket of a project the caller already knows to be theirs, in one `act` (shared by the UI and the MCP tool). `entry` carries who acts; the new ticket fills `ticketId` and `args`. */
export function createTicket(
  db: Db,
  entry: Entry,
  projectId: number,
  fields: { title: string; descriptionMd?: string },
) {
  return act(db, entry, async (tx) => {
    await assertActive(tx, projectId);
    const [row] = await tx
      .insert(tickets)
      .values({ projectId, ...fields })
      .returning();
    if (!row) throw new Error("ticket not created");
    entry.ticketId = row.id;
    entry.args = { ticketId: row.id };
    return row;
  });
}

/** A refusal of `act` as an answer; any other error is not ours. */
function refusal(c: Context, error: unknown) {
  if (!(error instanceof Refused)) throw error;
  if (
    error.message === "project_archived" ||
    error.message === "ticket_has_stories"
  )
    return c.json({ error: error.message }, 409);
  return c.json(notFound, 404);
}

/** Behind the gate of `projectRoutes` (503 before the session check), which also covers /api/tickets/*. */
export function ticketRoutes(db: Db) {
  const entryOf = (userId: number, action: string): Entry => ({
    userId,
    actor: "human",
    origin: "ui",
    action,
    args: {},
  });

  return new Hono()
    .get("/api/projects/:id/tickets", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json(notFound, 404);
      const rows = await db
        .select()
        .from(tickets)
        .where(eq(tickets.projectId, project.id))
        .orderBy(desc(tickets.id));
      const statuses = await storyStatuses(
        db,
        rows.map((t) => t.id),
      );
      return c.json({
        tickets: rows.map((t) => present(t, statuses.get(t.id) ?? [])),
      });
    })
    .post("/api/projects/:id/tickets", body(createBody), async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json(notFound, 404);

      const entry: Entry = {
        ...entryOf(user.userId, "create_ticket"),
        projectId: project.id,
      };
      try {
        const created = await createTicket(
          db,
          entry,
          project.id,
          c.req.valid("json"),
        );
        return c.json({ ticket: present(created, []) }, 201);
      } catch (error) {
        return refusal(c, error);
      }
    })
    .get("/api/tickets/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberTicket(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json(notFound, 404);
      const stories = await ticketStories(db, found.ticket.id);
      return c.json({
        ticket: present(
          found.ticket,
          stories.map((s) => s.status),
        ),
        stories,
      });
    })
    .patch("/api/tickets/:id", body(editBody), async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberTicket(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json(notFound, 404);

      const { ticket, project } = found;
      const entry: Entry = {
        ...entryOf(user.userId, "update_ticket"),
        projectId: project.id,
        ticketId: ticket.id,
        args: { ticketId: ticket.id },
      };
      try {
        const updated = await act(db, entry, async (tx) => {
          await assertActive(tx, project.id);
          const [row] = await tx
            .update(tickets)
            .set({ ...c.req.valid("json"), updatedAt: sql`now()` })
            .where(eq(tickets.id, ticket.id))
            .returning();
          // Deleted since we read it.
          if (!row) throw new Refused("not_found");
          return row;
        });
        const statuses = await storyStatuses(db, [updated.id]);
        return c.json({
          ticket: present(updated, statuses.get(updated.id) ?? []),
        });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .delete("/api/tickets/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberTicket(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json(notFound, 404);

      const { ticket, project } = found;
      const entry: Entry = {
        ...entryOf(user.userId, "delete_ticket"),
        projectId: project.id,
        ticketId: ticket.id,
        args: { ticketId: ticket.id },
      };
      try {
        await act(db, entry, async (tx) => {
          await assertActive(tx, project.id);
          // Decision 002 rule 2: only a ticket without story is deleted. The row is locked, so a create_user_stories in flight cannot slip in between the check and the delete.
          const [locked] = await tx
            .select({ id: tickets.id })
            .from(tickets)
            .where(eq(tickets.id, ticket.id))
            .for("update");
          if (!locked) throw new Refused("not_found");
          const [story] = await tx
            .select({ id: userStories.id })
            .from(userStories)
            .where(eq(userStories.ticketId, ticket.id))
            .limit(1);
          if (story) throw new Refused("ticket_has_stories");
          const deleted = await tx
            .delete(tickets)
            .where(eq(tickets.id, ticket.id))
            .returning({ id: tickets.id });
          if (deleted.length === 0) throw new Refused("not_found");
        });
        return c.body(null, 204);
      } catch (error) {
        return refusal(c, error);
      }
    });
}
