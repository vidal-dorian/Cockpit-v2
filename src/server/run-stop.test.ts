// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveProject,
  dataOf,
  expectRefused,
  userWithToken,
} from "./test-mcp.ts";
import { asked, getAnswer } from "./test-questions.ts";
import {
  entries,
  finish,
  link,
  PR,
  reportStep,
  running,
  runningWithPr,
  runRoute,
  runRow,
  storyRow,
} from "./test-run-controls.ts";

// Slice 7.5 (decision 037 A, C): POST /api/runs/:id/stop, and what Claude then reads and does.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criterion 1: the member asks Claude to stop", () => {
  it("given a running run, when a member stops it, then 200, stop_requested_at is set, the run still runs, and one request_stop entry (human, ui, ids filled) is written", async () => {
    const s = await running();

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    expect(res.status).toBe(200);
    const row = await runRow(s.db, s.runId);
    expect(row?.status).toBe("running");
    expect(row?.stop_requested_at).toBeTruthy();
    const found = await entries(s.db, "request_stop");
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

  it("given a stop requested, when Claude calls report_step and get_answer, then both answer stop_requested true", async () => {
    const s = await running();
    const questionId = await asked(s);
    expect(
      dataOf<{ stop_requested: boolean }>(await reportStep(s, s.runId))
        .stop_requested,
    ).toBe(false);
    await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    const step = dataOf<{ stop_requested: boolean }>(
      await reportStep(s, s.runId, "reviewer"),
    );
    const answer = dataOf<{ stop_requested: boolean }>(
      await getAnswer(s, { question_id: questionId }),
    );

    expect(step.stop_requested).toBe(true);
    expect(answer.stop_requested).toBe(true);
  });

  it("given no session, when the stop is posted, then 401 and nothing changes", async () => {
    const s = await running();

    const res = await runRoute(s.app, undefined, s.runId, "stop");

    expect(res.status).toBe(401);
    expect((await runRow(s.db, s.runId))?.stop_requested_at).toBeNull();
  });

  it("given a non-member or an unknown run, when the stop is posted, then 404 and nothing changes", async () => {
    const s = await running();
    const bob = await userWithToken(s.app, s.db, 2000);

    const foreign = await runRoute(s.app, bob.cookie, s.runId, "stop");
    const unknown = await runRoute(s.app, s.alice.cookie, 99999, "stop");

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect((await runRow(s.db, s.runId))?.stop_requested_at).toBeNull();
    expect(await entries(s.db, "request_stop")).toHaveLength(0);
    // The member's own call finds the route: only the foreign and unknown ones are hidden.
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "stop")).status,
    ).toBe(200);
  });

  it("given a finished run, when the stop is posted, then 409 run_finished and nothing changes", async () => {
    const s = await running();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run_finished" });
    expect((await runRow(s.db, s.runId))?.stop_requested_at).toBeNull();
  });

  it("given a stop already requested, when it is posted again, then 409 stop_already_requested and one entry only", async () => {
    const s = await running();
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "stop")).status,
    ).toBe(200);

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stop_already_requested" });
    // Decision 010 C: a refusal leaves its entry too.
    expect((await entries(s.db, "request_stop")).map((e) => e.result)).toEqual([
      "ok",
      "refused",
    ]);
  });

  it("given an archived project, when the stop is posted, then 409 project_archived and nothing changes", async () => {
    const s = await running();
    await archiveProject(s.db, s.projectId);

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect((await runRow(s.db, s.runId))?.stop_requested_at).toBeNull();
  });
});

describe("criterion 2: finish_run after a stop request", () => {
  it("given a stop requested, when Claude calls finish_run failed, then the run is stopped, with finished_at, and the story is ready", async () => {
    const s = await running();
    await runRoute(s.app, s.alice.cookie, s.runId, "stop");

    const data = dataOf<{ status: string }>(
      await finish(s, {
        run_id: s.runId,
        outcome: "failed",
        summary: "Arrêt demandé par l'utilisateur",
      }),
    );

    expect(data.status).toBe("stopped");
    const row = await runRow(s.db, s.runId);
    expect(row?.status).toBe("stopped");
    expect(row?.finished_at).not.toBeNull();
    expect((await storyRow(s.db, s.id))?.status).toBe("ready");
  });

  it("given no stop request, when Claude calls finish_run failed, then the run is failed", async () => {
    const s = await running();

    const data = dataOf<{ status: string }>(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect(data.status).toBe("failed");
  });

  it("given a stop requested and a linked PR, when Claude calls finish_run succeeded, then the run is succeeded", async () => {
    const s = await runningWithPr();
    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "stop")).status,
    ).toBe(200);

    const data = dataOf<{ status: string }>(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "PR" }),
    );

    expect(data.status).toBe("succeeded");
    expect((await runRow(s.db, s.runId))?.status).toBe("succeeded");
  });

  it("given a stop requested and a story without PR, when Claude calls finish_run succeeded, then it is still refused no_pull_request", async () => {
    const s = await running();
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "stop")).status,
    ).toBe(200);

    expectRefused(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "x" }),
    );

    expect((await runRow(s.db, s.runId))?.status).toBe("running");
  });
});

describe("criterion 7 (server side): GET /api/runs/:id exposes the controls' data", () => {
  it("given a run, when it is read before and after a stop request, then run.stopRequestedAt is null then a date, and story.status is the status of the story", async () => {
    const s = await running();
    const read = async () =>
      (await (
        await s.app.request(`/api/runs/${s.runId}`, {
          headers: { cookie: s.alice.cookie },
        })
      ).json()) as {
        run: { stopRequestedAt: string | null };
        story: { status: string };
      };

    const before = await read();
    expect(before.run.stopRequestedAt).toBeNull();
    expect(before.story.status).toBe("in_progress");
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "stop")).status,
    ).toBe(200);

    const after = await read();

    expect(typeof after.run.stopRequestedAt).toBe("string");
  });
});
