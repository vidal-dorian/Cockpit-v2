import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser, SESSION_COOKIE } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  accountFingerprints,
  history,
  mcpTokens,
  projectMembers,
  projects,
  questions,
  runSteps,
  runs,
  tickets,
  userStories,
  users,
} from "./db/schema.ts";
import { findAccountId } from "./members.ts";
import { fingerprintOf } from "./plans.ts";

type Env = { Variables: { adminId: number } };

/** The projects a person is a member of. */
const memberOf = (db: Db, userId: number) =>
  db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

/** The owner's other members, for the confirmation window (decision 078 C): the projects she owns that are shared. */
async function sharedProjects(db: Db, userId: number) {
  const rows = await db
    .select({
      id: projects.id,
      fullName: projects.fullName,
      login: users.login,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        ne(projectMembers.userId, userId),
        inArray(
          projectMembers.projectId,
          db
            .select({ id: projectMembers.projectId })
            .from(projectMembers)
            .where(
              and(
                eq(projectMembers.userId, userId),
                eq(projectMembers.role, "owner"),
              ),
            ),
        ),
      ),
    )
    .orderBy(projects.id, users.login);
  const shared = new Map<
    number,
    { id: number; fullName: string; members: string[] }
  >();
  for (const r of rows) {
    const entry = shared.get(r.id) ?? {
      id: r.id,
      fullName: r.fullName,
      members: [],
    };
    shared.set(r.id, entry);
    entry.members.push(r.login);
  }
  return [...shared.values()];
}

/** Everything of decision 078 B, as plain JSON; never a hash, a secret or an encrypted value. */
async function exportOf(
  db: Db,
  user: { userId: number; login: string; name: string | null },
) {
  const { issueBodyHash: _hash, ...storyColumns } =
    getTableColumns(userStories);
  const mine = await db
    .select({
      id: projects.id,
      fullName: projects.fullName,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, user.userId))
    .orderBy(projects.id);
  const ids = mine.map((p) => p.id);
  const inMine = (column: Parameters<typeof inArray>[0]) =>
    inArray(column, ids);
  const [ticketRows, storyRows, criteria, runRows, steps, asked] =
    ids.length === 0
      ? [[], [], [], [], [], []]
      : await Promise.all([
          db.select().from(tickets).where(inMine(tickets.projectId)),
          db
            .select({ ...storyColumns, projectId: tickets.projectId })
            .from(userStories)
            .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
            .where(inMine(tickets.projectId)),
          db
            .select({ c: acceptanceCriteria })
            .from(acceptanceCriteria)
            .innerJoin(
              userStories,
              eq(userStories.id, acceptanceCriteria.storyId),
            )
            .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
            .where(inMine(tickets.projectId)),
          db
            .select({ run: runs, projectId: tickets.projectId })
            .from(runs)
            .innerJoin(userStories, eq(userStories.id, runs.storyId))
            .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
            .where(inMine(tickets.projectId)),
          db.select().from(runSteps),
          db.select().from(questions),
        ]);
  const runIds = new Set(runRows.map((r) => r.run.id));
  return {
    account: { login: user.login, name: user.name },
    projects: mine.map((p) => ({
      ...p,
      tickets: ticketRows
        .filter((t) => t.projectId === p.id)
        .map((t) => ({
          ...t,
          stories: storyRows
            .filter((s) => s.ticketId === t.id)
            .map((s) => ({
              ...s,
              criteria: criteria
                .filter((c) => c.c.storyId === s.id)
                .map((c) => c.c),
            })),
        })),
      runs: runRows
        .filter((r) => r.projectId === p.id)
        .map(({ run }) => ({
          ...run,
          steps: steps.filter((s) => s.runId === run.id && runIds.has(s.runId)),
          questions: asked.filter(
            (q) => q.runId === run.id && runIds.has(q.runId),
          ),
        })),
    })),
  };
}

/** One account's data and its deletion (decision 078). */
export function dataRoutes(db: Db, key: Buffer) {
  return new Hono()
    .get("/api/me/data", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const inMine = memberOf(db, user.userId);
      const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
      const stories = db
        .select({ id: userStories.id })
        .from(userStories)
        .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
        .where(inArray(tickets.projectId, inMine));
      const theRuns = db
        .select({ id: runs.id })
        .from(runs)
        .where(inArray(runs.storyId, stories));
      return c.json({
        name: user.name,
        login: user.login,
        isAdmin: user.isAdmin,
        projects: (await inMine).length,
        tickets: await n(
          db
            .select({ n: count() })
            .from(tickets)
            .where(inArray(tickets.projectId, inMine)),
        ),
        stories: (await stories).length,
        runs: (await theRuns).length,
        questions: await n(
          db
            .select({ n: count() })
            .from(questions)
            .where(inArray(questions.runId, theRuns)),
        ),
        journal: await n(
          db
            .select({ n: count() })
            .from(history)
            .where(eq(history.userId, user.userId)),
        ),
        tokens: await n(
          db
            .select({ n: count() })
            .from(mcpTokens)
            .where(eq(mcpTokens.userId, user.userId)),
        ),
        shared: await sharedProjects(db, user.userId),
      });
    })
    .get("/api/me/export", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "export_data",
        args: {},
      };
      const file = await act(db, entry, async (tx) => ({
        ...(await exportOf(tx as unknown as Db, user)),
        history: await tx
          .select()
          .from(history)
          .where(eq(history.userId, user.userId))
          .orderBy(desc(history.id)),
        tokens: await tx
          .select({
            name: mcpTokens.name,
            createdAt: mcpTokens.createdAt,
            lastUsedAt: mcpTokens.lastUsedAt,
            revokedAt: mcpTokens.revokedAt,
          })
          .from(mcpTokens)
          .where(eq(mcpTokens.userId, user.userId)),
        settings: (
          await tx
            .select({
              theme: users.theme,
              pluginRepo: users.pluginRepo,
              autoRelaunch: users.autoRelaunch,
              budgetRunUsd: users.budgetRunUsd,
              budgetNightUsd: users.budgetNightUsd,
              budgetMonthUsd: users.budgetMonthUsd,
              nightStartHour: users.nightStartHour,
              nightEndHour: users.nightEndHour,
              nightTimeZone: users.nightTimeZone,
              notifyQuestion: users.notifyQuestion,
              notifyRunFailed: users.notifyRunFailed,
              notifyPrReady: users.notifyPrReady,
              notifyNightRecap: users.notifyNightRecap,
              quietStartHour: users.quietStartHour,
              quietEndHour: users.quietEndHour,
            })
            .from(users)
            .where(eq(users.id, user.userId))
        )[0],
      }));
      c.header(
        "content-disposition",
        `attachment; filename="cockpit-${user.login}-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return c.json(file);
    })
    .delete("/api/me", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const typed = z
        .object({ login: z.string() })
        .safeParse(await c.req.json().catch(() => null));
      if (!typed.success || typed.data.login !== user.login)
        return c.json({ error: "login_mismatch" }, 400);
      if (user.isAdmin) return c.json({ error: "admin" }, 403);
      await db.transaction(async (tx) => {
        const u = user.userId;
        // Two deletions at once, or an import in flight, wait for this row.
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, u))
          .for("update");
        const owned = (
          await tx
            .select({ id: projectMembers.projectId })
            .from(projectMembers)
            .where(
              and(
                eq(projectMembers.userId, u),
                eq(projectMembers.role, "owner"),
              ),
            )
        ).map((p) => p.id);
        // Not a column filter: the same list is used by raw SQL below.
        const P = sql`array[${sql.join(
          owned.map((id) => sql`${id}`),
          sql`, `,
        )}]::integer[]`;
        const S = sql`(select us.id from user_stories us join tickets t on t.id = us.ticket_id where t.project_id = any(${P}))`;
        const R = sql`(select id from runs where story_id in ${S} or user_id = ${u})`;
        const NI = sql`(select id from night_items where night_id in (select id from nights where user_id = ${u}) or story_id in ${S} or run_id in ${R})`;
        // The fingerprint keeps the repos used, those of an earlier fingerprint included (E).
        if (owned.length > 0) {
          const fingerprint = fingerprintOf(key, user.githubId);
          await tx
            .insert(accountFingerprints)
            .values({ fingerprint, reposUsed: owned.length })
            .onConflictDoUpdate({
              target: accountFingerprints.fingerprint,
              set: {
                reposUsed: sql`${accountFingerprints.reposUsed} + ${owned.length}`,
              },
            });
        }
        // Children before parents; one place lists everything that points at a project or a user.
        for (const statement of [
          sql`delete from cloud_launches where user_id = ${u} or project_id = any(${P}) or story_id in ${S} or run_id in ${R} or night_item_id in ${NI}`,
          sql`update acceptance_criteria set result_run_id = null where result_run_id in ${R}`,
          sql`delete from questions where run_id in ${R}`,
          sql`delete from run_steps where run_id in ${R}`,
          sql`delete from night_items where id in ${NI}`,
          sql`delete from nights where user_id = ${u}`,
          sql`delete from queue_items where user_id = ${u} or story_id in ${S}`,
          sql`delete from runs where id in ${R}`,
          sql`delete from story_dependencies where story_id in ${S} or depends_on_id in ${S}`,
          sql`delete from acceptance_criteria where story_id in ${S}`,
          sql`delete from user_stories where id in ${S}`,
          sql`delete from findings where project_id = any(${P})`,
          sql`delete from tickets where project_id = any(${P})`,
          sql`delete from catalog_writes where project_id = any(${P})`,
          sql`delete from code_maps where project_id = any(${P})`,
          sql`delete from workflow_proposals where project_id = any(${P})`,
          sql`delete from project_invitations where project_id = any(${P}) or github_id = ${user.githubId}`,
          sql`delete from project_members where project_id = any(${P}) or user_id = ${u}`,
          sql`update projects set routine_user_id = null where routine_user_id = ${u}`,
          sql`delete from projects where id = any(${P})`,
          sql`delete from routines where user_id = ${u}`,
          sql`delete from write_us_routines where user_id = ${u}`,
          sql`delete from cloud_launchers where user_id = ${u}`,
          sql`delete from agent_teams where user_id = ${u}`,
          sql`delete from mcp_tokens where user_id = ${u}`,
          sql`select erase_account_history(${u}, ${P})`,
          // Sessions, push subscriptions, notifications and template requests go with it (cascade); a Pro code is unlinked (set null).
          sql`delete from users where id = ${u}`,
        ])
          await tx.execute(statement);
      });
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true });
    });
}

/** Decision 078 F, mounted behind the `adminOnly` of `accountRoutes`: the fingerprint of an account GitHub names, erased. */
export function fingerprintRoutes(db: Db, key: Buffer) {
  return new Hono<Env>().post("/api/settings/fingerprints/erase", async (c) => {
    const parsed = z
      .object({ login: z.string().trim().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Bad request" }, 400);
    let githubId: number | null;
    try {
      githubId = await findAccountId(parsed.data.login);
    } catch (error) {
      console.error("GitHub request failed:", error);
      return c.json({ error: "github_unavailable" }, 502);
    }
    if (githubId === null) return c.json({ error: "unknown_login" }, 404);
    const entry: Entry = {
      userId: c.get("adminId"),
      actor: "human",
      origin: "ui",
      action: "fingerprint_erased",
      args: {},
    };
    try {
      await act(db, entry, async (tx) => {
        const gone = await tx
          .delete(accountFingerprints)
          .where(
            eq(accountFingerprints.fingerprint, fingerprintOf(key, githubId)),
          )
          .returning({ f: accountFingerprints.fingerprint });
        if (gone.length === 0) throw new Refused("no_fingerprint");
      });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return c.json({ error: "no_fingerprint" }, 404);
    }
    return c.json({ ok: true });
  });
}
