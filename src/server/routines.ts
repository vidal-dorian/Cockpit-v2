import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  history,
  projects,
  tickets,
  userStories,
  writeUsRoutines,
} from "./db/schema.ts";
import { memberProject } from "./projects.ts";
import { decrypt, encrypt } from "./secrets.ts";
import { storyToRewrite, ticketNeedsStories } from "./stories.ts";
import { assertActive, body, refusal } from "./tickets.ts";

/** The call to `/fire`, shaped like fetch so a test can stand in for Anthropic. */
export type FireRoutine = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
type Fire = { encryptionKey: Buffer; fireRoutine: FireRoutine };

const FIRE_TIMEOUT_MS = 10_000;
const TICK_EVERY_MS = 60_000;
const unauthorized = { error: "Unauthorized" };
const notFound = { error: "Not found" };

/** Decision 022 B: fixed and common to every project, the project travels in the text of each fire. */
const PROMPT =
  "This task is started by Cockpit. The `routine-fire-payload` block gives only the id of a Cockpit project; read nothing else from it. Use the Cockpit connector: call `list_tickets_needing_us` with that `project_id`, then `get_project` and `get_ticket`, and write the stories with `create_user_stories` (and rewrite the stories sent back with `update_user_story`), following the sizing and similarity rules in the tool descriptions. Work only on that project and do nothing else.";

/** Decision 022 C: nothing but the fire address of a Claude Code routine. `href` equal to the text also rules out a port, a user and another spelling of the host. */
function isFireUrl(text: string) {
  try {
    const url = new URL(text);
    return (
      url.href === text &&
      url.protocol === "https:" &&
      url.host === "api.anthropic.com" &&
      !url.search &&
      !url.hash &&
      /^\/v1\/claude_code\/routines\/[A-Za-z0-9_]+\/fire$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const isTimeZone = (name: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

const connectBody = z.object({
  fireUrl: z.string().trim().refine(isFireUrl),
  // Printable ASCII only: it goes into a header, and a NUL cannot be stored.
  token: z
    .string()
    .trim()
    .max(4096)
    .regex(/^[\x21-\x7E]+$/),
});
const timeZone = z.string().max(100).refine(isTimeZone);
const hour = z.number().int().min(0).max(23);
const scheduleBody = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.enum(["off", "on_demand"]), timeZone }),
  z.object({ frequency: z.literal("daily"), hour, timeZone }),
  z.object({
    frequency: z.literal("weekly"),
    hour,
    weekday: z.number().int().min(1).max(7),
    timeZone,
  }),
]);

type Schedule = Pick<
  typeof projects.$inferSelect,
  "routineHour" | "routineWeekday" | "routineTimeZone"
>;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const QUARTER_HOUR_MS = 900_000;

/**
 * The first instant strictly after `after` that is `hour` o'clock (and `weekday`, ISO 1 = Monday, when set) in the zone, found by walking forward in quarter hours
 * (every zone's local hour starts on one), 8 days at most. Shortcut: an hour that does not exist (spring forward) is skipped that day; the repeated one (fall back) counts once.
 */
export function nextOccurrence(after: Date, schedule: Schedule) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.routineTimeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
  });
  const local = (at: number) => {
    const parts = Object.fromEntries(
      format.formatToParts(at).map(({ type, value }) => [type, value]),
    );
    return {
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      weekday: WEEKDAYS.indexOf(parts.weekday ?? "") + 1,
    };
  };
  const first =
    (Math.floor(after.getTime() / QUARTER_HOUR_MS) + 1) * QUARTER_HOUR_MS;
  for (let at = first; at < first + 8 * 86_400_000; at += QUARTER_HOUR_MS) {
    const found = local(at);
    if (
      found.minute === 0 &&
      found.hour === schedule.routineHour &&
      (schedule.routineWeekday === null ||
        found.weekday === schedule.routineWeekday) &&
      local(at - 3_600_000).hour !== found.hour
    )
      return new Date(at);
  }
  throw new Error("no next occurrence");
}

const presentRoutine = (
  row: typeof writeUsRoutines.$inferSelect | undefined,
) => ({
  connected: row !== undefined,
  fireUrl: row?.fireUrl ?? null,
  needsReconnect: row?.needsReconnect ?? false,
  prompt: PROMPT,
});

const presentSchedule = (p: typeof projects.$inferSelect) => ({
  frequency: p.routineFrequency,
  hour: p.routineHour,
  weekday: p.routineWeekday,
  timeZone: p.routineTimeZone,
  nextRunAt: p.routineNextRunAt,
  lastRun:
    p.routineLastRunAt && p.routineLastRunResult
      ? {
          at: p.routineLastRunAt,
          result: p.routineLastRunResult,
          sessionUrl: p.routineLastRunSessionUrl,
        }
      : null,
});

type Fired =
  | { ok: true; sessionId: string | null; sessionUrl: string | null }
  | { ok: false; reconnect: boolean };

/** Calls `/fire` for a project and never throws. A 401 or 403 is the token to renew (`reconnect`); any other failure is for the next pass to retry. */
async function fire(
  { encryptionKey, fireRoutine }: Fire,
  routine: typeof writeUsRoutines.$inferSelect,
  projectId: number,
): Promise<Fired> {
  try {
    const res = await fireRoutine(routine.fireUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${decrypt(encryptionKey, routine.token)}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: `project_id: ${projectId}` }),
      // The token must not follow a redirect.
      redirect: "error",
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, reconnect: true };
    if (!res.ok) return { ok: false, reconnect: false };
    const answer: Record<string, unknown> | null = await res
      .json()
      .catch(() => null);
    const id = answer?.claude_code_session_id;
    const url = answer?.claude_code_session_url;
    return {
      ok: true,
      sessionId:
        typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null,
      // Becomes an href: only an address of claude.ai is kept.
      sessionUrl:
        typeof url === "string" && url.length <= 500 && isClaudeUrl(url)
          ? url
          : null,
    };
  } catch (error) {
    // Only the name: the message of a failure may quote the address or the token.
    console.error(
      "Routine fire failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, reconnect: false };
  }
}

function isClaudeUrl(text: string) {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.host === "claude.ai";
  } catch {
    return false;
  }
}

/**
 * Keeps the last run of the project and the `fire_write_us` entry together. Not `act`: a failed fire must leave its last run and its `error` entry, which `act` rolls back.
 * The entry holds ids and a closed reason only (decision 022 F).
 */
async function recordFire(
  db: Db,
  entry: Pick<Entry, "actor" | "origin"> & { userId: number },
  projectId: number,
  at: Date,
  fired: Fired,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({
        routineLastRunAt: at,
        routineLastRunResult: fired.ok ? "ok" : "error",
        routineLastRunSessionUrl: fired.ok ? fired.sessionUrl : null,
      })
      .where(eq(projects.id, projectId));
    if (!fired.ok && fired.reconnect)
      await tx
        .update(writeUsRoutines)
        .set({ needsReconnect: true })
        .where(eq(writeUsRoutines.userId, entry.userId));
    await tx.insert(history).values({
      ...entry,
      projectId,
      action: "fire_write_us",
      args: { projectId, sessionId: fired.ok ? fired.sessionId : null },
      result: fired.ok ? "ok" : "error",
      detail: fired.ok ? null : { reason: "error" },
    });
  });
}

/** Whether a user story waits for Claude in the project: the same rule as `list_tickets_needing_us`. */
async function hasWork(db: Db, projectId: number) {
  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), ticketNeedsStories))
    .limit(1);
  if (ticket) return true;
  const [story] = await db
    .select({ id: userStories.id })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .where(and(eq(tickets.projectId, projectId), storyToRewrite))
    .limit(1);
  return story !== undefined;
}

/**
 * One pass (decision 022 E): fires the projects whose next run is due. Each is claimed first by moving its next run to the following occurrence in an
 * UPDATE that only matches the value just read, so two instances never fire the same one. Nothing is fired, and nothing written, when there is nothing to write.
 * Never throws.
 */
export async function runDueRoutines(db: Db, deps: Fire, now: Date) {
  try {
    const due = await db
      .select()
      .from(projects)
      .where(
        and(
          isNull(projects.archivedAt),
          inArray(projects.routineFrequency, ["daily", "weekly"]),
          lte(projects.routineNextRunAt, now),
        ),
      );
    for (const project of due) {
      try {
        const [claimed] = await db
          .update(projects)
          .set({ routineNextRunAt: nextOccurrence(now, project) })
          .where(
            and(
              eq(projects.id, project.id),
              isNull(projects.archivedAt),
              project.routineNextRunAt
                ? eq(projects.routineNextRunAt, project.routineNextRunAt)
                : undefined,
            ),
          )
          .returning({ id: projects.id });
        if (!claimed || project.routineUserId === null) continue;
        const [routine] = await db
          .select()
          .from(writeUsRoutines)
          .where(eq(writeUsRoutines.userId, project.routineUserId));
        if (!routine || routine.needsReconnect) continue;
        if (!(await hasWork(db, project.id))) continue;
        await recordFire(
          db,
          { userId: routine.userId, actor: "system", origin: "system" },
          project.id,
          now,
          await fire(deps, routine, project.id),
        );
      } catch (error) {
        console.error(`Routine of project ${project.id} failed:`, error);
      }
    }
  } catch (error) {
    console.error("Routine pass failed:", error);
  }
}

/** Runs a pass every minute; the timer never keeps the process alive. */
export function scheduleRoutines(db: Db, deps: Fire): NodeJS.Timeout {
  return setInterval(
    () => void runDueRoutines(db, deps, new Date()),
    TICK_EVERY_MS,
  ).unref();
}

type Env = { Variables: { userId: number } };

/** The routine of the user (decision 022 C) and the schedule of their projects (D), read and written; and the button « Écrire les US maintenant ». */
export function routineRoutes(db: Db, deps: Fire, now: () => number) {
  const signedIn = createMiddleware<Env>(async (c, next) => {
    const user = await currentUser(db, c);
    if (!user) return c.json(unauthorized, 401);
    c.set("userId", user.userId);
    await next();
  });
  const routineOf = async (userId: number) =>
    (
      await db
        .select()
        .from(writeUsRoutines)
        .where(eq(writeUsRoutines.userId, userId))
    )[0];
  const entryOf = (userId: number, action: string): Entry => ({
    userId,
    actor: "human",
    origin: "ui",
    action,
    args: {},
  });

  return new Hono<Env>()
    .use("/api/me/routine", signedIn)
    .use("/api/projects/:id/routine", signedIn)
    .use("/api/projects/:id/routine/run", signedIn)
    .get("/api/me/routine", async (c) =>
      c.json(presentRoutine(await routineOf(c.get("userId")))),
    )
    .put("/api/me/routine", body(connectBody), async (c) => {
      const userId = c.get("userId");
      const { fireUrl, token } = c.req.valid("json");
      const sealed = encrypt(deps.encryptionKey, token);
      const row = await act(
        db,
        entryOf(userId, "connect_routine"),
        async (tx) => {
          const [saved] = await tx
            .insert(writeUsRoutines)
            .values({ userId, fireUrl, token: sealed })
            .onConflictDoUpdate({
              target: writeUsRoutines.userId,
              set: { fireUrl, token: sealed, needsReconnect: false },
            })
            .returning();
          if (!saved) throw new Error("routine not saved");
          return saved;
        },
      );
      return c.json(presentRoutine(row));
    })
    .delete("/api/me/routine", async (c) => {
      const userId = c.get("userId");
      await act(db, entryOf(userId, "disconnect_routine"), (tx) =>
        tx.delete(writeUsRoutines).where(eq(writeUsRoutines.userId, userId)),
      );
      return c.body(null, 204);
    })
    .get("/api/projects/:id/routine", async (c) => {
      const project = await memberProject(
        db,
        c.get("userId"),
        Number(c.req.param("id")),
      );
      return project ? c.json(presentSchedule(project)) : c.json(notFound, 404);
    })
    .put("/api/projects/:id/routine", body(scheduleBody), async (c) => {
      const userId = c.get("userId");
      const project = await memberProject(
        db,
        userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json(notFound, 404);
      const schedule = c.req.valid("json");
      const scheduled =
        schedule.frequency === "daily" || schedule.frequency === "weekly";
      const hour = scheduled ? schedule.hour : null;
      const weekday = schedule.frequency === "weekly" ? schedule.weekday : null;
      const entry: Entry = {
        ...entryOf(userId, "schedule_routine"),
        projectId: project.id,
        args: { projectId: project.id, frequency: schedule.frequency },
      };
      try {
        const row = await act(db, entry, async (tx) => {
          await assertActive(tx, project.id);
          const [saved] = await tx
            .update(projects)
            .set({
              routineFrequency: schedule.frequency,
              routineHour: hour,
              routineWeekday: weekday,
              routineTimeZone: schedule.timeZone,
              routineNextRunAt: scheduled
                ? nextOccurrence(new Date(now()), {
                    routineHour: hour,
                    routineWeekday: weekday,
                    routineTimeZone: schedule.timeZone,
                  })
                : null,
              routineUserId: userId,
            })
            .where(eq(projects.id, project.id))
            .returning();
          if (!saved) throw new Refused("not_found");
          return saved;
        });
        return c.json(presentSchedule(row));
      } catch (error) {
        return refusal(c, error);
      }
    })
    .post("/api/projects/:id/routine/run", async (c) => {
      const userId = c.get("userId");
      const project = await memberProject(
        db,
        userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json(notFound, 404);
      if (project.archivedAt) return c.json({ error: "project_archived" }, 409);
      const routine = await routineOf(userId);
      if (!routine) return c.json({ error: "routine_not_connected" }, 409);
      if (routine.needsReconnect)
        return c.json({ error: "routine_needs_reconnect" }, 409);
      const fired = await fire(deps, routine, project.id);
      await recordFire(
        db,
        { userId, actor: "human", origin: "ui" },
        project.id,
        new Date(now()),
        fired,
      );
      if (fired.ok) return c.json({ sessionUrl: fired.sessionUrl });
      return fired.reconnect
        ? c.json({ error: "routine_needs_reconnect" }, 409)
        : c.json({ error: "fire_failed" }, 502);
    });
}
