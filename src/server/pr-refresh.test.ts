import { afterEach, describe, expect, it, vi } from "vitest";
import { bobsStory, send, withStory } from "./test-decisions.ts";
import { entriesOf, REPO } from "./test-issue-edit.ts";
import { historyText } from "./test-mcp.ts";
import { followed, HEAD, PR, runs, storyRow } from "./test-pr-follow.ts";

// Slice 7.6 (decision 038 B, G): POST /api/stories/:id/pr/refresh reads the PR again, like a delivery would.

afterEach(() => {
  vi.unstubAllGlobals();
});

const refresh = (
  s: { app: Parameters<typeof send>[0]; alice: { cookie: string } },
  id: number | string,
  cookie: string | undefined = s.alice.cookie,
) =>
  s.app.request(`/api/stories/${id}/pr/refresh`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });

type Shown = {
  id: number;
  status: string;
  prNumber: number | null;
  prCiState: string | null;
  prReviewState: string | null;
};

describe("criterion 7: the refresh route", () => {
  it("given an in_review story with an open PR, successful checks and an approval, when the member refreshes, then 200 { story } with prNumber, prCiState, prReviewState and status, and the columns are updated", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("success"));
    s.fetchMock.setReviews(REPO, PR, [{ login: "ana", state: "APPROVED" }]);

    const res = await refresh(s, s.id);

    expect(res.status).toBe(200);
    const { story } = (await res.json()) as { story: Shown };
    expect(story).toMatchObject({
      id: s.id,
      status: "in_review",
      prNumber: PR,
      prCiState: "success",
      prReviewState: "approved",
    });
    expect(await storyRow(s.db, s.id)).toMatchObject({
      pr_ci_state: "success",
      pr_review_state: "approved",
    });
  });

  it("given a refresh that changes nothing visible but the cache, when it runs, then no history entry is written", async () => {
    const s = await followed("in_review");
    s.fetchMock.setCheckRuns(REPO, HEAD, runs("failure"));
    const before = await historyText(s.db);

    const res = await refresh(s, s.id);

    expect(res.status).toBe(200);
    expect(await historyText(s.db)).toBe(before);
  });

  it("given a PR merged on GitHub, when the member refreshes, then the story is done (answered and stored) and pull_request_merged is written with origin ui", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });

    const res = await refresh(s, s.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { story: Shown }).story).toMatchObject({
      status: "done",
      prNumber: PR,
    });
    const found = await entriesOf(s.db, "pull_request_merged");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      actor: "github",
      origin: "ui",
      user_id: s.alice.id,
      project_id: s.projectId,
      story_id: s.id,
    });
    expect(s.fetchMock.issues(REPO)[0]).toMatchObject({
      state: "closed",
      labels: ["cockpit: terminée"],
    });
  });

  it("given a PR closed without merge, when the member refreshes, then the story is ready without PR and pull_request_closed is written with origin ui", async () => {
    const s = await followed("in_review", PR, { ci: "success" });
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: false });

    const res = await refresh(s, s.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { story: Shown }).story).toMatchObject({
      status: "ready",
      prNumber: null,
      prCiState: null,
      prReviewState: null,
    });
    const found = await entriesOf(s.db, "pull_request_closed");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ actor: "github", origin: "ui" });
  });

  it("given a story without pr_number, when the member refreshes, then 409 no_pull_request and nothing is read", async () => {
    const s = await withStory("ready");

    const res = await refresh(s, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_pull_request" });
  });

  it("given a story of a project the user is not a member of, when she refreshes, then 404", async () => {
    const s = await withStory("in_review");
    const { storyId } = await bobsStory(s);

    const res = await refresh(s, storyId);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("given an unknown story, when the member refreshes, then 404", async () => {
    const s = await withStory("in_review");

    expect((await refresh(s, 999_999)).status).toBe(404);
  });

  it("given no session, when someone refreshes, then 401", async () => {
    const s = await followed("in_review");

    const res = await refresh(s, s.id, "");

    expect(res.status).toBe(401);
  });

  it("given GitHub that fails, when the member refreshes, then 502 and the story is unchanged", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });
    s.fetchMock.update({ failOn: (c) => c.path.endsWith("/reviews") });
    const before = await storyRow(s.db, s.id);

    const res = await refresh(s, s.id);

    expect(res.status).toBe(502);
    expect(await storyRow(s.db, s.id)).toEqual(before);
    expect(await entriesOf(s.db, "pull_request_merged")).toEqual([]);
  });

  it("given a story whose cache holds CI and review states, when GET /api/stories/:id is called, then story.prCiState and story.prReviewState are exposed (null when empty)", async () => {
    const s = await followed("in_review", PR, {
      ci: "pending",
      review: "changes_requested",
    });
    const other = await withStory("ready");

    const shown = async (ctx: typeof s | typeof other) =>
      (
        (await (
          await send(ctx.app, ctx.alice.cookie, "GET", `/api/stories/${ctx.id}`)
        ).json()) as { story: Shown }
      ).story;

    expect(await shown(s)).toMatchObject({
      prNumber: PR,
      prCiState: "pending",
      prReviewState: "changes_requested",
    });
    expect(await shown(other)).toMatchObject({
      prCiState: null,
      prReviewState: null,
    });
  });
});
