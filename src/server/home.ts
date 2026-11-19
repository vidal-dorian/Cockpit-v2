import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  catalogWrites,
  cloudLaunches,
  history,
  mcpTokens,
  projectMembers,
  projects,
  questions,
  queueItems,
  runSteps,
  runs,
  tickets,
  userStories,
  workflowProposals,
} from "./db/schema.ts";
import { morningOf } from "./night.ts";
import { MAX_RELAUNCHES } from "./pr-follow.ts";
import { liveToken } from "./tokens.ts";
import { runVerdict } from "./verdict.ts";

const storyColumns = {
  storyId: userStories.id,
  iWant: userStories.iWant,
  projectId: projects.id,
  projectName: projects.fullName,
};
const project = (r: { projectId: number; projectName: string }) => ({
  id: r.projectId,
  name: r.projectName,
});

const mineOf = (userId: number) =>
  and(eq(projectMembers.userId, userId), isNull(projects.archivedAt));

/** The runs of the user's projects that run (or are paused, decision 044 E), each with its pending question and its open step; shared by the home and the page « Claude » (decision 058 F). */
async function runningRuns(
  db: Db,
  userId: number,
  status: "running" | "paused" = "running",
) {
  const running = await db
    .select({
      ...storyColumns,
      runId: runs.id,
      questionId: questions.id,
      question: questions.question,
      suggestedAnswers: questions.suggestedAnswers,
      context: questions.context,
      agent: questions.agent,
      askedAt: questions.askedAt,
    })
    .from(runs)
    .innerJoin(userStories, eq(userStories.id, runs.storyId))
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .leftJoin(
      questions,
      and(eq(questions.runId, runs.id), isNull(questions.answer)),
    )
    .where(and(mineOf(userId), eq(runs.status, status)))
    .orderBy(asc(runs.id));
  const steps = running.length
    ? await db
        .select({ runId: runSteps.runId, agent: runSteps.agent })
        .from(runSteps)
        .where(
          and(
            inArray(
              runSteps.runId,
              running.map((r) => r.runId),
            ),
            eq(runSteps.status, "running"),
          ),
        )
        .orderBy(asc(runSteps.id))
    : [];
  const stepOf = new Map(steps.map((s) => [s.runId, s.agent]));
  return running.map((r) => ({ ...r, step: stepOf.get(r.runId) ?? null }));
}

/** The getting-started guide (decision 075 A, B): steps 2 to 7 read from today's rows, archived projects included, but « Faire » leads to active ones; null once all are done. */
async function onboardingOf(db: Db, userId: number) {
  const member = eq(projectMembers.userId, userId);
  const [mine, token, [seen], [validated]] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.fullName,
        archivedAt: projects.archivedAt,
        prepared: sql<boolean>`exists (select 1 from ${catalogWrites} where ${catalogWrites.projectId} = ${projects.id})`,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(member)
      .orderBy(asc(projects.id)),
    db
      .select({ id: mcpTokens.id })
      .from(mcpTokens)
      .where(and(eq(mcpTokens.userId, userId), liveToken))
      .limit(1),
    db
      .select({
        ticket: sql<boolean>`count(${tickets.id}) > 0`,
        toValidate: sql<
          number | null
        >`min(${userStories.id}) filter (where ${userStories.status} = 'to_validate' and ${projects.archivedAt} is null)`,
        ready: sql<
          number | null
        >`min(${userStories.id}) filter (where ${userStories.status} = 'ready' and ${projects.archivedAt} is null)`,
        withPr: sql<boolean>`coalesce(bool_or(${userStories.prNumber} is not null), false)`,
      })
      .from(tickets)
      .innerJoin(
        projectMembers,
        eq(projectMembers.projectId, tickets.projectId),
      )
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .leftJoin(userStories, eq(userStories.ticketId, tickets.id))
      .where(member),
    // The history, not the status: a story imported from an issue is `ready` without anyone validating it.
    db
      .select({ id: history.id })
      .from(history)
      .innerJoin(
        projectMembers,
        eq(projectMembers.projectId, history.projectId),
      )
      .where(
        and(
          member,
          eq(history.userId, userId),
          eq(history.action, "validate_story"),
          eq(history.result, "ok"),
        ),
      )
      .limit(1),
  ]);
  const active = mine.filter((p) => p.archivedAt === null);
  const unprepared = active.find((p) => !p.prepared);
  const step = (
    key: string,
    done: boolean,
    detail: string | null = null,
    projectId: number | null = null,
    storyId: number | null = null,
  ) => ({ key, done, detail, projectId, storyId });
  const steps = [
    step("project", mine.length > 0, mine[0]?.name ?? null),
    step("claude", token.length > 0),
    step(
      "prepare",
      mine.some((p) => p.prepared),
      null,
      unprepared?.id,
    ),
    step("idea", seen?.ticket === true, null, active[0]?.id),
    step("validate", validated !== undefined, null, null, seen?.toValidate),
    step("develop", seen?.withPr === true, null, null, seen?.ready),
  ];
  return steps.every((s) => s.done) ? null : { steps };
}

/** The home of the user (decision 040 A to D): what waits for them, what Claude does, the state of each project; read in a few set-based queries, nothing stored. */
export function homeRoutes(db: Db, now: () => number) {
  return new Hono().get("/api/home", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const mine = mineOf(user.userId);
    const list = await db
      .select({
        id: projects.id,
        name: projects.fullName,
        favorite: projectMembers.favorite,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(mine)
      .orderBy(asc(projects.id));
    const running = await runningRuns(db, user.userId);
    // A story Claude works on has only its pending question to show: no review or check meanwhile.
    const working = new Set(running.map((r) => r.storyId));
    const waiting = (
      await db
        .select({
          ...storyColumns,
          status: userStories.status,
          prNumber: userStories.prNumber,
          prCiState: userStories.prCiState,
          relaunchCount: userStories.relaunchCount,
          prReviewState: userStories.prReviewState,
          kind: userStories.kind,
          prAppFiles: userStories.prAppFiles,
          updatedAt: userStories.updatedAt,
        })
        .from(userStories)
        .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
        .innerJoin(projects, eq(projects.id, tickets.projectId))
        .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
        .where(
          and(
            mine,
            inArray(userStories.status, ["to_validate", "in_review", "ready"]),
          ),
        )
        .orderBy(asc(userStories.id))
    ).filter((w) => !working.has(w.storyId));

    // The mockup says « 3 critères » under a story to validate.
    const toValidate = waiting.filter((w) => w.status === "to_validate");
    const criteriaCount = new Map<number, number>();
    if (toValidate.length)
      for (const k of await db
        .select({ storyId: acceptanceCriteria.storyId })
        .from(acceptanceCriteria)
        .where(
          inArray(
            acceptanceCriteria.storyId,
            toValidate.map((w) => w.storyId),
          ),
        ))
        criteriaCount.set(k.storyId, (criteriaCount.get(k.storyId) ?? 0) + 1);

    // The latest run (highest id) of each ready story; one to check needs its criteria, read together.
    const ready = waiting.filter((w) => w.status === "ready");
    const latest = new Map<number, typeof runs.$inferSelect>();
    if (ready.length)
      for (const r of await db
        .select()
        .from(runs)
        .where(
          inArray(
            runs.storyId,
            ready.map((w) => w.storyId),
          ),
        )
        .orderBy(desc(runs.id)))
        if (!latest.has(r.storyId)) latest.set(r.storyId, r);
    const finished = ready.filter(
      (w) =>
        latest.get(w.storyId)?.status !== undefined &&
        latest.get(w.storyId)?.status !== "running",
    );
    const criteria = finished.length
      ? await db
          .select({
            storyId: acceptanceCriteria.storyId,
            result: acceptanceCriteria.result,
            resultRunId: acceptanceCriteria.resultRunId,
          })
          .from(acceptanceCriteria)
          .where(
            inArray(
              acceptanceCriteria.storyId,
              finished.map((w) => w.storyId),
            ),
          )
      : [];
    const checks = finished.flatMap((w) => {
      const run = latest.get(w.storyId);
      if (!run) return [];
      const { acceptable, reasons } = runVerdict(
        run,
        w,
        criteria.filter((k) => k.storyId === w.storyId),
      );
      return acceptable
        ? []
        : [
            {
              kind: "check" as const,
              storyId: w.storyId,
              iWant: w.iWant,
              runId: run.id,
              reasons,
              project: project(w),
            },
          ];
    });

    // Claude cannot fix the CI by itself any more (decision 059 D): first, before the questions.
    const exhausted = waiting.flatMap((w) =>
      w.status === "in_review" &&
      w.prNumber !== null &&
      w.prCiState === "failure" &&
      w.relaunchCount >= MAX_RELAUNCHES
        ? [
            {
              kind: "relaunch_exhausted" as const,
              storyId: w.storyId,
              iWant: w.iWant,
              prNumber: w.prNumber,
              project: project(w),
            },
          ]
        : [],
    );
    // The question of a paused run (044 E) is the first thing to answer: its story waits.
    const answerOf = (r: (typeof running)[number]) =>
      r.questionId === null || r.question === null
        ? []
        : [
            {
              kind: "answer" as const,
              questionId: r.questionId,
              question: r.question,
              suggestedAnswers: r.suggestedAnswers,
              context: r.context,
              agent: r.agent,
              askedAt: r.askedAt,
              runId: r.runId,
              storyId: r.storyId,
              iWant: r.iWant,
              project: project(r),
            },
          ];
    const forYou = [
      ...(await runningRuns(db, user.userId, "paused")).flatMap(answerOf),
      ...exhausted,
      ...running.flatMap(answerOf),
      ...toValidate.map((w) => ({
        kind: "validate" as const,
        storyId: w.storyId,
        iWant: w.iWant,
        criteriaCount: criteriaCount.get(w.storyId) ?? 0,
        updatedAt: w.updatedAt,
        project: project(w),
      })),
      ...waiting.flatMap((w) =>
        w.status === "in_review" &&
        w.prNumber !== null &&
        !exhausted.some((e) => e.storyId === w.storyId)
          ? [
              {
                kind: "review" as const,
                storyId: w.storyId,
                iWant: w.iWant,
                prNumber: w.prNumber,
                prCiState: w.prCiState,
                updatedAt: w.updatedAt,
                project: project(w),
              },
            ]
          : [],
      ),
      ...checks,
      // Decision 084 E: a proposal of Claude on a workflow waits for the human; last, it is no question and blocks nothing.
      ...(
        await db
          .select({
            proposalId: workflowProposals.id,
            path: workflowProposals.path,
            reason: workflowProposals.reason,
            projectId: projects.id,
            projectName: projects.fullName,
          })
          .from(workflowProposals)
          .innerJoin(projects, eq(projects.id, workflowProposals.projectId))
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(and(mine, isNull(workflowProposals.decision)))
          .orderBy(asc(workflowProposals.id))
      ).map((p) => ({
        kind: "workflow_proposal" as const,
        proposalId: p.proposalId,
        path: p.path,
        reason: p.reason,
        project: project(p),
      })),
    ];
    const forYouIn = new Set(forYou.map((i) => i.project.id));
    const claudeIn = new Set(running.map((r) => r.projectId));
    return c.json({
      onboarding: user.onboardingHiddenAt
        ? null
        : await onboardingOf(db, user.userId),
      night: await morningOf(db, user.userId, new Date(now())),
      forYou,
      claudeWorks: running.map((r) => ({
        runId: r.runId,
        storyId: r.storyId,
        iWant: r.iWant,
        project: project(r),
        step: r.step,
      })),
      projects: list.map((p) => ({
        ...p,
        state: forYouIn.has(p.id)
          ? ("for_you" as const)
          : claudeIn.has(p.id)
            ? ("claude" as const)
            : ("idle" as const),
      })),
    });
  });
}

/** The page « Claude » (decision 058 F): the questions, the running runs, the runs finished today and the ready stories that can be queued. */
export function claudeRoutes(db: Db) {
  return new Hono().get("/api/claude", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const mine = mineOf(user.userId);
    const running = await runningRuns(db, user.userId);
    const launches = running.length
      ? await db
          .select({ runId: cloudLaunches.runId })
          .from(cloudLaunches)
          .where(
            inArray(
              cloudLaunches.runId,
              running.map((r) => r.runId),
            ),
          )
      : [];
    const inCloud = new Set(launches.map((l) => l.runId));
    const finished = await db
      .select({
        ...storyColumns,
        runId: runs.id,
        status: runs.status,
        summary: runs.summary,
        storyStatus: userStories.status,
        prNumber: userStories.prNumber,
        prCiState: userStories.prCiState,
        prReviewState: userStories.prReviewState,
        kind: userStories.kind,
        prAppFiles: userStories.prAppFiles,
      })
      .from(runs)
      .innerJoin(userStories, eq(userStories.id, runs.storyId))
      .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          mine,
          // shortcut: midnight of the database's time zone (UTC on the Pi), not the user's; upgrade when users span time zones.
          gte(runs.finishedAt, sql`date_trunc('day', now())`),
        ),
      )
      .orderBy(desc(runs.id));
    const finishedCriteria = finished.length
      ? await db
          .select({
            storyId: acceptanceCriteria.storyId,
            result: acceptanceCriteria.result,
            resultRunId: acceptanceCriteria.resultRunId,
          })
          .from(acceptanceCriteria)
          .where(
            inArray(
              acceptanceCriteria.storyId,
              finished.map((r) => r.storyId),
            ),
          )
      : [];
    const ready = await db
      .select(storyColumns)
      .from(userStories)
      .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .leftJoin(queueItems, eq(queueItems.storyId, userStories.id))
      .where(
        and(
          mine,
          inArray(projectMembers.role, ["owner", "can_launch"]),
          eq(projectMembers.inLauncher, true),
          eq(userStories.status, "ready"),
          isNull(queueItems.id),
        ),
      )
      .orderBy(asc(userStories.id));
    return c.json({
      questions: running.flatMap((r) =>
        r.questionId === null || r.question === null
          ? []
          : [
              {
                questionId: r.questionId,
                question: r.question,
                runId: r.runId,
                storyId: r.storyId,
                iWant: r.iWant,
                project: project(r),
              },
            ],
      ),
      running: running.map((r) => ({
        runId: r.runId,
        storyId: r.storyId,
        iWant: r.iWant,
        project: project(r),
        step: r.step,
        cloud: inCloud.has(r.runId),
      })),
      finishedToday: finished.map((r) => ({
        runId: r.runId,
        storyId: r.storyId,
        iWant: r.iWant,
        project: project(r),
        outcome: r.status === "succeeded" ? "succeeded" : "failed",
        verdict: runVerdict(
          { id: r.runId, status: r.status },
          r,
          finishedCriteria.filter((k) => k.storyId === r.storyId),
        ),
        prNumber: r.prNumber,
        storyStatus: r.storyStatus,
        summary: r.summary,
      })),
      readyStories: ready.map((r) => ({
        storyId: r.storyId,
        iWant: r.iWant,
        project: project(r),
      })),
    });
  });
}
