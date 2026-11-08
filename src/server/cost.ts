import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Db } from "./db/db.ts";
import {
  cloudLaunches,
  history,
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
// shortcut: the first 1000 points of an export only (one UPDATE each, no secret on this route); raise if one export carries more.
const MAX_POINTS = 1000;

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
      const points = parsed.data.resourceMetrics
        .flatMap((r) =>
          r.scopeMetrics.flatMap((s) =>
            s.metrics.flatMap((m) =>
              (m.sum?.dataPoints ?? []).map((p) => ({
                kind:
                  m.name === "claude_code.cost.usage"
                    ? ("cost" as const)
                    : m.name === "claude_code.token.usage"
                      ? ("tokens" as const)
                      : null,
                cumulative: m.sum?.aggregationTemporality === 2,
                value: Number(p.asDouble ?? p.asInt),
                session: [
                  ...(p.attributes ?? []),
                  ...(r.resource?.attributes ?? []),
                ].find((a) => a.key === "ccr.session.id")?.value.stringValue,
              })),
            ),
          ),
        )
        .slice(0, MAX_POINTS);
      for (const { kind, cumulative, value, session } of points) {
        if (
          !kind ||
          !session ||
          !(
            value >= 0 &&
            value <= (kind === "cost" ? MAX_COST_POINT : MAX_TOKEN_POINT)
          )
        )
          continue;
        const column =
          kind === "cost" ? cloudLaunches.costUsd : cloudLaunches.tokens;
        const amount = kind === "cost" ? value : Math.round(value);
        const [launch] = await db
          .update(cloudLaunches)
          .set({
            [kind === "cost" ? "costUsd" : "tokens"]: cumulative
              ? sql`greatest(${column}, ${amount})`
              : sql`${column} + ${amount}`,
          })
          // 054: Claude Code sends the session as `cse_…`, `/fire` gave `session_…`.
          .where(
            eq(cloudLaunches.sessionId, session.replace(/^cse_/, "session_")),
          )
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
