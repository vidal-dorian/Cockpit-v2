// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { withStory } from "./test-decisions.ts";
import { callTool, dataOf, type TestDb } from "./test-mcp.ts";

// Shared by the tests of slice 7.3 (decision 035). Pinned where the decision leaves room:
// - report_criterion({ run_id, criterion_id, result, evidence }) answers { criterion_id, result };
// - link_pull_request({ run_id, pr_number }) answers { pr_number, story_status };
// - raw SQL reads: acceptance_criteria(id, story_id, position, result, evidence, result_run_id), user_stories.pr_number;
// - refusal codes are in history.detail.reason, like the tools of slice 7.1.

export const REPO = "user1000/app";
export const BRANCH = "us/42-x";

export type Ctx = Awaited<ReturnType<typeof withStory>>;

export const all = async <T>(db: TestDb, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

export const tool = (ctx: Ctx, name: string, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, name, args);

export const startRun = async (ctx: Ctx, branch = BRANCH) =>
  dataOf<{ run_id: number }>(
    await tool(ctx, "start_run", {
      story_id: ctx.id,
      branch,
      model: "claude-x",
    }),
  ).run_id;

/** A ready story (two criteria, g1 and g2) with a running run on BRANCH. */
export async function running() {
  const ctx = await withStory("ready");
  return { ...ctx, runId: await startRun(ctx) };
}

/** The ids of the criteria of a story, in order. */
export const criterionIds = async (db: TestDb, storyId: number) =>
  (
    await all<{ id: number }>(
      db,
      sql`select id from acceptance_criteria where story_id = ${storyId} order by position`,
    )
  ).map((r) => r.id);

export const criterionRows = (db: TestDb) =>
  all<{
    id: number;
    result: string | null;
    evidence: string | null;
    result_run_id: number | null;
  }>(
    db,
    sql`select id, result, evidence, result_run_id from acceptance_criteria order by id`,
  );

export const storyRow = async (db: TestDb, id: number) =>
  (
    await all<{ status: string; pr_number: number | null }>(
      db,
      sql`select status, pr_number from user_stories where id = ${id}`,
    )
  )[0];

export const report = (ctx: Ctx, args: unknown) =>
  tool(ctx, "report_criterion", args);
export const link = (ctx: Ctx, args: unknown) =>
  tool(ctx, "link_pull_request", args);
export const finish = (ctx: Ctx, args: unknown) =>
  tool(ctx, "finish_run", args);
