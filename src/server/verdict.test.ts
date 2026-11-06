import { describe, expect, it } from "vitest";
import { verdict } from "./verdict.ts";

// Slice 7.7 (decision 039 B, C): the pure rule. Pinned input shape:
// verdict({ runStatus, criteria: [{ result: "passed" | "failed" | null, givenByThisRun: boolean }],
//           prNumber: number | null, prCiState: "pending" | "success" | "failure" | null,
//           prReviewState: "approved" | "changes_requested" | null })
// -> { acceptable: boolean, reasons: string[] } (codes of 039 C, in that order).
// Without a PR, prCiState is not examined: only no_pull_request is said (no ci_missing).

const passed = { result: "passed", givenByThisRun: true } as const;
const good = {
  runStatus: "succeeded",
  criteria: [passed, passed],
  prNumber: 12,
  prCiState: "success",
  prReviewState: null,
} as const;
type Input = Parameters<typeof verdict>[0];
const v = (over: Partial<Input>) => verdict({ ...good, ...over } as Input);

describe("criterion 1: the rule of the verdict", () => {
  it.each([
    ["no review", null],
    ["an approved review", "approved"],
  ])(
    "given a succeeded run, every criterion passed by this run, a PR, CI success and %s, when the verdict is computed, then it is acceptable without reason",
    (_l, prReviewState) => {
      expect(v({ prReviewState } as Partial<Input>)).toEqual({
        acceptable: true,
        reasons: [],
      });
    },
  );

  it.each([
    ["failed", "run_not_succeeded", { runStatus: "failed" }],
    ["stopped", "run_not_succeeded", { runStatus: "stopped" }],
    ["closed_manually", "run_not_succeeded", { runStatus: "closed_manually" }],
    [
      "a failed criterion",
      "criteria_failed",
      { criteria: [passed, { result: "failed", givenByThisRun: true }] },
    ],
    [
      "a criterion without result",
      "criteria_not_reported",
      { criteria: [passed, { result: null, givenByThisRun: false }] },
    ],
    [
      "a criterion passed by another run",
      "criteria_not_reported",
      { criteria: [passed, { result: "passed", givenByThisRun: false }] },
    ],
    ["no PR", "no_pull_request", { prNumber: null, prCiState: null }],
    ["a failing CI", "ci_failing", { prCiState: "failure" }],
    ["a pending CI", "ci_pending", { prCiState: "pending" }],
    ["no CI on the PR", "ci_missing", { prCiState: null }],
    [
      "changes requested",
      "changes_requested",
      { prReviewState: "changes_requested" },
    ],
  ])(
    "given only %s, when the verdict is computed, then it is to check for the reason %s alone",
    (_l, code, over) => {
      expect(v(over as Partial<Input>)).toEqual({
        acceptable: false,
        reasons: [code],
      });
    },
  );

  it("given every defect at once, when the verdict is computed, then the reasons come in the order of the decision", () => {
    const all = verdict({
      runStatus: "failed",
      criteria: [
        { result: "failed", givenByThisRun: true },
        { result: null, givenByThisRun: false },
      ],
      prNumber: 12,
      prCiState: "failure",
      prReviewState: "changes_requested",
    });

    expect(all).toEqual({
      acceptable: false,
      reasons: [
        "run_not_succeeded",
        "criteria_failed",
        "criteria_not_reported",
        "ci_failing",
        "changes_requested",
      ],
    });
  });

  it("given no PR, a pending-free story and a stopped run, when the verdict is computed, then both reasons are listed in order", () => {
    expect(
      v({ runStatus: "stopped", prNumber: null, prCiState: null }).reasons,
    ).toEqual(["run_not_succeeded", "no_pull_request"]);
  });
});
