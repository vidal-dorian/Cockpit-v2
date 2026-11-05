// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { dataOf, expectRefused, mcpRows } from "./test-mcp.ts";
import {
  BRANCH,
  finish,
  inReview,
  link,
  PR,
  runRow,
  startRun,
  storyRow,
  tool,
} from "./test-run-controls.ts";

// Slice 7.5 (decision 037 E): an in_review story can be started again, on its branch, and keeps its PR.

afterEach(() => {
  vi.unstubAllGlobals();
});

const start = (s: Awaited<ReturnType<typeof inReview>>, branch = BRANCH) =>
  tool(s, "start_run", { story_id: s.id, branch, model: "claude-x" });

describe("criterion 5 (rule E): start_run on an in_review story", () => {
  it("given an in_review story with its branch and PR, when Claude calls start_run on that branch, then a running run starts, the story is in_progress and keeps pr_number", async () => {
    const s = await inReview();

    const data = dataOf<{ run_id: number; story: { status: string } }>(
      await start(s),
    );

    expect(data.story.status).toBe("in_progress");
    expect((await runRow(s.db, data.run_id))?.status).toBe("running");
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_progress",
      pr_number: PR,
    });
  });

  it("given a relaunched story, when Claude links the same PR, then the story is back to in_review", async () => {
    const s = await inReview();
    const runId = await startRun(s);

    const data = dataOf(await link(s, { run_id: runId, pr_number: PR }));

    expect(data).toEqual({ pr_number: PR, story_status: "in_review" });
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });

  it("given a relaunched story, when Claude calls finish_run succeeded, then it is accepted, as the PR is linked", async () => {
    const s = await inReview();
    const runId = await startRun(s);

    const data = dataOf<{ status: string }>(
      await finish(s, { run_id: runId, outcome: "succeeded", summary: "x" }),
    );

    expect(data.status).toBe("succeeded");
  });

  it("given a relaunched story, when Claude calls finish_run failed, then the story is back to in_review (rule C)", async () => {
    const s = await inReview();
    const runId = await startRun(s);

    dataOf(await finish(s, { run_id: runId, outcome: "failed", summary: "x" }));

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });

  it("given an in_review story, when start_run is called with another branch, then it is refused branch_mismatch and nothing changes", async () => {
    const s = await inReview();

    expectRefused(await start(s, "us/42-autre"));

    expect((await mcpRows(s.db)).at(-1)).toMatchObject({
      action: "start_run",
      result: "refused",
      detail: { reason: "branch_mismatch" },
    });
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });
});
