import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { act, Refused, type Tx } from "./action.ts";
import { proposedBranch } from "./branch.ts";
import type { Db } from "./db/db.ts";
import {
  cloudLaunches,
  history,
  projectMembers,
  projects,
  queueItems,
  runs,
  storyDependencies,
  tickets,
  userStories,
  users,
} from "./db/schema.ts";
import { isDatabaseId } from "./projects.ts";
import { entryOf, type Fire, launchCloud, signedIn } from "./routines.ts";
import { isUniqueViolation } from "./runs.ts";
import { memberStory } from "./stories.ts";
import { assertActive, body } from "./tickets.ts";

const PENDING_MS = 15 * 60_000;

/** A launch still waiting for its run: the `launch_pending` rule of 054 E. */
const pendingSince = (at: Date) =>
  and(
    gt(cloudLaunches.createdAt, new Date(at.getTime() - PENDING_MS)),
    isNull(cloudLaunches.runId),
    isNull(cloudLaunches.reason),
    or(isNull(cloudLaunches.result), eq(cloudLaunches.result, "ok")),
  );

// Here, not in launcher.ts: queue.ts is loaded through routines.ts, and launcher.ts uses `noNul` of tickets.ts when it loads, which may not be loaded yet.
/** What a launch of a story checks and writes (054 E), in the transaction of `launchCloud`; shared by the route and the queue (057 C). */
export async function reserveStory(
  tx: Tx,
  at: Date,
  storyId: number,
  projectId: number,
  {
    branch,
    team,
    comment,
  }: { branch: string; team?: string; comment?: string },
) {
  const [locked] = await tx
    .select()
    .from(userStories)
    .where(eq(userStories.id, storyId))
    .for("update");
  if (!locked) throw new Refused("not_found");
  if (!["ready", "in_review"].includes(locked.status))
    throw new Refused("wrong_status");
  const [running] = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.storyId, storyId), eq(runs.status, "running")));
  if (running) throw new Refused("run_active");
  if (locked.branch && locked.branch !== branch)
    throw new Refused("branch_mismatch");
  const [pending] = await tx
    .select({ id: cloudLaunches.id })
    .from(cloudLaunches)
    .where(and(eq(cloudLaunches.storyId, storyId), pendingSince(at)));
  if (pending) throw new Refused("launch_pending");
  return { projectId, storyId, branch, team, comment };
}

/** The queue of the user in order; `waiting` says why a story is skipped (decision 057 B, D). */
async function readItems(db: Db, userId: number, at: Date) {
  const items = await db
    .select({
      storyId: userStories.id,
      iWant: userStories.iWant,
      status: userStories.status,
      branch: userStories.branch,
      projectId: tickets.projectId,
      projectName: projects.fullName,
      archived: projects.archivedAt,
    })
    .from(queueItems)
    .innerJoin(userStories, eq(userStories.id, queueItems.storyId))
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(eq(queueItems.userId, userId))
    .orderBy(asc(queueItems.position), asc(queueItems.id));
  const undone = items.length
    ? await db
        .select({
          storyId: storyDependencies.storyId,
          awaited: storyDependencies.dependsOnId,
        })
        .from(storyDependencies)
        .innerJoin(
          userStories,
          eq(userStories.id, storyDependencies.dependsOnId),
        )
        .where(
          and(
            inArray(
              storyDependencies.storyId,
              items.map((i) => i.storyId),
            ),
            ne(userStories.status, "done"),
          ),
        )
        .orderBy(asc(storyDependencies.dependsOnId))
    : [];
  // A launch still waiting for its run (the `launch_pending` rule of 054 E) holds its story back too.
  const pending = items.length
    ? await db
        .select({ storyId: cloudLaunches.storyId })
        .from(cloudLaunches)
        .where(
          and(
            inArray(
              cloudLaunches.storyId,
              items.map((i) => i.storyId),
            ),
            pendingSince(at),
          ),
        )
    : [];
  return items.map((i) => {
    const dependency = undone.find((d) => d.storyId === i.storyId);
    return {
      ...i,
      waiting:
        // shortcut: an archived project or a pending launch shows as « not ready », the shape pinned by 057 B; add a reason if users ask why.
        i.status !== "ready" ||
        i.archived ||
        pending.some((p) => p.storyId === i.storyId)
          ? { reason: "not_ready" as const }
          : dependency
            ? { reason: "dependency" as const, storyId: dependency.awaited }
            : null,
    };
  });
}

/** Pauses the queue of a user for a reason of its own (057 E), once: a queue already paused keeps its first reason. */
async function pauseQueue(
  db: Db,
  userId: number,
  reason: NonNullable<typeof users.$inferSelect.queuePausedReason>,
  at: Date,
) {
  await db.transaction(async (tx) => {
    const paused = await tx
      .update(users)
      .set({ queuePausedAt: at, queuePausedReason: reason })
      .where(and(eq(users.id, userId), isNull(users.queuePausedAt)))
      .returning({ id: users.id });
    if (paused.length)
      await tx.insert(history).values({
        ...entryOf(userId, "pause_queue"),
        actor: "system",
        origin: "system",
        result: "ok",
        detail: { reason },
      });
  });
}

// The refusals of `launchCloud` that mean the launcher cannot launch (057 E).
const STOPS_QUEUE = [
  "fire_failed",
  "launcher_not_connected",
  "launcher_needs_reconnect",
  "project_not_in_launcher",
];

/** A launch of the queue is in progress while its run runs or, with no run yet, for 15 minutes (057 C). */
async function slotBusy(db: Db, userId: number, at: Date) {
  const [inProgress] = await db
    .select({ id: cloudLaunches.id })
    .from(cloudLaunches)
    .leftJoin(runs, eq(runs.id, cloudLaunches.runId))
    .where(
      and(
        eq(cloudLaunches.userId, userId),
        eq(cloudLaunches.fromQueue, true),
        or(
          eq(runs.status, "running"),
          and(
            isNull(cloudLaunches.runId),
            isNull(cloudLaunches.finishedAt),
            isNull(cloudLaunches.reason),
            gt(cloudLaunches.createdAt, new Date(at.getTime() - PENDING_MS)),
          ),
        ),
      ),
    );
  return inProgress !== undefined;
}

/** Launches the first story of the queue that is not skipped, unless the queue is paused or a launch of the queue is in progress (057 C). Never throws. */
async function launchNext(db: Db, deps: Fire, userId: number, at: Date) {
  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          isNull(users.blockedAt),
          isNull(users.queuePausedAt),
        ),
      );
    if (!user) return;
    if (await slotBusy(db, userId, at)) return;
    const next = (await readItems(db, userId, at)).find((i) => !i.waiting);
    if (!next) return;
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
        // The user's row is the lock that gives the queue one slot, whatever launches at the same time (pass, end of a run).
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        if (await slotBusy(tx, userId, at)) throw new Refused("queue_busy");
        return {
          ...(await reserveStory(tx, at, next.storyId, next.projectId, {
            branch:
              next.branch ??
              proposedBranch({ id: next.storyId, iWant: next.iWant }),
          })),
          fromQueue: true,
        };
      },
    );
    if (!("error" in launched))
      await db.delete(queueItems).where(eq(queueItems.storyId, next.storyId));
    // Only a launcher that cannot launch pauses the queue; any other refusal leaves the story for a later pass (a manual launch, a pending one).
    else if (STOPS_QUEUE.includes(`${launched.error}`))
      await pauseQueue(db, userId, "launch_failed", at);
  } catch (error) {
    console.error(`Queue of user ${userId} failed:`, error);
  }
}

/** The pass of the minute for the queues (057 C, E): a launch that got no run in 15 minutes pauses its queue, then every queue that can goes on. Never throws. */
export async function runQueues(db: Db, deps: Fire, now: Date) {
  try {
    const lost = await db
      .update(cloudLaunches)
      .set({ outcome: "failed", finishedAt: now })
      .where(
        and(
          eq(cloudLaunches.fromQueue, true),
          eq(cloudLaunches.result, "ok"),
          isNull(cloudLaunches.runId),
          isNull(cloudLaunches.finishedAt),
          isNull(cloudLaunches.reason),
          lte(cloudLaunches.createdAt, new Date(now.getTime() - PENDING_MS)),
        ),
      )
      .returning({ userId: cloudLaunches.userId });
    for (const { userId } of lost)
      await pauseQueue(db, userId, "no_session", now);
    const waiting = await db
      .selectDistinct({ userId: queueItems.userId })
      .from(queueItems);
    for (const { userId } of waiting) await launchNext(db, deps, userId, now);
  } catch (error) {
    console.error("Queue pass failed:", error);
  }
}

/** After a run ends (057 C, E): the end of a queue run that did not succeed pauses the queue of the owner of the launch, a success starts their next story at once. Never throws. */
export async function queueAfterRun(
  db: Db,
  deps: Fire,
  runId: number,
  at: Date,
) {
  try {
    const [ended] = await db
      .select({ status: runs.status, userId: cloudLaunches.userId })
      .from(cloudLaunches)
      .innerJoin(runs, eq(runs.id, cloudLaunches.runId))
      .where(
        and(eq(cloudLaunches.runId, runId), eq(cloudLaunches.fromQueue, true)),
      );
    if (!ended) return;
    if (ended.status === "succeeded")
      await launchNext(db, deps, ended.userId, at);
    else await pauseQueue(db, ended.userId, "run_failed", at);
  } catch (error) {
    console.error(`Queue after run ${runId} failed:`, error);
  }
}

const reorderBody = z.object({
  storyIds: z.array(z.number().int().positive()).max(1000),
});

/** The queue of the user (decision 057 B): read, add, remove, reorder, pause, resume. */
export function queueRoutes(db: Db) {
  const signed = signedIn(db);
  /** One `act` of a queue action; a refusal is the 409 of its code (a missing story is the 404). */
  const change = async (
    c: Context,
    entry: ReturnType<typeof entryOf>,
    work: Parameters<typeof act>[2],
    status: 200 | 201 = 200,
  ) => {
    try {
      return c.json(await act(db, entry, work), status);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return error.message === "not_found"
        ? c.json({ error: "Not found" }, 404)
        : error.message === "bad_order"
          ? c.json({ error: "Bad request" }, 400)
          : c.json({ error: error.message }, 409);
    }
  };
  return new Hono<{ Variables: { userId: number } }>()
    .use("/api/queue/*", signed)
    .use("/api/queue", signed)
    .get("/api/queue", async (c) => {
      const userId = c.get("userId");
      const [user] = await db
        .select({
          at: users.queuePausedAt,
          reason: users.queuePausedReason,
        })
        .from(users)
        .where(eq(users.id, userId));
      const items = await readItems(db, userId, new Date());
      return c.json({
        paused: user?.at != null,
        pausedReason: user?.reason ?? null,
        items: items.map((i) => ({
          storyId: i.storyId,
          iWant: i.iWant,
          projectId: i.projectId,
          projectName: i.projectName,
          waiting: i.waiting,
        })),
      });
    })
    .post(
      "/api/queue",
      body(z.object({ storyId: z.number().int().positive() })),
      async (c) => {
        const userId = c.get("userId");
        const found = await memberStory(
          db,
          userId,
          c.req.valid("json").storyId,
        );
        if (!found) return c.json({ error: "Not found" }, 404);
        const { story, ticket, project } = found;
        return change(
          c,
          {
            ...entryOf(userId, "queue_story"),
            projectId: project.id,
            ticketId: ticket.id,
            storyId: story.id,
            args: { storyId: story.id },
          },
          async (tx) => {
            await assertActive(tx, project.id);
            if (story.status !== "ready") throw new Refused("wrong_status");
            const [ticked] = await tx
              .select({ id: projectMembers.projectId })
              .from(projectMembers)
              .where(
                and(
                  eq(projectMembers.userId, userId),
                  eq(projectMembers.projectId, project.id),
                  eq(projectMembers.inLauncher, true),
                ),
              );
            if (!ticked) throw new Refused("project_not_in_launcher");
            // The unique key refuses a story already queued, even two requests at once.
            await tx
              .insert(queueItems)
              .values({
                userId,
                storyId: story.id,
                position: sql`(select coalesce(max(position), 0) + 1 from queue_items where user_id = ${userId})`,
              })
              .catch((error) => {
                throw isUniqueViolation(error)
                  ? new Refused("already_queued")
                  : error;
              });
            return { storyId: story.id };
          },
          201,
        );
      },
    )
    .put("/api/queue", body(reorderBody), (c) => {
      const userId = c.get("userId");
      const { storyIds } = c.req.valid("json");
      return change(c, entryOf(userId, "reorder_queue"), async (tx) => {
        const current = await tx
          .select({ storyId: queueItems.storyId })
          .from(queueItems)
          .where(eq(queueItems.userId, userId))
          .for("update");
        if (
          new Set(storyIds).size !== storyIds.length ||
          storyIds.length !== current.length ||
          !current.every((i) => storyIds.includes(i.storyId))
        )
          throw new Refused("bad_order");
        for (const [position, storyId] of storyIds.entries())
          await tx
            .update(queueItems)
            .set({ position })
            .where(eq(queueItems.storyId, storyId));
        return {};
      });
    })
    .delete("/api/queue/:storyId", (c) => {
      const userId = c.get("userId");
      const storyId = Number(c.req.param("storyId"));
      return change(
        c,
        { ...entryOf(userId, "unqueue_story"), args: { storyId } },
        async (tx) => {
          if (!isDatabaseId(storyId)) throw new Refused("not_found");
          const gone = await tx
            .delete(queueItems)
            .where(
              and(
                eq(queueItems.userId, userId),
                eq(queueItems.storyId, storyId),
              ),
            )
            .returning({ id: queueItems.id });
          if (!gone.length) throw new Refused("not_found");
          return {};
        },
      );
    })
    .post("/api/queue/pause", (c) => {
      const userId = c.get("userId");
      return change(c, entryOf(userId, "pause_queue"), async (tx) => {
        await tx
          .update(users)
          .set({ queuePausedAt: new Date() })
          .where(and(eq(users.id, userId), isNull(users.queuePausedAt)));
        return {};
      });
    })
    .post("/api/queue/resume", (c) => {
      const userId = c.get("userId");
      return change(c, entryOf(userId, "resume_queue"), async (tx) => {
        await tx
          .update(users)
          .set({ queuePausedAt: null, queuePausedReason: null })
          .where(eq(users.id, userId));
        return {};
      });
    });
}
