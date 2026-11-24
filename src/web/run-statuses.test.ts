import { describe, expect, it } from "vitest";
import { RUN_STATUSES } from "./tickets.ts";

// Decision 094: a run whose pull request is still to open.
describe("run statuses", () => {
  it("given the run status pr_to_open, when it is labelled, then it reads « PR à ouvrir »", () => {
    expect(RUN_STATUSES.pr_to_open).toBe("PR à ouvrir");
  });
});
