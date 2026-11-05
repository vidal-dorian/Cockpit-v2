import { afterEach, describe, expect, it, vi } from "vitest";
import { githubCalls, issueCalls } from "./test-github.ts";
import { deliveryRow, entriesOf, pass, REPO } from "./test-issue-edit.ts";
import { historyText } from "./test-mcp.ts";
import {
  expectStoryChange,
  followed,
  PR,
  pullRequestDelivery,
  storyRow,
} from "./test-pr-follow.ts";

// Slice 7.6 (decision 038 B, C, D, H): a pull_request delivery makes the story follow the PR, as GitHub says it is now.

afterEach(() => {
  vi.unstubAllGlobals();
});

const issueOf = (s: Awaited<ReturnType<typeof followed>>) =>
  s.fetchMock.issues(REPO)[0];

describe("criterion 1: a merged PR finishes the story", () => {
  it.each(["in_review", "in_progress"] as const)(
    "given a story %s with pr_number 12, when pull_request closed is processed and GitHub says the PR is merged, then the story is done and keeps its pr_number",
    async (status) => {
      const s = await followed(status);
      s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
      const id = await pullRequestDelivery(s.db, { action: "closed" });

      await pass(s.db);

      expect(await storyRow(s.db, s.id)).toMatchObject({
        status: "done",
        pr_number: PR,
      });
      expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
    },
  );

  it("given a merge, when the delivery is processed, then one pull_request_merged entry (actor github, origin webhook, story, ticket, project, member) is written", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    await pullRequestDelivery(s.db, { action: "closed" });

    await pass(s.db);

    const found = await entriesOf(s.db, "pull_request_merged");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      actor: "github",
      origin: "webhook",
      user_id: s.alice.id,
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
    });
    expect(await entriesOf(s.db, "pull_request_closed")).toEqual([]);
  });

  it("given a merge, when the delivery is processed, then the published issue is resynced: closed as completed with the label « terminée »", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    await pullRequestDelivery(s.db, { action: "closed" });

    await pass(s.db);

    expect(issueOf(s)).toMatchObject({
      state: "closed",
      stateReason: "completed",
      labels: ["cockpit: terminée"],
    });
  });

  it("given a merge, when the delivery is processed, then change story:<id> is published", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    await pullRequestDelivery(s.db, { action: "closed" });

    await expectStoryChange(s, () => pass(s.db));
  });

  it("given the same delivery processed twice (a second delivery of the same merge), when it runs, then the story is done once and one entry exists", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    await pullRequestDelivery(s.db, { action: "closed" });
    await pass(s.db);
    await pullRequestDelivery(s.db, { action: "closed" });

    await pass(s.db);

    expect(await entriesOf(s.db, "pull_request_merged")).toHaveLength(1);
  });
});

describe("criterion 2: a PR closed without merge", () => {
  it("given an in_review story with a cached CI and review, when the PR is closed without merge, then the story is ready without PR and without cache, with one pull_request_closed entry", async () => {
    const s = await followed("in_review", PR, {
      ci: "success",
      review: "approved",
    });
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: false });
    await pullRequestDelivery(s.db, { action: "closed" });

    await pass(s.db);

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "ready",
      pr_number: null,
      pr_ci_state: null,
      pr_review_state: null,
    });
    const found = await entriesOf(s.db, "pull_request_closed");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      actor: "github",
      origin: "webhook",
      user_id: s.alice.id,
      project_id: s.projectId,
      story_id: s.id,
    });
    expect(await entriesOf(s.db, "pull_request_merged")).toEqual([]);
    expect(issueOf(s)?.labels).toEqual(["cockpit: prête"]);
  });

  it("given an in_progress story (a relaunch), when its PR is closed without merge, then it keeps its status and loses its PR, with one pull_request_closed entry", async () => {
    const s = await followed("in_progress", PR, {
      ci: "failure",
      review: "changes_requested",
    });
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: false });
    await pullRequestDelivery(s.db, { action: "closed" });

    await pass(s.db);

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_progress",
      pr_number: null,
      pr_ci_state: null,
      pr_review_state: null,
    });
    expect(await entriesOf(s.db, "pull_request_closed")).toHaveLength(1);
    expect(issueOf(s)?.labels).toEqual(["cockpit: en cours"]);
  });

  it("given a close without merge, when the delivery is processed, then change story:<id> is published", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: false });
    await pullRequestDelivery(s.db, { action: "closed" });

    await expectStoryChange(s, () => pass(s.db));
  });
});

describe("criterion 5: what matches nothing, and a GitHub failure", () => {
  let issueCallsBefore = 0;
  const untouched = async (
    s: Awaited<ReturnType<typeof followed>>,
    id: string,
    before: unknown,
    historyBefore: string,
  ) => {
    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
    expect(await storyRow(s.db, s.id)).toEqual(before);
    expect(await historyText(s.db)).toBe(historyBefore);
    expect(issueCalls(s.fetchMock)).toHaveLength(issueCallsBefore);
  };

  it("given a delivery of a repo no project tracks, when it is processed, then nothing changes and it is processed", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    const before = await storyRow(s.db, s.id);
    const history = await historyText(s.db);
    const id = await pullRequestDelivery(s.db, {
      action: "closed",
      repoId: 999,
    });

    issueCallsBefore = issueCalls(s.fetchMock).length;
    await pass(s.db);

    await untouched(s, id, before, history);
  });

  it("given a delivery of a PR number no story has, when it is processed, then nothing changes, nothing is read and it is processed", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    const before = await storyRow(s.db, s.id);
    const history = await historyText(s.db);
    const calls = githubCalls(s.fetchMock).length;
    const id = await pullRequestDelivery(s.db, {
      action: "closed",
      number: 99,
    });

    issueCallsBefore = issueCalls(s.fetchMock).length;
    await pass(s.db);

    await untouched(s, id, before, history);
    expect(githubCalls(s.fetchMock)).toHaveLength(calls);
  });

  it.each(["ready", "done", "abandoned"] as const)(
    "given a story %s that has pr_number 12, when a closed delivery of PR 12 is processed, then nothing changes and it is processed",
    async (status) => {
      const s = await followed(status);
      s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
      const before = await storyRow(s.db, s.id);
      const history = await historyText(s.db);
      const id = await pullRequestDelivery(s.db, { action: "closed" });

      await pass(s.db);

      await untouched(s, id, before, history);
    },
  );

  it.each([
    ["the PR", "/pulls/12"],
    ["the check runs", "/check-runs"],
    ["the reviews", "/reviews"],
  ])(
    "given GitHub that fails reading %s, when a closed delivery of a merged PR is processed, then one failed attempt is counted, the delivery is not processed and nothing changes",
    async (_what, part) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const s = await followed("in_review");
      s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
      s.fetchMock.update({ failOn: (c) => c.path.endsWith(part) });
      const before = await storyRow(s.db, s.id);
      const history = await historyText(s.db);
      const id = await pullRequestDelivery(s.db, { action: "closed" });

      await pass(s.db);

      expect(await deliveryRow(s.db, id)).toMatchObject({
        processed_at: null,
        attempts: 1,
      });
      expect(await storyRow(s.db, s.id)).toEqual(before);
      expect(await historyText(s.db)).toBe(history);
    },
  );
});
