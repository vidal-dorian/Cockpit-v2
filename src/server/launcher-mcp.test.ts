// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRANCH,
  type Ctx,
  launch,
  readLauncher,
  ready,
} from "./test-launcher.ts";
import {
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  rows,
  seedStory,
  userWithToken,
} from "./test-mcp.ts";

// Slice 14.1 (decision 054 F, J): get_launch, report_launch and the launch_id of start_run, and the rights of the
// launch (the human launches, Claude only reads and reports).
//
// Pinned where the decision leaves room:
// - get_launch answers { launch_id, project: { id, full_name, default_branch }, story_id, branch, team, comment }.
// - report_launch answers { launch_id, reason }; start_run keeps its answer.
// - a refusal is journaled with detail { reason: <code> }; not_found for a launch of another user or an unknown one.
// - tables `cloud_launches(id, run_id, ...)`.

afterEach(() => {
  vi.unstubAllGlobals();
});

const tool = (ctx: Ctx, name: string, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, name, args);

async function launched(over: Record<string, unknown> = {}) {
  const ctx = await ready();
  const res = await launch(ctx, {
    branch: BRANCH,
    team: "fast",
    comment: "Le complément",
    ...over,
  });
  expect(res.status, "launching must work for this test").toBe(201);
  const { launchId } = (await res.json()) as { launchId: number };
  return { ...ctx, launchId };
}
const startRun = (ctx: Ctx, storyId: number, launchId: unknown) =>
  tool(ctx, "start_run", {
    story_id: storyId,
    branch: BRANCH,
    model: "claude-x",
    launch_id: launchId,
  });
const runIdOfLaunch = async (ctx: Ctx, launchId: number) =>
  (
    (await ctx.db.execute(
      sql`select run_id from cloud_launches where id = ${launchId}`,
    )) as unknown as { rows: { run_id: number | null }[] }
  ).rows[0]?.run_id;
const lastReason = async (ctx: Ctx) =>
  (await mcpRows(ctx.db)).at(-1)?.detail?.reason;

describe("criterion 5: get_launch", () => {
  it("given a launch, when its owner calls get_launch, then it gives the project, the story, the branch, the team and the comment", async () => {
    const s = await launched();

    const data = dataOf<Record<string, unknown>>(
      await tool(s, "get_launch", { launch_id: s.launchId }),
    );

    expect(data).toMatchObject({
      project: {
        id: s.projectId,
        full_name: "user1000/app",
        default_branch: "main",
      },
      story_id: s.storyId,
      branch: BRANCH,
      team: "fast",
      comment: "Le complément",
    });
  });

  it("given a launch, when get_launch is read, then its instructions give the /dev-us command with --launch, so the prompt of the task never changes", async () => {
    const s = await launched();

    const data = dataOf<{ instructions: string }>(
      await tool(s, "get_launch", { launch_id: s.launchId }),
    );

    expect(data.instructions).toBe(
      `In the repository user1000/app, run \`/dev-us ${s.storyId} --branch ${BRANCH} --team fast --launch ${s.launchId}\`, with the \`comment\` as its extra prompt. Push only to the branch ${BRANCH} and work only on that story.`,
    );
  });

  it("given a call, when the history is read, then get_launch is claude / mcp with args { launchId } and no comment", async () => {
    const s = await launched();
    dataOf(await tool(s, "get_launch", { launch_id: s.launchId }));

    const found = await rows(s.db, sql`action = 'get_launch'`);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: s.alice.id,
      actor: "claude",
      origin: "mcp",
      args: { launchId: s.launchId },
      result: "ok",
    });
    expect(JSON.stringify(found)).not.toContain("Le complément");
  });

  it("given the launch of another user, when get_launch is called, then it is refused not_found", async () => {
    const s = await launched();
    const bob = await userWithToken(s.app, s.db, 2000);

    const text = expectRefused(
      await callTool(s.app, bob.secret, "get_launch", {
        launch_id: s.launchId,
      }),
    );

    expect(text).toMatch(/not found/i);
    expect(text).not.toContain("user1000/app");
  });
});

describe("criterion 5: report_launch", () => {
  it("given a launch, when Claude reports repository_not_in_task, then the project is unticked and the entry has args { launchId }", async () => {
    const s = await launched();

    dataOf(
      await tool(s, "report_launch", {
        launch_id: s.launchId,
        reason: "repository_not_in_task",
      }),
    );

    expect((await readLauncher(s)).projectIds).toEqual([]);
    const found = await rows(s.db, sql`action = 'report_launch'`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: s.alice.id,
      actor: "claude",
      origin: "mcp",
      args: { launchId: s.launchId },
      result: "ok",
    });
  });

  it("given a launch with a run attached, when Claude reports it, then it is refused launch_started and the project stays ticked", async () => {
    const s = await launched();
    dataOf(await startRun(s, s.storyId, s.launchId));

    expectRefused(
      await tool(s, "report_launch", {
        launch_id: s.launchId,
        reason: "repository_not_in_task",
      }),
    );

    expect(await lastReason(s)).toBe("launch_started");
    expect((await readLauncher(s)).projectIds).toEqual([s.projectId]);
  });

  it("given the launch of another user, when report_launch is called, then it is refused not_found and the project stays ticked", async () => {
    const s = await launched();
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(s.app, bob.secret, "report_launch", {
        launch_id: s.launchId,
        reason: "repository_not_in_task",
      }),
    );

    expect((await readLauncher(s)).projectIds).toEqual([s.projectId]);
  });
});

describe("criterion 5: start_run with a launch_id", () => {
  it("given a launch of the caller for this story, when start_run gets its launch_id, then the run is attached to the launch", async () => {
    const s = await launched();

    const { run_id } = dataOf<{ run_id: number }>(
      await startRun(s, s.storyId, s.launchId),
    );

    expect(await runIdOfLaunch(s, s.launchId)).toBe(run_id);
  });

  it("given a launch of another story, when start_run gets its launch_id, then it is refused launch_mismatch and no run starts", async () => {
    const s = await launched();
    const other = await seedStory(s.db, s.ticketId, { status: "ready" });

    expectRefused(await startRun(s, other, s.launchId));

    expect(await lastReason(s)).toBe("launch_mismatch");
    expect(await runIdOfLaunch(s, s.launchId)).toBeNull();
    const runs = await s.db.execute(sql`select id from runs`);
    expect((runs as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
});

describe("criterion 5: the tools are listed, and the rights", () => {
  it("given the server, when tools/list is read, then get_launch and report_launch are listed with their arguments, in English, and start_run takes launch_id", async () => {
    const s = await ready();

    const tools = await listedTools(s.app, s.alice.secret);

    const named = (name: string) => tools.find((t) => t.name === name);
    expect(
      Object.keys(named("get_launch")?.inputSchema?.properties ?? {}),
    ).toEqual(["launch_id"]);
    expect(
      Object.keys(named("report_launch")?.inputSchema?.properties ?? {}).sort(),
    ).toEqual(["launch_id", "reason"]);
    expect(named("start_run")?.inputSchema?.properties).toHaveProperty(
      "launch_id",
    );
    expect(named("start_run")?.inputSchema?.required ?? []).not.toContain(
      "launch_id",
    );
    for (const name of ["get_launch", "report_launch"]) {
      expect(named(name)?.description?.trim().length, name).toBeGreaterThan(20);
      expect(named(name)?.description, name).not.toMatch(/[À-ÿ]/);
    }
  });

  it("given the rights table (a launch: human yes, Claude never), when Claude calls launch_story, then it is an unknown tool refused and journaled, no launch is made; the human's route works", async () => {
    const s = await ready();
    const text = expectRefused(
      await tool(s, "launch_story", {
        story_id: s.storyId,
        branch: BRANCH,
      }),
    );
    expect(text).toMatch(/unknown tool/i);
    expect(
      (await mcpRows(s.db)).map((e) => [e.action, e.result, e.detail]),
    ).toEqual([["launch_story", "refused", { reason: "unknown_tool" }]]);
    expect(s.calls).toHaveLength(0);
    expect(
      (await listedTools(s.app, s.alice.secret)).map((t) => t.name),
    ).not.toContain("launch_story");

    expect((await launch(s)).status).toBe(201);
  });
});
