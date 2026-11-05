import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedStory, seedTicket, withProject } from "./test-mcp.ts";

// Decision 040 B: a story with a running run has no review or check item, only the answer to its pending question.

async function reviewedWithRun(question: boolean) {
  const ctx = await withProject();
  const ticketId = await seedTicket(ctx.db, ctx.projectId, "t");
  const storyId = await seedStory(ctx.db, ticketId, {
    status: "in_review",
    iWant: "en cours",
  });
  await ctx.db.execute(
    sql`update user_stories set pr_number = 9, pr_ci_state = 'success' where id = ${storyId}`,
  );
  const res = await ctx.db.execute(
    sql`insert into runs (story_id, user_id, status, model_actual) values (${storyId}, ${ctx.alice.id}, 'running', 'x') returning id`,
  );
  const runId = (res as unknown as { rows: { id: number }[] }).rows[0]?.id;
  if (question)
    await ctx.db.execute(
      sql`insert into questions (run_id, question) values (${runId}, 'Quoi ?')`,
    );
  const home = await ctx.app.request("/api/home", {
    headers: { cookie: ctx.alice.cookie },
  });
  return (await home.json()) as {
    forYou: { kind: string }[];
    claudeWorks: { runId: number }[];
  };
}

describe("a story Claude works on", () => {
  it("given a PR and a pending question on a running run, when I read the home, then forYou has the answer only", async () => {
    const { forYou } = await reviewedWithRun(true);

    expect(forYou.map((i) => i.kind)).toEqual(["answer"]);
  });

  it("given a PR and a running run without question, when I read the home, then forYou is empty and Claude works on it", async () => {
    const { forYou, claudeWorks } = await reviewedWithRun(false);

    expect(forYou).toEqual([]);
    expect(claudeWorks).toHaveLength(1);
  });
});
