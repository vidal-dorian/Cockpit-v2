// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { withStory } from "./test-decisions.ts";
import {
  type App,
  callTool,
  dataOf,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
} from "./test-mcp.ts";

// Slice 7.1 (decision 033 H): the routes that read a run.
//
// Pinned shapes (camelCase like the story routes):
// - GET /api/runs/:id -> { run: { id, status, branch, model, comment, summary, startedAt, finishedAt },
//     steps: [{ id, agent, status, summary, startedAt, finishedAt }], story: { id, iWant }, project: { id, name } }
//   (the branch is the one of the story, `name` is the full name of the project)
// - GET /api/stories/:id -> story.runs: [{ id, status, startedAt, finishedAt }], most recent first.

afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (app: App, cookie: string | undefined, path: string) =>
  app.request(path, cookie ? { headers: { cookie } } : {});

async function withRun() {
  const s = await withStory("ready");
  const tool = (name: string, args: unknown) =>
    callTool(s.app, s.alice.secret, name, args);
  const { run_id } = dataOf<{ run_id: number }>(
    await tool("start_run", {
      story_id: s.id,
      branch: "us/42-login",
      model: "claude-x",
      comment: "Le complément",
    }),
  );
  return { ...s, tool, runId: run_id };
}

describe("criterion 6: GET /api/runs/:id", () => {
  it("given a run with two steps, when I read it, then I get the run, its steps in order, its story and its project", async () => {
    const s = await withRun();
    for (const agent of ["test-writer", "developer"]) {
      dataOf(
        await s.tool("report_step", {
          run_id: s.runId,
          agent,
          event: "started",
        }),
      );
      if (agent === "test-writer")
        dataOf(
          await s.tool("report_step", {
            run_id: s.runId,
            agent,
            event: "finished",
            status: "succeeded",
            summary: "ok",
          }),
        );
    }

    const res = await get(s.app, s.alice.cookie, `/api/runs/${s.runId}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: Record<string, unknown>;
      steps: Record<string, unknown>[];
      story: unknown;
      project: unknown;
    };
    expect(body.run).toMatchObject({
      id: s.runId,
      status: "running",
      branch: "us/42-login",
      model: "claude-x",
      comment: "Le complément",
      summary: null,
      finishedAt: null,
    });
    expect(typeof body.run.startedAt).toBe("string");
    expect(body.steps).toMatchObject([
      { agent: "test-writer", status: "succeeded", summary: "ok" },
      { agent: "developer", status: "running", finishedAt: null },
    ]);
    expect(typeof body.steps[0]?.startedAt).toBe("string");
    expect(typeof body.steps[0]?.finishedAt).toBe("string");
    expect(body.story).toEqual({
      id: s.id,
      iWant: "relire",
      status: "in_progress",
      prNumber: null,
      prCiState: null,
      prReviewState: null,
    });
    expect(body.project).toEqual({
      id: s.projectId,
      name: "user1000/app",
      archived: false,
    });
  });

  it("given a finished run, when I read it, then it has its summary and finishedAt", async () => {
    const s = await withRun();
    dataOf(
      await s.tool("finish_run", {
        run_id: s.runId,
        outcome: "failed",
        summary: "Bloqué",
      }),
    );

    const body = (await (
      await get(s.app, s.alice.cookie, `/api/runs/${s.runId}`)
    ).json()) as { run: Record<string, unknown> };

    expect(body.run).toMatchObject({ status: "failed", summary: "Bloqué" });
    expect(typeof body.run.finishedAt).toBe("string");
  });

  it("given the run of someone else, an unknown run or a bad id, when I read it, then 404; without a session, 401", async () => {
    const s = await withRun();
    const bob = await userWithToken(s.app, s.db, 2000);
    await seedProject(s.db, bob.id, { githubRepoId: 2, fullName: "bob/app" });

    expect((await get(s.app, bob.cookie, `/api/runs/${s.runId}`)).status).toBe(
      404,
    );
    expect(
      (await get(s.app, s.alice.cookie, `/api/runs/${s.runId + 99}`)).status,
    ).toBe(404);
    expect((await get(s.app, s.alice.cookie, "/api/runs/abc")).status).toBe(
      404,
    );
    expect((await get(s.app, undefined, `/api/runs/${s.runId}`)).status).toBe(
      401,
    );
  });
});

describe("criterion 6: GET /api/stories/:id has the runs", () => {
  it("given two runs of a story, when it is read, then story.runs lists them most recent first; a story without runs has an empty list", async () => {
    const s = await withRun();
    dataOf(
      await s.tool("finish_run", {
        run_id: s.runId,
        outcome: "failed",
        summary: "x",
      }),
    );
    const second = dataOf<{ run_id: number }>(
      await s.tool("start_run", {
        story_id: s.id,
        branch: "us/42-login",
        model: "claude-x",
      }),
    ).run_id;
    const t = await seedTicket(s.db, s.projectId, "autre");
    const fresh = await seedStory(s.db, t, { status: "ready" });

    const read = async (id: number) =>
      (
        (await (
          await get(s.app, s.alice.cookie, `/api/stories/${id}`)
        ).json()) as { story: { runs: Record<string, unknown>[] } }
      ).story.runs;

    const runs = await read(s.id);
    expect(runs).toMatchObject([
      { id: second, status: "running", finishedAt: null },
      { id: s.runId, status: "failed" },
    ]);
    expect(typeof runs[0]?.startedAt).toBe("string");
    expect(typeof runs[1]?.finishedAt).toBe("string");
    expect(await read(fresh)).toEqual([]);
  });
});
