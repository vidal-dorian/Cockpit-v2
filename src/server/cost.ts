import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  cloudLaunches,
  history,
  projectMembers,
  projects,
  runs,
  userStories,
  users,
} from "./db/schema.ts";
import { publish } from "./events.ts";

/** A cap in dollars (decision 060 C). */
export const usd = z.number().positive().max(100_000);

/** The three caps of the user, null when not set (decision 060 C). */
export async function budgetsOf(db: Db, userId: number) {
  const [user] = await db
    .select({
      runUsd: users.budgetRunUsd,
      nightUsd: users.budgetNightUsd,
      monthUsd: users.budgetMonthUsd,
    })
    .from(users)
    .where(eq(users.id, userId));
  return user ?? { runUsd: null, nightUsd: null, monthUsd: null };
}

/** What the user's launches of the month cost so far; the launch that decides the cap and the page « Coût » read the same sum (decision 060 E, F). */
export async function monthSpent(db: Db, userId: number, at: Date) {
  const [spent] = await db
    .select({ usd: sql<number>`coalesce(sum(${cloudLaunches.costUsd}), 0)` })
    .from(cloudLaunches)
    .where(
      and(
        eq(cloudLaunches.userId, userId),
        gte(cloudLaunches.createdAt, monthStart(at)),
      ),
    );
  return Number(spent?.usd);
}

/** The first instant of the calendar month of `at`, in UTC (decision 060 E). */
export const monthStart = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

// Only the fields Cockpit reads of an OTLP/HTTP JSON export; the rest is ignored (decision 060 A).
const attributes = z
  .array(
    z.object({
      key: z.string(),
      value: z.object({ stringValue: z.string().optional() }),
    }),
  )
  .optional();
const metricsBody = z.object({
  resourceMetrics: z.array(
    z.object({
      resource: z.object({ attributes }).optional(),
      scopeMetrics: z.array(
        z.object({
          metrics: z.array(
            z.object({
              name: z.string(),
              sum: z
                .object({
                  aggregationTemporality: z.number().optional(),
                  dataPoints: z.array(
                    z.object({
                      asDouble: z.number().optional(),
                      // OTLP/JSON sends 64-bit integers as strings.
                      asInt: z.union([z.string(), z.number()]).optional(),
                      attributes,
                    }),
                  ),
                })
                .optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});

const MAX_COST_POINT = 1000;
const MAX_TOKEN_POINT = 1e9;
const MAX_SESSIONS = 100;

/** The unauthenticated receiver of Claude Code's telemetry (decision 060 A, B, D): only a point of a session Cockpit launched counts; the answer is always `200 {}`. */
export function metricsRoutes(db: Db) {
  return new Hono().post(
    "/v1/metrics",
    bodyLimit({ maxSize: 1024 * 1024 }),
    async (c) => {
      if (!c.req.header("content-type")?.startsWith("application/json"))
        return c.json({ error: "Unsupported Media Type" }, 415);
      const parsed = metricsBody.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      // Per session and kind: the deltas added up, the biggest cumulative; applied as `greatest(column, max) + add` (060 B).
      const groups = new Map<
        string,
        { session: string; kind: "cost" | "tokens"; add: number; max: number }
      >();
      for (const r of parsed.data.resourceMetrics)
        for (const s of r.scopeMetrics)
          for (const m of s.metrics) {
            const kind =
              m.name === "claude_code.cost.usage"
                ? "cost"
                : m.name === "claude_code.token.usage"
                  ? "tokens"
                  : null;
            for (const p of m.sum?.dataPoints ?? []) {
              const value = Number(p.asDouble ?? p.asInt);
              const id = [
                ...(p.attributes ?? []),
                ...(r.resource?.attributes ?? []),
              ].find((a) => a.key === "ccr.session.id")?.value.stringValue;
              if (
                !kind ||
                !id ||
                !(
                  value >= 0 &&
                  value <= (kind === "cost" ? MAX_COST_POINT : MAX_TOKEN_POINT)
                )
              )
                continue;
              // 054: Claude Code sends the session as `cse_…`, `/fire` gave `session_…`.
              const session = id.replace(/^cse_/, "session_");
              const group = groups.get(`${session} ${kind}`) ?? {
                session,
                kind,
                add: 0,
                max: 0,
              };
              if (m.sum?.aggregationTemporality === 2)
                group.max = Math.max(group.max, value);
              else group.add += value;
              groups.set(`${session} ${kind}`, group);
            }
          }
      const sessions = [
        ...new Set([...groups.values()].map((g) => g.session)),
      ].slice(0, MAX_SESSIONS);
      if (sessions.length === 0) return c.json({});
      const known = new Set(
        (
          await db
            .select({ id: cloudLaunches.sessionId })
            .from(cloudLaunches)
            .where(inArray(cloudLaunches.sessionId, sessions))
        ).map((l) => l.id),
      );
      for (const { session, kind, add, max } of groups.values()) {
        if (!known.has(session)) continue;
        const column =
          kind === "cost" ? cloudLaunches.costUsd : cloudLaunches.tokens;
        const [launch] = await db
          .update(cloudLaunches)
          .set({
            [kind === "cost" ? "costUsd" : "tokens"]:
              kind === "cost"
                ? sql`greatest(${column}, ${max}) + ${add}`
                : sql`greatest(${column}, ${Math.round(max)}) + ${Math.round(add)}`,
          })
          .where(eq(cloudLaunches.sessionId, session))
          .returning();
        if (
          kind === "cost" &&
          launch?.runId != null &&
          launch.budgetUsd !== null &&
          launch.costUsd >= launch.budgetUsd
        )
          await stopForBudget(
            db,
            launch.userId,
            launch.projectId,
            launch.runId,
          );
      }
      return c.json({});
    },
  );
}

/** The stop request of 037 A, made by the system once: the UPDATE only matches a running run without one. Not `act`: nothing is written when it did not match. */
async function stopForBudget(
  db: Db,
  userId: number,
  projectId: number | null,
  runId: number,
) {
  const stopped = await db.transaction(async (tx) => {
    const [run] = await tx
      .update(runs)
      .set({ stopRequestedAt: sql`now()` })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.status, "running"),
          isNull(runs.stopRequestedAt),
        ),
      )
      .returning({ storyId: runs.storyId });
    if (!run) return null;
    const [story] = await tx
      .select({ ticketId: userStories.ticketId })
      .from(userStories)
      .where(eq(userStories.id, run.storyId));
    await tx.insert(history).values({
      userId,
      projectId,
      actor: "system",
      origin: "system",
      action: "request_stop",
      args: { runId },
      storyId: run.storyId,
      ticketId: story?.ticketId,
      runId,
      result: "ok",
      detail: { reason: "budget" },
    });
    return run;
  });
  if (stopped && projectId !== null)
    await publish(db, projectId, [`run:${runId}`, `story:${stopped.storyId}`]);
}

/** The page « Coût » (decision 060 F): the month of the user's launches, the average per run, the cost per merged PR, and per project. */
export function costRoutes(db: Db, now: () => number) {
  return new Hono().get("/api/claude/cost", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const at = new Date(now());
    const since = monthStart(at);
    const mine = and(
      eq(cloudLaunches.userId, user.userId),
      gte(cloudLaunches.createdAt, since),
    );
    const [withRun] = await db
      .select({
        usd: sql<number>`coalesce(sum(${cloudLaunches.costUsd}), 0)`,
        n: count(),
      })
      .from(cloudLaunches)
      .where(and(mine, isNotNull(cloudLaunches.runId)));
    const perProject = await db
      .select({
        id: projects.id,
        name: projects.fullName,
        costUsd: sql<number>`sum(${cloudLaunches.costUsd})`,
      })
      .from(cloudLaunches)
      .innerJoin(projects, eq(projects.id, cloudLaunches.projectId))
      .where(mine)
      .groupBy(projects.id)
      .orderBy(desc(sql`sum(${cloudLaunches.costUsd})`), asc(projects.id));
    const merged = (
      await db
        .selectDistinct({ storyId: history.storyId })
        .from(history)
        .innerJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, history.projectId),
            eq(projectMembers.userId, user.userId),
          ),
        )
        .where(
          and(
            eq(history.action, "pull_request_merged"),
            gte(history.at, since),
            isNotNull(history.storyId),
          ),
        )
    ).flatMap((h) => (h.storyId === null ? [] : [h.storyId]));
    const [ofMerged] = merged.length
      ? await db
          .select({
            usd: sql<number>`coalesce(sum(${cloudLaunches.costUsd}), 0)`,
          })
          .from(cloudLaunches)
          .where(
            and(
              eq(cloudLaunches.userId, user.userId),
              inArray(cloudLaunches.storyId, merged),
            ),
          )
      : [];
    return c.json({
      monthUsd: await monthSpent(db, user.userId, at),
      runAverageUsd: withRun?.n ? Number(withRun.usd) / withRun.n : null,
      perMergedPrUsd: merged.length
        ? Number(ofMerged?.usd) / merged.length
        : null,
      projects: perProject.map((p) => ({ ...p, costUsd: Number(p.costUsd) })),
    });
  });
}
