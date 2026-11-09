import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import type { Db } from "./db/db.ts";
import { cloudLaunches, projectMembers, routines } from "./db/schema.ts";
import { isDatabaseId, memberProject } from "./projects.ts";
import {
  entryOf,
  type Fire,
  hour,
  nextOccurrence,
  type Routine,
  runCustomRoutine,
  scheduleOf,
  signedIn,
  timeZone,
} from "./routines.ts";
import { AGENT_NAME } from "./team.ts";
import { body, noNul } from "./tickets.ts";

type Vars = { Variables: { userId: number; routine: Routine } };

const common = {
  name: z.string().trim().min(1).max(100).refine(noNul),
  instruction: z.string().min(1).max(10_000).refine(noNul),
  agents: z.array(z.string().max(255).regex(AGENT_NAME)).max(10),
  projectIds: z
    .array(z.number().int().min(1).max(2_147_483_647))
    .min(1)
    .max(100),
  timeZone,
};
// Decision 056 A: the rules of the planning of decision 022 D, for a routine of its own.
const routineBody = z.discriminatedUnion("frequency", [
  z.object({ ...common, frequency: z.literal("on_demand") }),
  z.object({ ...common, frequency: z.literal("daily"), hour }),
  z.object({
    ...common,
    frequency: z.literal("weekly"),
    hour,
    weekday: z.number().int().min(1).max(7),
  }),
]);

/** A refusal of `act` as an answer: an unknown routine or project is 404, the rest is a conflict. */
function refused(c: Context, error: unknown) {
  if (!(error instanceof Refused)) throw error;
  return error.message === "not_found"
    ? c.json({ error: "Not found" }, 404)
    : c.json({ error: error.message }, 409);
}

/** The routines of the user (decision 056 G), only theirs: another user's routine is not found. */
export function customRoutineRoutes(db: Db, deps: Fire, now: () => number) {
  // Before the body is read: another user's routine is not found whatever is sent.
  const owned = createMiddleware<Vars>(async (c, next) => {
    const id = Number(c.req.param("id"));
    const [routine] = isDatabaseId(id)
      ? await db
          .select()
          .from(routines)
          .where(and(eq(routines.id, id), eq(routines.userId, c.get("userId"))))
      : [];
    if (!routine) return c.json({ error: "Not found" }, 404);
    c.set("routine", routine);
    await next();
  });

  /** The routines of the user (one by `id`), each with its last launch. */
  const present = async (userId: number, id?: number) => {
    const last = await db
      .selectDistinctOn([cloudLaunches.routineId], {
        routineId: cloudLaunches.routineId,
        at: cloudLaunches.createdAt,
        outcome: cloudLaunches.outcome,
        sessionUrl: cloudLaunches.sessionUrl,
        summary: cloudLaunches.summary,
      })
      .from(cloudLaunches)
      .where(
        and(
          eq(cloudLaunches.userId, userId),
          isNotNull(cloudLaunches.routineId),
        ),
      )
      .orderBy(cloudLaunches.routineId, desc(cloudLaunches.id));
    const rows = await db
      .select()
      .from(routines)
      .where(
        and(
          eq(routines.userId, userId),
          id === undefined ? undefined : eq(routines.id, id),
        ),
      )
      .orderBy(routines.id);
    return rows.map(({ userId: _owner, createdAt: _at, ...r }) => {
      const found = last.find((l) => l.routineId === r.id);
      return {
        ...r,
        lastLaunch: found
          ? {
              at: found.at,
              outcome: found.outcome,
              sessionUrl: found.sessionUrl,
              summary: found.summary,
            }
          : null,
      };
    });
  };

  /** One `act` on the routine of the request; the entry has `args: { routineId }` and never the instruction. */
  const change = (
    c: Context<Vars>,
    action: string,
    work: (tx: Tx, routine: Routine) => Promise<unknown>,
  ) => {
    const routine = c.get("routine");
    return act(
      db,
      { ...entryOf(c.get("userId"), action), args: { routineId: routine.id } },
      (tx) => work(tx, routine),
    );
  };

  const next = (
    r: Pick<Routine, "frequency" | "hour" | "weekday" | "timeZone">,
  ) =>
    r.frequency === "on_demand"
      ? null
      : nextOccurrence(new Date(now()), scheduleOf(r));

  /** Creates (no `id`) or updates a routine; its projects are the user's and ticked in the launcher. */
  const save = async (
    c: Context<Vars>,
    input: z.output<typeof routineBody>,
    id?: number,
  ) => {
    const userId = c.get("userId");
    const projectIds = [...new Set(input.projectIds)];
    const entry: Entry = { ...entryOf(userId, "save_routine"), args: {} };
    const values = {
      name: input.name,
      instruction: input.instruction,
      agents: input.agents,
      projectIds,
      frequency: input.frequency,
      hour: "hour" in input ? input.hour : null,
      weekday: "weekday" in input ? input.weekday : null,
      timeZone: input.timeZone,
    };
    // A routine launches Claude on its projects by itself: their owner only (decision 076 A); `app.onError` answers the refusal.
    for (const projectId of projectIds)
      await memberProject(db, userId, projectId, "owner");
    try {
      const saved = await act(db, entry, async (tx) => {
        const members = await tx
          .select({ inLauncher: projectMembers.inLauncher })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.userId, userId),
              inArray(projectMembers.projectId, projectIds),
            ),
          );
        if (members.length < projectIds.length) throw new Refused("not_found");
        if (!members.every((m) => m.inLauncher))
          throw new Refused("project_not_in_launcher");
        const row =
          id === undefined
            ? (
                await tx
                  .insert(routines)
                  .values({ ...values, userId, nextRunAt: next(values) })
                  .returning({ id: routines.id })
              )[0]
            : (
                await tx
                  .update(routines)
                  .set({ ...values, nextRunAt: next(values) })
                  .where(eq(routines.id, id))
                  .returning({ id: routines.id })
              )[0];
        if (!row) throw new Refused("not_found");
        entry.args = { routineId: row.id };
        return row.id;
      });
      return c.json(
        (await present(userId, saved))[0],
        id === undefined ? 201 : 200,
      );
    } catch (error) {
      return refused(c, error);
    }
  };

  const signed = signedIn(db);
  return new Hono<Vars>()
    .use("/api/routines", signed)
    .use("/api/routines/*", signed)
    .use("/api/routines/:id", owned)
    .use("/api/routines/:id/*", owned)
    .get("/api/routines", async (c) =>
      c.json({ routines: await present(c.get("userId")) }),
    )
    .post("/api/routines", body(routineBody), (c) =>
      save(c, c.req.valid("json")),
    )
    .put("/api/routines/:id", body(routineBody), (c) =>
      save(c, c.req.valid("json"), Number(c.req.param("id"))),
    )
    .delete("/api/routines/:id", async (c) => {
      await change(c, "delete_routine", async (tx, routine) => {
        // Its passages go with it: `cloud_launches` points at the routine.
        await tx
          .delete(cloudLaunches)
          .where(eq(cloudLaunches.routineId, routine.id));
        await tx.delete(routines).where(eq(routines.id, routine.id));
      });
      return c.body(null, 204);
    })
    .post("/api/routines/:id/pause", async (c) => {
      await change(c, "pause_routine", (tx, routine) =>
        tx
          .update(routines)
          .set({ pausedAt: new Date(now()) })
          .where(eq(routines.id, routine.id)),
      );
      return c.json({ ok: true });
    })
    .post("/api/routines/:id/resume", async (c) => {
      await change(c, "resume_routine", (tx, routine) =>
        // The next run is looked for again: the one kept may be days old.
        tx
          .update(routines)
          .set({ pausedAt: null, nextRunAt: next(routine) })
          .where(eq(routines.id, routine.id)),
      );
      return c.json({ ok: true });
    })
    .post("/api/routines/:id/run", async (c) => {
      const launched = await runCustomRoutine(
        db,
        deps,
        c.get("routine"),
        { actor: "human", origin: "ui" },
        new Date(now()),
      );
      return "error" in launched
        ? c.json({ error: launched.error }, launched.status)
        : c.json(launched, 201);
    });
}
