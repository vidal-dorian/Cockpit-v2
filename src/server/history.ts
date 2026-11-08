import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { history, projects } from "./db/schema.ts";

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 10_000;
const MAX_ID = 2147483647;
const RESULTS = ["ok", "refused", "error"] as const;

// Decision 053 A: every filter is optional; an empty or unknown value is invalid, never "absent".
const filtersSchema = z.object({
  project: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((id) => id <= MAX_ID)
    .optional(),
  action: z.string().min(1).optional(),
  actor: z.enum(["human", "claude", "github", "system"]).optional(),
  origin: z.enum(["ui", "mcp", "webhook", "system"]).optional(),
  result: z
    .string()
    .transform((list) => list.split(","))
    .pipe(z.array(z.enum(RESULTS)))
    .optional(),
  since: z.iso
    .datetime({ offset: true })
    .transform((date) => new Date(date))
    .optional(),
  q: z.string().min(1).max(100).optional(),
});

/** The conditions of the caller's own entries (decision 010 G) that match the filters; shared by the list and the export. */
function filterConditions(
  userId: number,
  f: z.output<typeof filtersSchema>,
): SQL[] {
  const conditions: SQL[] = [eq(history.userId, userId)];
  if (f.project !== undefined)
    conditions.push(eq(history.projectId, f.project));
  if (f.action !== undefined) conditions.push(eq(history.action, f.action));
  if (f.actor !== undefined) conditions.push(eq(history.actor, f.actor));
  if (f.origin !== undefined) conditions.push(eq(history.origin, f.origin));
  if (f.result !== undefined)
    conditions.push(inArray(history.result, f.result));
  if (f.since !== undefined) conditions.push(sql`${history.at} >= ${f.since}`);
  if (f.q !== undefined) {
    const number = /^#?(\d+)$/.exec(f.q)?.[1];
    // A number is a number only (ids, flat args values, decision 010 D); a text is looked for in the action and the code, by strpos so `%` and `_` stay plain.
    conditions.push(
      number !== undefined
        ? sql`(${history.ticketId}::numeric = ${number}::numeric or ${history.storyId}::numeric = ${number}::numeric or ${history.runId}::numeric = ${number}::numeric
            or exists (select 1 from jsonb_each(${history.args}) e where e.value = to_jsonb(${number}::numeric)))`
        : sql`(strpos(lower(${history.action}), lower(${f.q})) > 0 or strpos(lower(${history.detail}->>'reason'), lower(${f.q})) > 0)`,
    );
  }
  return conditions;
}

const csvCell = (value: string | number | null) => {
  let text = value === null ? "" : String(value);
  // A spreadsheet runs a cell that starts like a formula: the apostrophe goes before the quoting.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function historyRoutes(db: Db) {
  return new Hono()
    .get("/api/history", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const filters = filtersSchema.safeParse(c.req.query());
      if (!filters.success) return c.json({ error: "invalid_filter" }, 400);

      // `before` is the id of the last entry displayed; it must be one of the caller's own (decision 028 F).
      const before = c.req.query("before");
      let after: SQL | undefined;
      if (before !== undefined) {
        // A PostgreSQL integer: anything larger names no entry, and the query must not run (it would fail).
        const id = /^[1-9]\d*$/.test(before) ? Number(before) : Number.NaN;
        const [cursor] =
          Number.isSafeInteger(id) && id <= MAX_ID
            ? await db
                .select({ id: history.id })
                .from(history)
                .where(and(eq(history.id, id), eq(history.userId, user.userId)))
            : [];
        if (!cursor) return c.json({ error: "invalid_cursor" }, 400);
        // Compared by the database, never through a JS Date: `at` has microseconds, a Date only milliseconds.
        after = sql`(${history.at}, ${history.id}) < (select h.at, h.id from ${history} h where h.id = ${cursor.id})`;
      }

      // One more than a page tells whether there is a next one.
      const rows = await db
        .select({
          id: history.id,
          at: history.at,
          actor: history.actor,
          origin: history.origin,
          action: history.action,
          result: history.result,
          project: projects.fullName,
          projectId: history.projectId,
          ticketId: history.ticketId,
          storyId: history.storyId,
          runId: history.runId,
          args: history.args,
          detail: history.detail,
        })
        .from(history)
        .leftJoin(projects, eq(projects.id, history.projectId))
        .where(and(...filterConditions(user.userId, filters.data), after))
        .orderBy(desc(history.at), desc(history.id))
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);

      // Decision 053 D: the first later entry of the same user, actor, action and project, within the hour; looked up among all the user's entries.
      const failed = page.filter((e) => e.result !== "ok").map((e) => e.id);
      const h = alias(history, "h");
      const r = alias(history, "r");
      const next = db
        .select({ id: r.id, at: r.at, result: r.result })
        .from(r)
        .where(
          and(
            eq(r.userId, h.userId),
            eq(r.actor, h.actor),
            eq(r.action, h.action),
            sql`${r.projectId} is not distinct from ${h.projectId}`,
            sql`(${r.at}, ${r.id}) > (${h.at}, ${h.id})`,
            sql`${r.at} <= ${h.at} + interval '1 hour'`,
          ),
        )
        .orderBy(asc(r.at), asc(r.id))
        .limit(1)
        .as("next");
      const retries = new Map(
        failed.length === 0
          ? []
          : (
              await db
                .select({
                  of: h.id,
                  id: next.id,
                  at: next.at,
                  result: next.result,
                })
                .from(h)
                .leftJoinLateral(next, sql`true`)
                .where(inArray(h.id, failed))
            ).map(({ of, id, at, result }) => [
              of,
              // The left join gives nulls when no retry follows.
              id === null || at === null || result === null
                ? null
                : { id, at, result },
            ]),
      );

      // The Journal names a received webhook by its event.
      return c.json({
        entries: page.map((entry) => ({
          ...entry,
          ...(retries.has(entry.id) && { retry: retries.get(entry.id) }),
          ...(entry.action === "receive_webhook" && {
            event: String(entry.args.event),
          }),
        })),
        hasMore: rows.length > PAGE_SIZE,
      });
    })
    .get("/api/history/export", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const filters = filtersSchema.safeParse(c.req.query());
      if (!filters.success) return c.json({ error: "invalid_filter" }, 400);

      const rows = await db
        .select({
          at: history.at,
          actor: history.actor,
          origin: history.origin,
          action: history.action,
          result: history.result,
          detail: history.detail,
          project: projects.fullName,
          ticketId: history.ticketId,
          storyId: history.storyId,
          runId: history.runId,
          args: history.args,
        })
        .from(history)
        .leftJoin(projects, eq(projects.id, history.projectId))
        .where(and(...filterConditions(user.userId, filters.data)))
        .orderBy(desc(history.at), desc(history.id))
        .limit(EXPORT_LIMIT);

      const lines = [
        "date,acteur,origine,action,resultat,code,projet,ticket,us,run,arguments",
        ...rows.map((e) =>
          [
            e.at.toISOString(),
            e.actor,
            e.origin,
            e.action,
            e.result,
            e.detail?.reason ?? null,
            e.project,
            e.ticketId,
            e.storyId,
            e.runId,
            JSON.stringify(e.args),
          ]
            .map(csvCell)
            .join(","),
        ),
      ];
      return c.body(`${lines.join("\r\n")}\r\n`, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="journal-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      });
    });
}
