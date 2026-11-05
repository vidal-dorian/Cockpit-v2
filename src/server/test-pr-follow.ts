import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { BRANCH } from "./test-criteria.ts";
import type { FakeCheckRun } from "./test-github.ts";
import {
  type Published,
  publishedStory,
  REPO,
  REPO_ID,
  seedDelivery,
} from "./test-issue-edit.ts";
import { rows, type StoryStatus, type TestDb } from "./test-mcp.ts";

// Shared by the tests of slice 7.6 (decision 038). Pinned where the decision leaves room:
// - columns of user_stories: pr_ci_state ('pending' | 'success' | 'failure' | null) and pr_review_state
//   ('approved' | 'changes_requested' | null); a merge keeps pr_number, a close without merge empties the three;
// - entries pull_request_merged and pull_request_closed: actor github, origin webhook (delivery) or ui (button),
//   with user_id (a member of the project), project_id, ticket_id and story_id;
// - processDeliveries(db, { readInstance }) keeps its signature: the handler builds its GitHub reader from `readInstance` (githubReader);
// - the handlers read only the PR number of a payload (`pull_request.number`, `check_suite.pull_requests[].number`) and the repo id;
//   merged / state / head sha / check runs / reviews are read from GitHub (the fake of test-github.ts: setPull, setCheckRuns, setReviews);
// - POST /api/stories/:id/pr/refresh, no body, answers 200 { story } (the story of GET /api/stories/:id, which also has prCiState and prReviewState);
//   errors { error: "Unauthorized" } 401, { error: "Not found" } 404, { error: "no_pull_request" } 409, 502 when GitHub fails.

export const PR = 12;
export const HEAD = `sha-${PR}`;

export const storyRow = async (db: TestDb, id: number) => {
  const result = await db.execute(
    sql`select status, pr_number, to_jsonb(u)->>'pr_ci_state' as pr_ci_state, to_jsonb(u)->>'pr_review_state' as pr_review_state from user_stories u where id = ${id}`,
  );
  return (
    result as unknown as {
      rows: {
        status: string;
        pr_number: number | null;
        pr_ci_state: string | null;
        pr_review_state: string | null;
      }[];
    }
  ).rows[0];
};

/** A published story (issue #1 on GitHub) in the given status with PR 12 linked, and PR 12 open on the fake GitHub. */
export async function followed(
  status: StoryStatus = "in_review",
  prNumber: number | null = PR,
  cache: { ci?: string; review?: string } = {},
): Promise<Published> {
  const s = await publishedStory();
  await s.db.execute(
    sql`update user_stories set status = ${status}, pr_number = ${prNumber}, branch = ${BRANCH} where id = ${s.id}`,
  );
  // Only touched when a test seeds a cache: the other tests then fail on the behaviour, not on a missing column.
  if (cache.ci)
    await s.db.execute(
      sql`update user_stories set pr_ci_state = ${cache.ci} where id = ${s.id}`,
    );
  if (cache.review)
    await s.db.execute(
      sql`update user_stories set pr_review_state = ${cache.review} where id = ${s.id}`,
    );
  s.fetchMock.addPull(REPO, PR, BRANCH);
  return s;
}

export const runs = (...conclusions: (string | null)[]): FakeCheckRun[] =>
  conclusions.map((conclusion, i) => ({
    name: `check-${i}`,
    status:
      conclusion === null ||
      conclusion === "in_progress" ||
      conclusion === "queued"
        ? ((conclusion ?? "queued") as "queued" | "in_progress")
        : "completed",
    conclusion:
      conclusion === null ||
      conclusion === "in_progress" ||
      conclusion === "queued"
        ? null
        : conclusion,
  }));

const base = (repoId: number) => ({
  installation: { id: 77 },
  repository: { id: repoId, full_name: `owner/repo${repoId}` },
  sender: { login: "someone" },
});

/** A pending `pull_request` delivery for PR `number` of the repo `repoId`. */
export const pullRequestDelivery = (
  db: TestDb,
  over: { action?: string; number?: number; repoId?: number } = {},
) =>
  seedDelivery(db, {
    event: "pull_request",
    action: over.action ?? "synchronize",
    repoId: over.repoId ?? REPO_ID,
    payload: {
      ...base(over.repoId ?? REPO_ID),
      action: over.action ?? "synchronize",
      number: over.number ?? PR,
      pull_request: { number: over.number ?? PR },
    },
  });

/** A pending `check_suite` delivery that lists the pull requests it concerns. */
export const checkSuiteDelivery = (
  db: TestDb,
  numbers: number[] = [PR],
  repoId = REPO_ID,
) =>
  seedDelivery(db, {
    event: "check_suite",
    action: "completed",
    repoId,
    payload: {
      ...base(repoId),
      action: "completed",
      check_suite: {
        head_sha: HEAD,
        pull_requests: numbers.map((number) => ({ number })),
      },
    },
  });

/** A pending `pull_request_review` delivery. */
export const reviewDelivery = (db: TestDb, number = PR, repoId = REPO_ID) =>
  seedDelivery(db, {
    event: "pull_request_review",
    action: "submitted",
    repoId,
    payload: {
      ...base(repoId),
      action: "submitted",
      pull_request: { number },
      review: { state: "approved" },
    },
  });

export const entries = (db: TestDb, action: string) =>
  rows(db, sql`action = ${action}`);

// --- the stream of the members ---

async function readUntil(
  res: Response,
  done: (text: string) => boolean,
  ms = 2000,
) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  try {
    while (!done(text)) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), left)),
      ]);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/** Opens the stream of Alice, runs `act`, and expects `change story:<id>` to have been sent. */
export async function expectStoryChange(
  s: Published,
  act: () => Promise<unknown>,
) {
  const res = await s.app.request("/api/events", {
    headers: { cookie: s.alice.cookie },
  });
  await act();
  const key = `story:${s.id}`;
  const seen = (t: string) =>
    new RegExp(`event: change\\r?\\ndata: ${key}\\r?\\n`).test(t);
  const text = await readUntil(res, seen);
  expect(seen(text), `change ${key} in ${text}`).toBe(true);
}
