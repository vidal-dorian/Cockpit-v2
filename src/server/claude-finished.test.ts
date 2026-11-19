import { afterEach, describe, expect, it, vi } from "vitest";
import { finishLaunched, NOW, pass, queued, ready } from "./test-launcher.ts";

// Slice S07 (decision 085 L, 058 F): GET /api/claude gives each run finished today its verdict (the one of
// GET /api/runs/:id), the PR number of its story, the status of its story and the summary of the run.
//   finishedToday: [{ runId, storyId, iWant, project, outcome, verdict: { acceptable, reasons }, prNumber: number | null,
//     storyStatus: string, summary: string | null }]

afterEach(() => {
  vi.unstubAllGlobals();
});

type Finished = {
  runId: number;
  verdict: { acceptable: boolean; reasons: string[] };
  prNumber: number | null;
  storyStatus: string;
  summary: string | null;
};
const read = async (ctx: Awaited<ReturnType<typeof ready>>) =>
  (
    (await (
      await ctx.app.request("/api/claude", {
        headers: { cookie: ctx.alice.cookie },
      })
    ).json()) as { finishedToday: Finished[] }
  ).finishedToday;

describe("GET /api/claude, runs finished today", () => {
  it("given a run that succeeded with a PR, when read, then the row gives the verdict, the PR number, the story status in_review and the summary", async () => {
    const ctx = await ready();
    await queued(ctx, 1);
    await pass(ctx, NOW);
    const runId = await finishLaunched(ctx, "succeeded");

    const [row] = await read(ctx);

    expect(row).toMatchObject({
      runId,
      prNumber: 100 + ctx.storyId,
      storyStatus: "in_review",
      summary: "fini",
    });
    expect(row?.verdict.acceptable).toBe(false);
    expect(row?.verdict.reasons).not.toContain("run_not_succeeded");
  });

  it("given a run that failed, when read, then the row gives the verdict with run_not_succeeded, no PR and the summary of the failure", async () => {
    const ctx = await ready();
    await queued(ctx, 1);
    await pass(ctx, NOW);
    await finishLaunched(ctx, "failed");

    const [row] = await read(ctx);

    expect(row).toMatchObject({
      outcome: "failed",
      prNumber: null,
      summary: "fini",
    });
    expect(row?.verdict.reasons).toContain("run_not_succeeded");
    expect(row?.verdict.acceptable).toBe(false);
  });
});
