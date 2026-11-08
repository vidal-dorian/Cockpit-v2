import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { proposedBranch } from "./branch.ts";
import { budgetsOf } from "./cost.ts";
import type { Db } from "./db/db.ts";
import {
  cloudLaunchers,
  cloudLaunches,
  history,
  nightItems,
  nights,
  projectMembers,
  projects,
  runSteps,
  runs,
  tickets,
  userStories,
  users,
} from "./db/schema.ts";
import { publish } from "./events.ts";
import { changer, reserveStory, slotBusy } from "./queue.ts";
import {
  entryOf,
  type Fire,
  hour,
  launchCloud,
  nextOccurrence,
  signedIn,
  taskOf,
  timeZone,
} from "./routines.ts";
import { endRun, isUniqueViolation, lockRunning } from "./runs.ts";
import { body } from "./tickets.ts";

// No import of `routines.ts` is used when this module loads (it loads through it): the schemas of the hours are built in `nightRoutes`.

const SILENT_MS = 60 * 60_000;

const systemEntry = (userId: number, action: string, args: Entry["args"]) => ({
  ...entryOf(userId, action),
  actor: "system" as const,
  origin: "system" as const,
  args,
  result: "ok" as const,
});

const live = (db: Db) =>
  inArray(
    nights.userId,
    db.select({ id: users.id }).from(users).where(isNull(users.blockedAt)),
  );

/** Ends a running night (decision 044 D, L'): what was not reached is `not_started`. Once: the UPDATE only matches a running night. */
async function finishNight(db: Db, night: { id: number; userId: number }) {
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(nights)
      .set({ status: "finished" })
      .where(and(eq(nights.id, night.id), eq(nights.status, "running")))
      .returning({ id: nights.id });
    if (!done) return;
    await tx
      .update(nightItems)
      .set({ outcome: "not_started" })
      .where(and(eq(nightItems.nightId, night.id), isNull(nightItems.outcome)));
    await tx
      .insert(history)
      .values(systemEntry(night.userId, "finish_night", { nightId: night.id }));
  });
}

// The refusals of `launchCloud` that mean the launcher cannot launch: the night stops (044 H').
const STOPS_NIGHT = [
  "launcher_not_connected",
  "launcher_needs_reconnect",
  "monthly_budget_reached",
];

/**
 * Launches the next story of a running night, unless a launch of the night or of the queue is in progress (D'); a story that cannot start is skipped (or `not_started` when `/fire` failed)
 * and the next is tried at once. The night finishes when nothing is left, the end hour has passed or its cap is reached. Never throws.
 */
async function advance(
  db: Db,
  deps: Fire,
  night: typeof nights.$inferSelect,
  at: Date,
) {
  const { userId } = night;
  try {
    for (;;) {
      if (await slotBusy(db, userId, at)) return;
      const [next] = await db
        .select({
          id: nightItems.id,
          storyId: userStories.id,
          iWant: userStories.iWant,
          branch: userStories.branch,
          projectId: tickets.projectId,
        })
        .from(nightItems)
        .innerJoin(userStories, eq(userStories.id, nightItems.storyId))
        .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
        .where(
          and(
            eq(nightItems.nightId, night.id),
            isNull(nightItems.outcome),
            notExists(
              db
                .select({ one: sql`1` })
                .from(cloudLaunches)
                .where(eq(cloudLaunches.nightItemId, nightItems.id)),
            ),
          ),
        )
        .orderBy(asc(nightItems.position))
        .limit(1);
      const budgets = await budgetsOf(db, userId);
      const [spent] = await db
        .select({
          usd: sql<number>`coalesce(sum(${cloudLaunches.costUsd}), 0)`,
        })
        .from(cloudLaunches)
        .innerJoin(nightItems, eq(nightItems.id, cloudLaunches.nightItemId))
        .where(eq(nightItems.nightId, night.id));
      const left =
        budgets.nightUsd === null
          ? null
          : budgets.nightUsd - Number(spent?.usd);
      if (!next || at >= night.endsAt || (left !== null && left <= 0))
        return await finishNight(db, night);
      // The run is stopped when the night's cap is reached, as when its own cap is (060 D).
      const caps = [budgets.runUsd, left].filter((cap) => cap !== null);
      const launched = await launchCloud(
        db,
        deps,
        {
          ...entryOf(userId, "launch_story"),
          userId,
          actor: "system",
          origin: "system",
          storyId: next.storyId,
          projectId: next.projectId,
          args: { storyId: next.storyId },
        },
        at,
        [next.projectId],
        async (tx) => {
          // The user's row is the lock that gives the night and the queue one slot, whatever launches at the same time.
          await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .for("update");
          if (await slotBusy(tx, userId, at)) throw new Refused("slot_busy");
          return {
            ...(await reserveStory(tx, at, next.storyId, next.projectId, {
              branch:
                next.branch ??
                proposedBranch({ id: next.storyId, iWant: next.iWant }),
              budgetUsd: caps.length ? Math.min(...caps) : undefined,
            })),
            nightItemId: next.id,
          };
        },
      );
      if (!("error" in launched) || launched.error === "slot_busy") return;
      if (STOPS_NIGHT.includes(`${launched.error}`))
        return await finishNight(db, night);
      // `/fire` failing is not the story's fault; the other refusals (not ready any more, already running) skip it. No retry: `/fire` has no idempotence key (H').
      await db
        .update(nightItems)
        .set({
          outcome: launched.error === "fire_failed" ? "not_started" : "skipped",
        })
        .where(eq(nightItems.id, next.id));
    }
  } catch (error) {
    console.error(`Night ${night.id} failed:`, error);
  }
}

/** After a run of the night ends (decision 044 D, E): its item gets the outcome and the night goes on. Never throws. */
export async function nightAfterRun(
  db: Db,
  deps: Fire,
  runId: number,
  at: Date,
) {
  try {
    const [ended] = await db
      .select({ status: runs.status, itemId: nightItems.id, night: nights })
      .from(cloudLaunches)
      .innerJoin(runs, eq(runs.id, cloudLaunches.runId))
      .innerJoin(nightItems, eq(nightItems.id, cloudLaunches.nightItemId))
      .innerJoin(nights, eq(nights.id, nightItems.nightId))
      .where(eq(cloudLaunches.runId, runId));
    if (!ended) return;
    await db
      .update(nightItems)
      .set({
        runId,
        outcome:
          ended.status === "succeeded"
            ? "pr"
            : ended.status === "paused"
              ? "paused"
              : "failed",
      })
      .where(eq(nightItems.id, ended.itemId));
    if (ended.night.status === "running")
      await advance(db, deps, ended.night, at);
  } catch (error) {
    console.error(`Night after run ${runId} failed:`, error);
  }
}

/** Closes the runs of a night that were silent for 60 minutes (decision 044 G): the closure of 037 B, by the system. */
async function closeSilent(db: Db, deps: Fire, nightId: number, at: Date) {
  const cutoff = new Date(at.getTime() - SILENT_MS);
  // shortcut: a run's age is that of its launch (the clock of the pass), its steps are only looked at in the last hour; upgrade if a run's own start is wanted.
  const silent = await db
    .select({
      runId: runs.id,
      storyId: runs.storyId,
      userId: runs.userId,
      projectId: cloudLaunches.projectId,
    })
    .from(cloudLaunches)
    .innerJoin(nightItems, eq(nightItems.id, cloudLaunches.nightItemId))
    .innerJoin(runs, eq(runs.id, cloudLaunches.runId))
    .where(
      and(
        eq(nightItems.nightId, nightId),
        eq(runs.status, "running"),
        lte(cloudLaunches.createdAt, cutoff),
        notExists(
          db
            .select({ one: sql`1` })
            .from(runSteps)
            .where(
              and(
                eq(runSteps.runId, runs.id),
                gt(
                  sql`greatest(${runSteps.startedAt}, ${runSteps.finishedAt})`,
                  cutoff,
                ),
              ),
            ),
        ),
      ),
    );
  for (const run of silent) {
    if (run.projectId === null) continue;
    const projectId = run.projectId;
    try {
      // shortcut: the issue of the story is not synced here (the pass has no GitHub access); the next change of the story does.
      await act(
        db,
        {
          ...entryOf(run.userId, "close_run"),
          actor: "system",
          origin: "system",
          args: { runId: run.runId },
          projectId,
          storyId: run.storyId,
          runId: run.runId,
        },
        async (tx) => {
          await lockRunning(tx, projectId, run.runId);
          await endRun(tx, run.runId, run.storyId, {
            status: "closed_manually",
          });
        },
      );
      await publish(db, projectId, [
        `run:${run.runId}`,
        `story:${run.storyId}`,
      ]);
      await nightAfterRun(db, deps, run.runId, at);
    } catch (error) {
      if (!(error instanceof Refused))
        console.error(`Night run ${run.runId} not closed:`, error);
    }
  }
}

/** The pass of the minute for the nights (decision 044 D): the planned ones whose hour came start, then every running one closes its silent runs and goes on. Never throws. */
export async function runNights(db: Db, deps: Fire, now: Date) {
  try {
    await db.transaction(async (tx) => {
      const started = await tx
        .update(nights)
        .set({ status: "running" })
        .where(
          and(
            eq(nights.status, "planned"),
            lte(nights.startsAt, now),
            live(db),
          ),
        )
        .returning({ id: nights.id, userId: nights.userId });
      for (const n of started)
        await tx
          .insert(history)
          .values(systemEntry(n.userId, "start_night", { nightId: n.id }));
    });
    for (const night of await db
      .select()
      .from(nights)
      .where(and(eq(nights.status, "running"), live(db)))
      .orderBy(asc(nights.id))) {
      await closeSilent(db, deps, night.id, now);
      await advance(db, deps, night, now);
    }
  } catch (error) {
    console.error("Night pass failed:", error);
  }
}

/** The median seconds of the succeeded runs of each project, for the estimate of a story (decision 044 C). */
async function estimates(db: Db, projectIds: number[]) {
  if (!projectIds.length) return new Map<number, number>();
  const rows = await db
    .select({
      projectId: tickets.projectId,
      seconds: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from ${runs.finishedAt} - ${runs.startedAt}))`,
    })
    .from(runs)
    .innerJoin(userStories, eq(userStories.id, runs.storyId))
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .where(
      and(eq(runs.status, "succeeded"), inArray(tickets.projectId, projectIds)),
    )
    .groupBy(tickets.projectId);
  return new Map(rows.map((r) => [r.projectId, Math.round(r.seconds)]));
}

/** The morning of the home (decision 044 J): the last night, when it is finished and not hidden. */
// shortcut: the block stays until « Masquer » or the next night is planned, not until the next evening; upgrade with the clock of the app if users ask.
export async function morningOf(db: Db, userId: number) {
  const [night] = await db
    .select()
    .from(nights)
    .where(eq(nights.userId, userId))
    .orderBy(desc(nights.id))
    .limit(1);
  if (night?.status !== "finished" || night.hiddenAt) return null;
  const items = await db
    .select({
      storyId: userStories.id,
      iWant: userStories.iWant,
      outcome: nightItems.outcome,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(nightItems)
    .innerJoin(userStories, eq(userStories.id, nightItems.storyId))
    .leftJoin(runs, eq(runs.id, nightItems.runId))
    .where(eq(nightItems.nightId, night.id))
    .orderBy(asc(nightItems.position));
  return {
    id: night.id,
    startsAt: night.startsAt,
    endsAt: night.endsAt,
    delivered: items.filter((i) => i.outcome === "pr").length,
    total: items.length,
    items,
  };
}

const planBody = z.object({
  storyIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length),
});

/** Stories of the night must be ready, in a project ticked for the launcher (044 A'); one code for a story that is not the user's, so nothing is learned about it. */
async function assertPlannable(tx: Tx, userId: number, ids: number[]) {
  const found = await tx
    .select({ id: userStories.id })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        inArray(userStories.id, ids),
        eq(userStories.status, "ready"),
        eq(projectMembers.userId, userId),
        eq(projectMembers.inLauncher, true),
        isNull(projects.archivedAt),
      ),
    );
  if (found.length !== ids.length) throw new Refused("wrong_story");
}

/** The night of the user: the hours, the plan, the evening and the stop (decision 044 C, K, C'). */
export function nightRoutes(db: Db, now: () => number) {
  const signed = signedIn(db);
  const change = changer(db);
  const hoursBody = z.object({
    startHour: hour,
    endHour: hour,
    timeZone,
  });
  const hoursOf = async (userId: number) => {
    const [user] = await db
      .select({
        startHour: users.nightStartHour,
        endHour: users.nightEndHour,
        timeZone: users.nightTimeZone,
      })
      .from(users)
      .where(eq(users.id, userId));
    return user;
  };
  const openNight = (userId: number) =>
    db
      .select()
      .from(nights)
      .where(
        and(
          eq(nights.userId, userId),
          inArray(nights.status, ["planned", "running"]),
        ),
      )
      .then(([night]) => night);
  // The stories of a project ticked for the launcher, with their project and estimate.
  const stories = async (
    userId: number,
    where: ReturnType<typeof and>,
    inOrder: number[] = [],
  ) => {
    const rows = await db
      .select({
        storyId: userStories.id,
        iWant: userStories.iWant,
        projectId: projects.id,
        projectName: projects.fullName,
      })
      .from(userStories)
      .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, userId), where))
      .orderBy(asc(userStories.id));
    const estimated = await estimates(db, [
      ...new Set(rows.map((r) => r.projectId)),
    ]);
    return rows
      .sort((a, b) => inOrder.indexOf(a.storyId) - inOrder.indexOf(b.storyId))
      .map((r) => ({
        storyId: r.storyId,
        iWant: r.iWant,
        project: { id: r.projectId, name: r.projectName },
        estimatedSeconds: estimated.get(r.projectId) ?? null,
      }));
  };

  return new Hono<{ Variables: { userId: number } }>()
    .use("/api/nights/*", signed)
    .use("/api/nights", signed)
    .use("/api/me/night-hours", signed)
    .get("/api/me/night-hours", async (c) =>
      c.json(await hoursOf(c.get("userId"))),
    )
    .put("/api/me/night-hours", body(hoursBody), async (c) => {
      const userId = c.get("userId");
      const { startHour, endHour, timeZone } = c.req.valid("json");
      await act(db, entryOf(userId, "set_night_hours"), (tx) =>
        tx
          .update(users)
          .set({
            nightStartHour: startHour,
            nightEndHour: endHour,
            nightTimeZone: timeZone,
          })
          .where(eq(users.id, userId)),
      );
      return c.json({ startHour, endHour, timeZone });
    })
    .get("/api/nights/current", async (c) => {
      const userId = c.get("userId");
      const night = await openNight(userId);
      const items = night
        ? await db
            .select({
              storyId: nightItems.storyId,
              outcome: nightItems.outcome,
            })
            .from(nightItems)
            .where(eq(nightItems.nightId, night.id))
            .orderBy(asc(nightItems.position))
        : [];
      const planned = items.map((i) => i.storyId);
      // The stories of the night itself, whatever their status now (a story running tonight is no longer ready).
      const inNight = planned.length
        ? await stories(userId, inArray(userStories.id, planned), planned)
        : [];
      const notIn = (status: "ready" | "to_validate") =>
        stories(
          userId,
          and(
            eq(userStories.status, status),
            eq(projectMembers.inLauncher, true),
            isNull(projects.archivedAt),
            planned.length ? notInArray(userStories.id, planned) : undefined,
          ),
        );
      return c.json({
        night: night
          ? {
              id: night.id,
              status: night.status,
              startsAt: night.startsAt,
              endsAt: night.endsAt,
              items: inNight.map((s) => ({
                ...s,
                outcome:
                  items.find((i) => i.storyId === s.storyId)?.outcome ?? null,
              })),
            }
          : null,
        ready: await notIn("ready"),
        toValidate: await notIn("to_validate"),
      });
    })
    .post("/api/nights", body(planBody), (c) => {
      const userId = c.get("userId");
      const { storyIds } = c.req.valid("json");
      return change(
        c,
        {
          ...entryOf(userId, "plan_night"),
          args: { stories: storyIds.length },
        },
        async (tx) => {
          if (!(await taskOf(tx, cloudLaunchers, userId)))
            throw new Refused("launcher_not_connected");
          await assertPlannable(tx, userId, storyIds);
          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.id, userId));
          if (!user) throw new Refused("not_found");
          const at = new Date(now());
          const when = (after: Date, hour: number) =>
            nextOccurrence(after, {
              routineHour: hour,
              routineWeekday: null,
              routineTimeZone: user.nightTimeZone,
            });
          const nextStart = when(at, user.nightStartHour);
          const nextEnd = when(at, user.nightEndHour);
          // Planned during the night hours: it starts at once and ends at this night's end hour.
          const during = nextEnd < nextStart;
          const [night] = await tx
            .insert(nights)
            .values({
              userId,
              status: "planned",
              startsAt: during ? at : nextStart,
              endsAt: during ? nextEnd : when(nextStart, user.nightEndHour),
            })
            .returning({ id: nights.id })
            .catch((error) => {
              throw isUniqueViolation(error)
                ? new Refused("night_exists")
                : error;
            });
          if (!night) throw new Error("night not created");
          await tx.insert(nightItems).values(
            storyIds.map((storyId, position) => ({
              nightId: night.id,
              storyId,
              position,
            })),
          );
          return { id: night.id };
        },
        201,
      );
    })
    .put("/api/nights/current", body(planBody), (c) => {
      const userId = c.get("userId");
      const { storyIds } = c.req.valid("json");
      return change(
        c,
        {
          ...entryOf(userId, "plan_night"),
          args: { stories: storyIds.length },
        },
        async (tx) => {
          const [night] = await tx
            .select()
            .from(nights)
            .where(and(eq(nights.userId, userId), eq(nights.status, "planned")))
            .for("update");
          if (!night) throw new Refused("night_not_planned");
          await assertPlannable(tx, userId, storyIds);
          await tx.delete(nightItems).where(eq(nightItems.nightId, night.id));
          await tx.insert(nightItems).values(
            storyIds.map((storyId, position) => ({
              nightId: night.id,
              storyId,
              position,
            })),
          );
          return {};
        },
      );
    })
    .post("/api/nights/current/cancel", (c) => {
      const userId = c.get("userId");
      return change(c, entryOf(userId, "cancel_night"), async (tx) => {
        const [night] = await tx
          .update(nights)
          .set({ status: "cancelled" })
          .where(and(eq(nights.userId, userId), eq(nights.status, "planned")))
          .returning({ id: nights.id });
        if (!night) throw new Refused("night_not_planned");
        return {};
      });
    })
    .post("/api/nights/current/stop", (c) => {
      const userId = c.get("userId");
      return change(c, entryOf(userId, "stop_night"), async (tx) => {
        // The end hour is now: nothing new is launched, and the night finishes with its run in progress.
        const [night] = await tx
          .update(nights)
          .set({ endsAt: new Date(now()) })
          .where(and(eq(nights.userId, userId), eq(nights.status, "running")))
          .returning({ id: nights.id });
        if (!night) throw new Refused("night_not_running");
        await tx
          .update(runs)
          .set({ stopRequestedAt: sql`now()` })
          .where(
            and(
              eq(runs.status, "running"),
              isNull(runs.stopRequestedAt),
              inArray(
                runs.id,
                tx
                  .select({ id: cloudLaunches.runId })
                  .from(cloudLaunches)
                  .innerJoin(
                    nightItems,
                    eq(nightItems.id, cloudLaunches.nightItemId),
                  )
                  .where(eq(nightItems.nightId, night.id)),
              ),
            ),
          );
        return {};
      });
    })
    .post("/api/nights/:id/hide", (c) => {
      const userId = c.get("userId");
      const id = Number(c.req.param("id"));
      return change(c, entryOf(userId, "hide_night"), async (tx) => {
        const hidden = Number.isSafeInteger(id)
          ? await tx
              .update(nights)
              .set({ hiddenAt: new Date(now()) })
              .where(and(eq(nights.id, id), eq(nights.userId, userId)))
              .returning({ id: nights.id })
          : [];
        if (!hidden.length) throw new Refused("not_found");
        return {};
      });
    });
}
