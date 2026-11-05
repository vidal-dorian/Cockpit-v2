import { expect, it } from "vitest";
import { verdict } from "./verdict.ts";

it("given a story without criteria, when the verdict is computed, then it is not acceptable: criteria_not_reported", () => {
  expect(
    verdict({
      runStatus: "succeeded",
      criteria: [],
      prNumber: 12,
      prCiState: "success",
      prReviewState: null,
    }),
  ).toEqual({ acceptable: false, reasons: ["criteria_not_reported"] });
});
