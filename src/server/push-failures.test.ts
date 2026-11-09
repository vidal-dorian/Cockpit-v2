import { describe, expect, it } from "vitest";
import { systemStop } from "./cost.ts";
import { dataOf } from "./test-mcp.ts";
import { pass, pushDouble, subscribe } from "./test-push.ts";
import { finish, running } from "./test-questions.ts";

// Slice 15.2 (decision 072 C): a run that Cockpit stopped for its budget is a failure to tell.
const NOON = new Date("2026-11-09T12:00:00Z");

describe("slice 15.2: the run stopped for its budget", () => {
  it("given a run stopped by the budget cap, when it ends and the pass runs, then one push tells the failure", async () => {
    const s = await running();
    const push = pushDouble();
    await subscribe(s, s.alice.cookie);
    await systemStop(s.db, s.alice.id, s.projectId, s.runId, "budget");
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    await pass(s.db, NOON, push.fn);

    expect(push.calls).toHaveLength(1);
    expect(push.calls[0]?.payload.url).toBe(`/runs/${s.runId}`);
  });
});
