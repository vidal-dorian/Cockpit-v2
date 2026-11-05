// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { validate, withStory } from "./test-decisions.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  mcpRows,
  userWithToken,
} from "./test-mcp.ts";
import {
  BRANCH,
  entries,
  finish,
  PR,
  reportStep,
  running,
  runningWithPr,
  runRoute,
  runRow,
  setStory,
  stepRows,
  storyRow,
} from "./test-run-controls.ts";

// Slice 7.5 (decision 037 B, C, G): POST /api/runs/:id/close, and rule C for finish_run.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criterion 3: the member closes a silent run", () => {
  it("given a running run with an open step and a story without PR, when a member closes it, then 200, closed_manually with finished_at, the step is closed failed, the story is ready, and one close_run entry is written", async () => {
    const s = await running();
    dataOf(await reportStep(s, s.runId));

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expect(res.status).toBe(200);
    const row = await runRow(s.db, s.runId);
    expect(row?.status).toBe("closed_manually");
    expect(row?.finished_at).not.toBeNull();
    const steps = await stepRows(s.db, s.runId);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("failed");
    expect(steps[0]?.finished_at).not.toBeNull();
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "ready",
      pr_number: null,
    });
    const found = await entries(s.db, "close_run");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      actor: "human",
      origin: "ui",
      result: "ok",
      user_id: s.alice.id,
      run_id: s.runId,
      story_id: s.id,
      project_id: s.projectId,
    });
  });

  it("given a story in_progress with a pr_number, when its run is closed, then the story goes back to in_review and keeps its PR", async () => {
    const s = await runningWithPr();

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expect(res.status).toBe(200);
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });

  it("given a closed run, when Claude calls report_step or finish_run, then both are refused run_finished", async () => {
    const s = await running();
    await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expectRefused(await reportStep(s, s.runId));
    expectRefused(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect((await mcpRows(s.db)).slice(-2)).toMatchObject([
      { action: "report_step", detail: { reason: "run_finished" } },
      { action: "finish_run", detail: { reason: "run_finished" } },
    ]);
    expect((await runRow(s.db, s.runId))?.status).toBe("closed_manually");
  });

  it("given a published story, when its run is closed, then the issue is resynced to the prête label", async () => {
    const s = await withStory("to_validate");
    expect((await validate(s.app, s.alice.cookie, s.id)).status).toBe(200);
    const { run_id } = dataOf<{ run_id: number }>(
      await callTool(s.app, s.alice.secret, "start_run", {
        story_id: s.id,
        branch: BRANCH,
        model: "claude-x",
      }),
    );
    expect(s.fetchMock.issues("user1000/app")[0]?.labels).toEqual([
      "cockpit: en cours",
    ]);

    const res = await runRoute(s.app, s.alice.cookie, run_id, "close");

    expect(res.status).toBe(200);
    expect(s.fetchMock.issues("user1000/app")[0]?.labels).toEqual([
      "cockpit: prête",
    ]);
  });

  it("given no session, when the close is posted, then 401 and nothing changes", async () => {
    const s = await running();

    const res = await runRoute(s.app, undefined, s.runId, "close");

    expect(res.status).toBe(401);
    expect((await runRow(s.db, s.runId))?.status).toBe("running");
  });

  it("given a non-member or an unknown run, when the close is posted, then 404 and nothing changes", async () => {
    const s = await running();
    const bob = await userWithToken(s.app, s.db, 2000);

    const foreign = await runRoute(s.app, bob.cookie, s.runId, "close");
    const unknown = await runRoute(s.app, s.alice.cookie, 99999, "close");

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect((await runRow(s.db, s.runId))?.status).toBe("running");
    expect(await entries(s.db, "close_run")).toHaveLength(0);
    // The member's own call finds the route: only the foreign and unknown ones are hidden.
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "close")).status,
    ).toBe(200);
  });

  it("given a finished run, when the close is posted, then 409 run_finished and nothing changes", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run_finished" });
    expect((await runRow(s.db, s.runId))?.status).toBe("failed");
    // Decision 010 C: a refusal leaves its entry too.
    expect((await entries(s.db, "close_run")).map((e) => e.result)).toEqual([
      "refused",
    ]);
  });

  it("given an archived project, when the close is posted, then 409 project_archived and nothing changes", async () => {
    const s = await running();
    await archiveProject(s.db, s.projectId);

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect((await runRow(s.db, s.runId))?.status).toBe("running");
  });

  it("given a story that someone moved off in_progress, when its run is closed, then the story status is left alone", async () => {
    const s = await running();
    await setStory(s.db, s.id, "abandoned", null);

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expect(res.status).toBe(200);
    expect((await storyRow(s.db, s.id))?.status).toBe("abandoned");
  });
});

describe("criterion 4 (rule C): finish_run failed on a story with a PR", () => {
  it("given a story in_progress with a pr_number, when Claude calls finish_run failed, then the story is in_review with its PR", async () => {
    const s = await runningWithPr();

    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });

  it("given a stop requested on a story with a pr_number, when Claude calls finish_run failed, then the run is stopped and the story is in_review", async () => {
    const s = await runningWithPr();
    await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect((await runRow(s.db, s.runId))?.status).toBe("stopped");
    expect((await storyRow(s.db, s.id))?.status).toBe("in_review");
  });

  it("given a story in_progress without PR, when Claude calls finish_run failed, then the story is ready, as before", async () => {
    const s = await running();

    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "ready",
      pr_number: null,
    });
  });
});
