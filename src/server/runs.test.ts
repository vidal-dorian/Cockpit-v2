// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withStory } from "./test-decisions.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  rows,
  seedStory,
  seedTicket,
  type TestDb,
  userWithToken,
} from "./test-mcp.ts";

// Slice 7.1 (decision 033): start_run, report_step and finish_run.
//
// Pinned where the decision leaves room (the shape of start_run follows update_user_story, 018):
// - start_run answers { run_id, story: { id, status, branch, active_run_id, ... }, criteria: [...] };
// - report_step answers { step_id, stop_requested }; finish_run answers { run_id, status };
// - refusal codes are in history.detail.reason, a refusal that found its objects fills project_id, ticket_id,
//   story_id (and run_id when the run is known); an invalid_arguments or not_found refusal may leave them null;
// - raw SQL reads: runs(story_id, user_id, status, model_actual, comment, summary, started_at, finished_at),
//   run_steps(run_id, agent, status, summary, started_at, finished_at), user_stories.branch, history.run_id.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withStory>>;
type Story = {
  id: number;
  status: string;
  branch: string | null;
  active_run_id: number | null;
};
type Started = { run_id: number; story: Story };

const all = async <T>(db: TestDb, query: ReturnType<typeof sql>) =>
  (await db.execute(query)) as unknown as { rows: T[] };
const runRows = async (db: TestDb) =>
  (
    await all<{
      id: number;
      story_id: number;
      user_id: number;
      status: string;
      model_actual: string;
      comment: string | null;
      summary: string | null;
      started_at: Date;
      finished_at: Date | null;
    }>(db, sql`select * from runs order by id`)
  ).rows;
const stepRows = async (db: TestDb) =>
  (
    await all<{
      id: number;
      run_id: number;
      agent: string;
      status: string;
      summary: string | null;
      finished_at: Date | null;
    }>(db, sql`select * from run_steps order by id`)
  ).rows;
const storyRow = async (db: TestDb, id: number) =>
  (
    await all<{ status: string; branch: string | null }>(
      db,
      sql`select status, branch from user_stories where id = ${id}`,
    )
  ).rows[0];

const startArgs = (id: unknown, over: Record<string, unknown> = {}) => ({
  story_id: id,
  branch: "us/42-login",
  model: "claude-x",
  comment: "Fais attention au CSS",
  ...over,
});
const start = (ctx: Ctx, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, "start_run", args);
const step = (ctx: Ctx, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, "report_step", args);
const finish = (ctx: Ctx, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, "finish_run", args);

/** A ready story with a running run. */
async function running() {
  const ctx = await withStory("ready");
  const { run_id } = dataOf<Started>(await start(ctx, startArgs(ctx.id)));
  return { ...ctx, runId: run_id };
}

describe("criterion 1: start_run starts a run on a ready story", () => {
  it("given a ready story, when Claude calls start_run, then a running run is created for me, the story is in_progress with its branch, and the answer has run_id and the story with branch and active_run_id", async () => {
    const s = await withStory("ready");

    const data = dataOf<Started>(await start(s, startArgs(s.id)));

    const runs = await runRows(s.db);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: data.run_id,
      story_id: s.id,
      user_id: s.alice.id,
      status: "running",
      model_actual: "claude-x",
      comment: "Fais attention au CSS",
    });
    expect(runs[0]?.finished_at).toBeNull();
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_progress",
      branch: "us/42-login",
    });
    expect(data.story).toMatchObject({
      id: s.id,
      status: "in_progress",
      branch: "us/42-login",
      active_run_id: data.run_id,
    });
  });

  it("given a story back to ready with its branch recorded, when start_run is called with the same branch, then a second run starts", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    const again = dataOf<Started>(await start(s, startArgs(s.id)));

    expect(again.run_id).not.toBe(s.runId);
    expect(again.story).toMatchObject({
      status: "in_progress",
      branch: "us/42-login",
    });
  });
});

describe("criterion 2: start_run refusals", () => {
  async function expectNothingChanged(
    s: Ctx,
    reason: string,
    before: { runs: number; story: unknown },
  ) {
    expect((await runRows(s.db)).length).toBe(before.runs);
    expect(await storyRow(s.db, s.id)).toEqual(before.story);
    const entries = await mcpRows(s.db);
    const last = entries[entries.length - 1];
    expect(last).toMatchObject({
      action: "start_run",
      result: "refused",
      detail: { reason },
    });
  }

  it.each([
    "to_validate",
    "to_rewrite",
    "in_progress",
    "done",
    "abandoned",
  ] as const)(
    "given a %s story, when start_run is called, then it is refused wrong_status and nothing changes",
    async (status) => {
      const s = await withStory(status);
      const before = { runs: 0, story: await storyRow(s.db, s.id) };

      expectRefused(await start(s, startArgs(s.id)));

      await expectNothingChanged(s, "wrong_status", before);
      expect(await mcpRows(s.db)).toMatchObject([
        { project_id: s.projectId, ticket_id: s.ticketId, story_id: s.id },
      ]);
    },
  );

  it("given a story that already has a running run, when start_run is called again, then it is refused run_active", async () => {
    const s = await running();
    // Back to ready by hand, so only the unique index can refuse.
    await s.db.execute(
      sql`update user_stories set status = 'ready' where id = ${s.id}`,
    );
    const before = { runs: 1, story: await storyRow(s.db, s.id) };

    expectRefused(await start(s, startArgs(s.id)));

    await expectNothingChanged(s, "run_active", before);
  });

  it("given a story whose recorded branch differs, when start_run is called with another branch, then it is refused branch_mismatch", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "bof" }),
    );
    const before = { runs: 1, story: await storyRow(s.db, s.id) };

    expectRefused(await start(s, startArgs(s.id, { branch: "us/42-autre" })));

    await expectNothingChanged(s, "branch_mismatch", before);
  });

  it("given an archived project, when start_run is called, then it is refused project_archived and nothing changes", async () => {
    const s = await withStory("ready");
    await archiveProject(s.db, s.projectId);
    const before = { runs: 0, story: await storyRow(s.db, s.id) };

    expectRefused(await start(s, startArgs(s.id)));

    await expectNothingChanged(s, "project_archived", before);
  });

  it("given the story of someone else, when start_run is called, then it is refused not_found and nothing changes", async () => {
    const s = await withStory("ready");
    const bob = await userWithToken(s.app, s.db, 2000);
    const before = { runs: 0, story: await storyRow(s.db, s.id) };

    expectRefused(
      await callTool(s.app, bob.secret, "start_run", startArgs(s.id)),
    );

    await expectNothingChanged(s, "not_found", before);
  });

  it.each(["-x", "a..b", "feat/", "a b", "/x", "x.", "é", "", "a".repeat(256)])(
    "given the branch %j, when start_run is called, then it is refused invalid_arguments and nothing changes",
    async (branch) => {
      const s = await withStory("ready");
      const before = { runs: 0, story: await storyRow(s.db, s.id) };

      expectRefused(await start(s, startArgs(s.id, { branch })));

      await expectNothingChanged(s, "invalid_arguments", before);
    },
  );

  it("given an empty model or a comment over 10 000 characters, when start_run is called, then it is refused invalid_arguments", async () => {
    const s = await withStory("ready");

    expectRefused(await start(s, startArgs(s.id, { model: "" })));
    expectRefused(
      await start(s, startArgs(s.id, { comment: "x".repeat(10_001) })),
    );

    expect(await runRows(s.db)).toHaveLength(0);
  });
});

describe("criterion 3: report_step", () => {
  it("given a running run, when report_step started then finished, then a step is opened then closed with its status and summary", async () => {
    const s = await running();

    const started = dataOf<{ step_id: number; stop_requested: boolean }>(
      await step(s, {
        run_id: s.runId,
        agent: "test-writer",
        event: "started",
      }),
    );

    expect(started.stop_requested).toBe(false);
    expect(await stepRows(s.db)).toMatchObject([
      {
        id: started.step_id,
        run_id: s.runId,
        agent: "test-writer",
        status: "running",
        finished_at: null,
      },
    ]);

    const finished = dataOf<{ step_id: number; stop_requested: boolean }>(
      await step(s, {
        run_id: s.runId,
        agent: "test-writer",
        event: "finished",
        status: "succeeded",
        summary: "ok",
      }),
    );

    expect(finished).toEqual({
      step_id: started.step_id,
      stop_requested: false,
    });
    const steps = await stepRows(s.db);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: "succeeded", summary: "ok" });
    expect(steps[0]?.finished_at).not.toBeNull();
  });

  it("given an open step of an agent, when that agent starts again, then it is refused step_open", async () => {
    const s = await running();
    const args = { run_id: s.runId, agent: "developer", event: "started" };
    dataOf(await step(s, args));

    expectRefused(await step(s, args));

    expect(await stepRows(s.db)).toHaveLength(1);
    expect((await mcpRows(s.db)).at(-1)).toMatchObject({
      action: "report_step",
      result: "refused",
      detail: { reason: "step_open" },
      run_id: s.runId,
    });
  });

  it("given no open step, when finished is reported, then it is refused no_open_step", async () => {
    const s = await running();

    expectRefused(
      await step(s, {
        run_id: s.runId,
        agent: "developer",
        event: "finished",
        status: "failed",
        summary: "x",
      }),
    );

    expect(await stepRows(s.db)).toHaveLength(0);
    expect((await mcpRows(s.db)).at(-1)).toMatchObject({
      result: "refused",
      detail: { reason: "no_open_step" },
    });
  });

  it("given a finished step, when the agent starts again, then a new step row is created", async () => {
    const s = await running();
    const base = { run_id: s.runId, agent: "reviewer" };
    const first = dataOf<{ step_id: number }>(
      await step(s, { ...base, event: "started" }),
    );
    dataOf(
      await step(s, {
        ...base,
        event: "finished",
        status: "failed",
        summary: "à refaire",
      }),
    );

    const second = dataOf<{ step_id: number }>(
      await step(s, { ...base, event: "started" }),
    );

    expect(second.step_id).not.toBe(first.step_id);
    expect(await stepRows(s.db)).toMatchObject([
      { status: "failed" },
      { status: "running" },
    ]);
  });

  it.each(["Test Writer", "UPPER", "-x", "", "a/b"])(
    "given the agent name %j, when report_step is called, then it is refused invalid_arguments",
    async (agent) => {
      const s = await running();

      expectRefused(
        await step(s, { run_id: s.runId, agent, event: "started" }),
      );

      expect(await stepRows(s.db)).toHaveLength(0);
      expect((await mcpRows(s.db)).at(-1)).toMatchObject({
        detail: { reason: "invalid_arguments" },
      });
    },
  );
});

describe("criterion 4: finish_run", () => {
  it.each(["failed"] as const)(
    "given a running run with an open step, when finish_run is called with outcome %s, then the run has that status and finished_at, the step is closed failed and the story is ready again",
    async (outcome) => {
      const s = await running();
      const opened = dataOf<{ step_id: number }>(
        await step(s, {
          run_id: s.runId,
          agent: "developer",
          event: "started",
        }),
      );

      dataOf(await finish(s, { run_id: s.runId, outcome, summary: "Fini" }));

      const runs = await runRows(s.db);
      expect(runs[0]).toMatchObject({ status: outcome, summary: "Fini" });
      expect(runs[0]?.finished_at).not.toBeNull();
      expect(await stepRows(s.db)).toMatchObject([
        { id: opened.step_id, status: "failed" },
      ]);
      expect((await stepRows(s.db))[0]?.finished_at).not.toBeNull();
      expect((await storyRow(s.db, s.id))?.status).toBe("ready");
    },
  );

  it("given a finished run, when finish_run or report_step is called, then both are refused run_finished", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "a" }),
    );

    expectRefused(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "b" }),
    );
    expectRefused(
      await step(s, { run_id: s.runId, agent: "developer", event: "started" }),
    );

    const refused = (await mcpRows(s.db)).slice(-2);
    expect(refused).toMatchObject([
      { action: "finish_run", detail: { reason: "run_finished" } },
      { action: "report_step", detail: { reason: "run_finished" } },
    ]);
    expect((await runRows(s.db))[0]).toMatchObject({
      status: "failed",
      summary: "a",
    });
    expect(await stepRows(s.db)).toHaveLength(0);
  });

  it("given the run of another user, when finish_run or report_step is called, then both are refused not_found and the run is untouched", async () => {
    const s = await running();
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(s.app, bob.secret, "finish_run", {
        run_id: s.runId,
        outcome: "failed",
        summary: "x",
      }),
    );
    expectRefused(
      await callTool(s.app, bob.secret, "report_step", {
        run_id: s.runId,
        agent: "developer",
        event: "started",
      }),
    );

    expect((await runRows(s.db))[0]?.status).toBe("running");
    expect(await stepRows(s.db)).toHaveLength(0);
  });

  it("given a summary that is empty or over 10 000 characters, or another outcome, when finish_run is called, then it is refused invalid_arguments", async () => {
    const s = await running();

    for (const bad of [
      { outcome: "failed", summary: "" },
      { outcome: "failed", summary: "x".repeat(10_001) },
      { outcome: "stopped", summary: "x" },
    ])
      expectRefused(await finish(s, { run_id: s.runId, ...bad }));

    expect((await runRows(s.db))[0]?.status).toBe("running");
  });
});

describe("criterion 5: the history of the three tools", () => {
  it("given a full run, when the history is read, then each call left one MCP entry with project_id, ticket_id, story_id and run_id", async () => {
    const s = await withStory("ready");
    const started = dataOf<Started>(await start(s, startArgs(s.id)));
    dataOf(
      await step(s, {
        run_id: started.run_id,
        agent: "developer",
        event: "started",
      }),
    );
    dataOf(
      await finish(s, {
        run_id: started.run_id,
        outcome: "failed",
        summary: "Arrêté",
      }),
    );

    const entries = await mcpRows(s.db);

    expect(entries.map((e) => [e.action, e.result])).toEqual([
      ["start_run", "ok"],
      ["report_step", "ok"],
      ["finish_run", "ok"],
    ]);
    for (const e of entries)
      expect(e).toMatchObject({
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
        run_id: started.run_id,
      });
  });

  it("given a refused start_run, when the history is read, then the entry has no run_id", async () => {
    const s = await withStory("done");

    expectRefused(await start(s, startArgs(s.id)));

    expect((await rows(s.db, sql`action = 'start_run'`))[0]).toMatchObject({
      run_id: null,
    });
  });
});

describe("get_user_story gives the branch and the active run (decision 033 F)", () => {
  it("given a story with a running run, when get_user_story is called, then it has branch and active_run_id; a fresh story has null for both", async () => {
    const s = await running();
    const t = await seedTicket(s.db, s.projectId, "autre");
    const fresh = await seedStory(s.db, t, { status: "ready" });

    const read = async (id: number) =>
      dataOf<{ story: Story }>(
        await callTool(s.app, s.alice.secret, "get_user_story", {
          story_id: id,
        }),
      ).story;

    expect(await read(s.id)).toMatchObject({
      branch: "us/42-login",
      active_run_id: s.runId,
    });
    expect(await read(fresh)).toMatchObject({
      branch: null,
      active_run_id: null,
    });
  });
});

describe("the three tools are listed", () => {
  it("given the server, when tools/list is called, then start_run, report_step and finish_run are listed", async () => {
    const s = await withStory("ready");

    const names = (await listedTools(s.app, s.alice.secret)).map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining(["start_run", "report_step", "finish_run"]),
    );
  });
});
