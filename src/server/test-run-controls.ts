// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import {
  all,
  BRANCH,
  finish,
  link,
  running,
  startRun,
  storyRow,
  tool,
} from "./test-criteria.ts";
import { withStory } from "./test-decisions.ts";
import type { App } from "./test-mcp.ts";

// Shared by the tests of slice 7.5 (decision 037). Pinned where the decision leaves room:
// - POST /api/runs/:id/stop and /close, no body -> 200 { run: { id, status, stopRequestedAt } }; errors are { error: <code> }
//   with 404 "Not found", 409 "run_finished" | "stop_already_requested" (stop only) | "project_archived";
// - runs.stop_requested_at, runs.status ('stopped', 'closed_manually'), run_steps; entries request_stop and close_run
//   carry run_id, story_id, project_id, user_id, actor human, origin ui;
// - the tools answer stop_requested (report_step, get_answer) from runs.stop_requested_at.

/** What `running` gives: the context of a story with its running run. */
export type Ctx = Awaited<ReturnType<typeof running>>;
export { all, BRANCH, finish, link, running, startRun, storyRow, tool };

export const PR = 12;

export const runRoute = (
  app: App,
  cookie: string | undefined,
  id: number | string,
  action: "stop" | "close",
) =>
  app.request(`/api/runs/${id}/${action}`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });

export const runRow = async (db: Ctx["db"], id: number) =>
  (
    await all<{
      status: string;
      stop_requested_at: Date | null;
      finished_at: Date | null;
    }>(
      db,
      sql`select status, stop_requested_at, finished_at from runs where id = ${id}`,
    )
  )[0];

export const stepRows = (db: Ctx["db"], runId: number) =>
  all<{ status: string; finished_at: Date | null }>(
    db,
    sql`select status, finished_at from run_steps where run_id = ${runId}`,
  );

export const entries = (db: Ctx["db"], action: string) =>
  all<{
    actor: string;
    origin: string;
    result: string;
    run_id: number | null;
    story_id: number | null;
    project_id: number | null;
    user_id: number | null;
  }>(
    db,
    sql`select actor, origin, result, run_id, story_id, project_id, user_id from history where action = ${action} order by id`,
  );

/** Puts the story in_progress back to a state by hand (the run keeps running). */
export const setStory = (
  db: Ctx["db"],
  id: number,
  status: string,
  prNumber: number | null,
  branch: string | null = BRANCH,
) =>
  db.execute(
    sql`update user_stories set status = ${status}, pr_number = ${prNumber}, branch = ${branch} where id = ${id}`,
  );

/** An in_review story on BRANCH with PR 12 and no run yet. */
export async function inReview() {
  const ctx = await withStory("in_review");
  await setStory(ctx.db, ctx.id, "in_review", PR);
  ctx.fetchMock.addPull("user1000/app", PR, BRANCH);
  return ctx;
}

/** A running run on a story that has a linked PR (in_progress with pr_number). */
export async function runningWithPr() {
  const s = await running();
  await setStory(s.db, s.id, "in_progress", PR);
  s.fetchMock.addPull("user1000/app", PR, BRANCH);
  return s;
}

export const reportStep = (ctx: Ctx, runId: number, agent = "developer") =>
  tool(ctx, "report_step", { run_id: runId, agent, event: "started" });
