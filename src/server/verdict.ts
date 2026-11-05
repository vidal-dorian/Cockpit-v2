import type { PR_CI_STATES, PR_REVIEW_STATES } from "./db/schema.ts";

/** The decision aid at the end of a run (decision 039 B, C): acceptable when nothing asks for a look, else the reasons in a fixed order. */
export function verdict(input: {
  runStatus: string;
  criteria: { result: "passed" | "failed" | null; givenByThisRun: boolean }[];
  prNumber: number | null;
  prCiState: (typeof PR_CI_STATES)[number] | null;
  prReviewState: (typeof PR_REVIEW_STATES)[number] | null;
}) {
  const { criteria, prNumber, prCiState } = input;
  const reasons = [
    input.runStatus !== "succeeded" && "run_not_succeeded",
    criteria.some((k) => k.givenByThisRun && k.result === "failed") &&
      "criteria_failed",
    criteria.some((k) => !k.givenByThisRun || k.result === null) &&
      "criteria_not_reported",
    prNumber === null && "no_pull_request",
    prNumber !== null && prCiState === "failure" && "ci_failing",
    prNumber !== null && prCiState === "pending" && "ci_pending",
    prNumber !== null && prCiState === null && "ci_missing",
    input.prReviewState === "changes_requested" && "changes_requested",
  ].filter((reason) => reason !== false);
  return { acceptable: reasons.length === 0, reasons };
}
