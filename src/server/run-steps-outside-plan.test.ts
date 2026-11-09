import { afterEach, expect, it, vi } from "vitest";
import { withStory } from "./test-decisions.ts";
import { callTool, dataOf } from "./test-mcp.ts";

// Decision 069 B: an agent that is not in the plan clears the upcoming steps.

afterEach(() => {
  vi.unstubAllGlobals();
});

it("given a plan and a step of an agent outside it, when the run is read, then upcomingSteps is []", async () => {
  const s = await withStory("ready");
  const { run_id } = dataOf<{ run_id: number }>(
    await callTool(s.app, s.alice.secret, "start_run", {
      story_id: s.id,
      branch: "us/42-login",
      model: "claude-x",
      steps: ["test-writer", "developer", "reviewer"],
    }),
  );
  dataOf(
    await callTool(s.app, s.alice.secret, "report_step", {
      run_id,
      agent: "security-reviewer",
      event: "started",
    }),
  );

  const res = await s.app.request(`/api/runs/${run_id}`, {
    headers: { cookie: s.alice.cookie },
  });

  expect(
    ((await res.json()) as { upcomingSteps: string[] }).upcomingSteps,
  ).toEqual([]);
});
