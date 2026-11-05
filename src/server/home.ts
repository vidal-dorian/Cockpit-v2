import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  projectMembers,
  projects,
  questions,
  runSteps,
  runs,
  tickets,
  userStories,
} from "./db/schema.ts";
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

/** The home of the user (decision 040 A to D): what waits for them, what Claude does, the state of each project; read in a few set-based queries, nothing stored. */
export function homeRoutes(db: Db) {
  return new Hono().get("/api/home", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const mine = and(
      eq(projectMembers.userId, user.userId),
      isNull(projects.archivedAt),
    );
    const list = await db
      .select({ id: projects.id, name: projects.fullName })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(mine)
      .orderBy(asc(projects.id));
    const running = await db
      .select({
        ...storyColumns,
        runId: runs.id,
        questionId: questions.id,
        question: questions.question,
        suggestedAnswers: questions.suggestedAnswers,
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
      .where(and(mine, eq(runs.status, "running")))
      .orderBy(asc(runs.id));
    const waiting = await db
      .select({
        ...storyColumns,
        status: userStories.status,
        prNumber: userStories.prNumber,
        prCiState: userStories.prCiState,
        prReviewState: userStories.prReviewState,
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
      .orderBy(asc(userStories.id));

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

    const forYou = [
      ...running.flatMap((r) =>
        r.questionId === null || r.question === null
          ? []
          : [
              {
                kind: "answer" as const,
                questionId: r.questionId,
                question: r.question,
                suggestedAnswers: r.suggestedAnswers,
                runId: r.runId,
                storyId: r.storyId,
                iWant: r.iWant,
                project: project(r),
              },
            ],
      ),
      ...waiting
        .filter((w) => w.status === "to_validate")
        .map((w) => ({
          kind: "validate" as const,
          storyId: w.storyId,
          iWant: w.iWant,
          project: project(w),
        })),
      ...waiting.flatMap((w) =>
        w.status === "in_review" && w.prNumber !== null
          ? [
              {
                kind: "review" as const,
                storyId: w.storyId,
                iWant: w.iWant,
                prNumber: w.prNumber,
                prCiState: w.prCiState,
                project: project(w),
              },
            ]
          : [],
      ),
      ...checks,
    ];
    const forYouIn = new Set(forYou.map((i) => i.project.id));
    const claudeIn = new Set(running.map((r) => r.projectId));
    return c.json({
      forYou,
      claudeWorks: running.map((r) => ({
        runId: r.runId,
        storyId: r.storyId,
        iWant: r.iWant,
        project: project(r),
        step: stepOf.get(r.runId) ?? null,
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
