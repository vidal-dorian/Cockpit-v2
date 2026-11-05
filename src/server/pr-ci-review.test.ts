import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeCheckRun, FakeReview } from "./test-github.ts";
import { pass } from "./test-issue-edit.ts";
import { historyText } from "./test-mcp.ts";
import {
  checkSuiteDelivery,
  expectStoryChange,
  followed,
  HEAD,
  PR,
  pullRequestDelivery,
  reviewDelivery,
  runs,
  storyRow,
} from "./test-pr-follow.ts";

// Slice 7.6 (decision 038 B, E, F): the CI and the review of an open PR, re-read from GitHub and kept on the story.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";

describe("criterion 3: the CI state from the check runs of the head commit", () => {
  it.each(
    [
      ["no check run", [], null],
      ["one queued", runs("queued"), "pending"],
      ["one in progress", runs("in_progress"), "pending"],
      [
        "a success and one in progress",
        runs("success", "in_progress"),
        "pending",
      ],
      [
        "a failure and one in progress",
        runs("failure", "in_progress"),
        "failure",
      ],
      ["failure", runs("success", "failure"), "failure"],
      ["timed_out", runs("success", "timed_out"), "failure"],
      ["cancelled", runs("cancelled"), "failure"],
      ["action_required", runs("success", "action_required"), "failure"],
      ["startup_failure", runs("startup_failure"), "failure"],
      [
        "success, neutral and skipped",
        runs("success", "neutral", "skipped"),
        "success",
      ],
    ].map(([name, list, expected]) => [name, expected, list]) as [
      string,
      string | null,
      FakeCheckRun[],
    ][],
  )(
    "given %s, when a pull_request delivery is processed, then pr_ci_state is %s",
    async (_name, expected, list) => {
      const s = await followed("in_review", PR, {
        ci: expected ? undefined : "success",
      });
      s.fetchMock.setCheckRuns(REPO, HEAD, list);
      await pullRequestDelivery(s.db);

      await pass(s.db);

      expect((await storyRow(s.db, s.id))?.pr_ci_state).toBe(expected);
    },
  );

  it("given a commit that is not the head with a failing run, when the head is green, then pr_ci_state is success (only the head commit counts)", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, "sha-old", runs("failure"));
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("success"));
    await pullRequestDelivery(s.db);

    await pass(s.db);

    expect((await storyRow(s.db, s.id))?.pr_ci_state).toBe("success");
  });

  it("given a push (a new head commit) with its own runs, when the delivery is processed, then the runs of the new head are used", async () => {
    const s = await followed("in_review", PR, { ci: "failure" });
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("failure"));
    s.fetchMock.setPull(REPO, PR, { headSha: "sha-new" });
    s.fetchMock.setCheckRuns(REPO, "sha-new", runs("success"));
    await pullRequestDelivery(s.db);

    await pass(s.db);

    expect((await storyRow(s.db, s.id))?.pr_ci_state).toBe("success");
  });

  it("given a check_suite delivery listing PR 12, when it is processed, then the CI is re-read", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("success"));
    await checkSuiteDelivery(s.db, [PR]);

    await pass(s.db);

    expect(await storyRow(s.db, s.id)).toMatchObject({
      status: "in_review",
      pr_number: PR,
      pr_ci_state: "success",
    });
  });

  it("given a check_suite delivery listing several PRs, when it is processed, then only the story of the listed PR is updated", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("failure"));
    await checkSuiteDelivery(s.db, [7, PR, 8]);

    await pass(s.db);

    expect((await storyRow(s.db, s.id))?.pr_ci_state).toBe("failure");
  });

  it("given a check_suite delivery that lists no pull request, when it is processed, then nothing changes", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("failure"));
    await checkSuiteDelivery(s.db, []);

    await pass(s.db);

    expect((await storyRow(s.db, s.id))?.pr_ci_state).toBeNull();
  });

  it("given a CI update, when the delivery is processed, then no history entry is written and change story:<id> is published", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("failure"));
    await pullRequestDelivery(s.db);
    const before = await historyText(s.db);

    await expectStoryChange(s, () => pass(s.db));

    expect((await storyRow(s.db, s.id))?.pr_ci_state).toBe("failure");
    expect(await historyText(s.db)).toBe(before);
  });

  it("given an in_progress story with a PR, when a check_suite delivery is processed, then its CI is updated too", async () => {
    const s = await followed("in_progress");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("in_progress"));
    await checkSuiteDelivery(s.db);

    await pass(s.db);

    expect(await storyRow(s.db, s.id)).toMatchObject({
      status: "in_progress",
      pr_ci_state: "pending",
    });
  });
});

const review = (login: string, state: FakeReview["state"]): FakeReview => ({
  login,
  state,
});

describe("criterion 4: the review state from the last review of each reviewer", () => {
  it.each(
    [
      ["no review", [], null],
      ["only comments", [review("ana", "COMMENTED")], null],
      ["one approval", [review("ana", "APPROVED")], "approved"],
      [
        "one request for changes",
        [review("ana", "CHANGES_REQUESTED")],
        "changes_requested",
      ],
      [
        "an approval and a request for changes of two reviewers",
        [review("ana", "APPROVED"), review("bob", "CHANGES_REQUESTED")],
        "changes_requested",
      ],
      [
        "a request for changes then an approval by the same reviewer",
        [review("ana", "CHANGES_REQUESTED"), review("ana", "APPROVED")],
        "approved",
      ],
      [
        "an approval then a request for changes by the same reviewer",
        [review("ana", "APPROVED"), review("ana", "CHANGES_REQUESTED")],
        "changes_requested",
      ],
      [
        "an approval then a simple comment by the same reviewer",
        [review("ana", "APPROVED"), review("ana", "COMMENTED")],
        "approved",
      ],
      [
        "a request for changes then a simple comment by the same reviewer",
        [review("ana", "CHANGES_REQUESTED"), review("ana", "COMMENTED")],
        "changes_requested",
      ],
      [
        "an old request for changes of a reviewer who approved since, and a comment of another",
        [
          review("ana", "CHANGES_REQUESTED"),
          review("bob", "COMMENTED"),
          review("ana", "APPROVED"),
        ],
        "approved",
      ],
    ].map(([name, list, expected]) => [name, expected, list]) as [
      string,
      string | null,
      FakeReview[],
    ][],
  )(
    "given %s, when a pull_request_review delivery is processed, then pr_review_state is %s",
    async (_name, expected, list) => {
      const s = await followed("in_review", PR, {
        review: expected ? undefined : "approved",
      });
      s.fetchMock.setReviews(REPO, PR, list);
      await reviewDelivery(s.db);

      await pass(s.db);

      expect((await storyRow(s.db, s.id))?.pr_review_state).toBe(expected);
    },
  );

  it("given a review update, when the delivery is processed, then no history entry is written and change story:<id> is published", async () => {
    const s = await followed("in_review");
    s.fetchMock.setReviews(REPO, PR, [review("ana", "APPROVED")]);
    await reviewDelivery(s.db);
    const before = await historyText(s.db);

    await expectStoryChange(s, () => pass(s.db));

    expect((await storyRow(s.db, s.id))?.pr_review_state).toBe("approved");
    expect(await historyText(s.db)).toBe(before);
  });

  it("given a pull_request_review delivery of another PR, when it is processed, then the story is not touched", async () => {
    const s = await followed("in_review");
    s.fetchMock.setReviews(REPO, PR, [review("ana", "APPROVED")]);
    await reviewDelivery(s.db, 99);

    await pass(s.db);

    expect((await storyRow(s.db, s.id))?.pr_review_state).toBeNull();
  });
});
