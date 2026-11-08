import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  answerStatus,
  BRANCH,
  launch,
  readLauncher,
  ready,
  setup,
  tick,
} from "./test-launcher.ts";
import { archiveProject, callTool, dataOf, expectRefused } from "./test-mcp.ts";

// Slice 14.1 (decision 053 D, E, F): the cases the acceptance tests leave out.

afterEach(() => {
  vi.unstubAllGlobals();
});

const report = (ctx: Awaited<ReturnType<typeof ready>>, launchId: number) =>
  callTool(ctx.app, ctx.alice.secret, "report_launch", {
    launch_id: launchId,
    reason: "repository_not_in_task",
  });
const launchIdOf = async (res: Response) =>
  ((await res.json()) as { launchId: number }).launchId;

describe("the repo missing from the task (D)", () => {
  it("given a reported launch, when the launcher is read, then the project is missing until it is ticked again", async () => {
    const ctx = await ready();
    dataOf(await report(ctx, await launchIdOf(await launch(ctx))));

    expect(await readLauncher(ctx)).toMatchObject({
      projectIds: [],
      missingProjectIds: [ctx.projectId],
    });

    await tick(ctx);
    expect((await readLauncher(ctx)).projectIds).toEqual([ctx.projectId]);
    expect(await readLauncher(ctx)).not.toHaveProperty("missingProjectIds");
  });

  it("given a launch that was reported, when the project is ticked again, then the story launches again at once", async () => {
    const ctx = await ready();
    dataOf(await report(ctx, await launchIdOf(await launch(ctx))));
    await tick(ctx);

    expect((await launch(ctx)).status).toBe(201);
  });
});

describe("the refusals and failures of /fire (E)", () => {
  it("given an archived project and no launcher, when the user launches, then the first refusal of the order wins", async () => {
    const ctx = await setup();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await launch(ctx);

    expect(await res.json()).toMatchObject({ error: "project_archived" });
  });

  it.each([403, 404])(
    "given /fire answers %i, when the user launches, then the launcher needs reconnecting",
    async (status) => {
      const ctx = await ready(answerStatus(status));

      expect((await launch(ctx)).status).toBe(502);

      expect((await readLauncher(ctx)).needsReconnect).toBe(true);
    },
  );

  it("given /fire fails with a 500, when the user launches again at once, then it is not held by launch_pending", async () => {
    const ctx = await ready(answerStatus(500));
    expect((await launch(ctx)).status).toBe(502);

    expect((await launch(ctx)).status).toBe(502);
    expect(ctx.calls).toHaveLength(2);
  });
});

describe("start_run with a launch_id (F)", () => {
  it("given a launch that already has a run, when another run starts with it, then launch_started and the launch keeps its run", async () => {
    const ctx = await ready();
    const launchId = await launchIdOf(await launch(ctx));
    const start = () =>
      callTool(ctx.app, ctx.alice.secret, "start_run", {
        story_id: ctx.storyId,
        branch: BRANCH,
        model: "claude-x",
        launch_id: launchId,
      });
    const { run_id } = dataOf<{ run_id: number }>(await start());
    dataOf(
      await callTool(ctx.app, ctx.alice.secret, "finish_run", {
        run_id,
        outcome: "failed",
        summary: "stop",
      }),
    );

    const second = await start();

    expect(expectRefused(second)).toMatch(/already attached/);
    const runOf = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      `/api/runs/${run_id}`,
    );
    expect(((await runOf.json()) as { cloud: unknown }).cloud).not.toBeNull();
  });
});
