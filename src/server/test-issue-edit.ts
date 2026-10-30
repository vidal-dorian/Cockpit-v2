// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { instanceReader } from "./instance.ts";
import { type Ctx, send, validate, withStory } from "./test-decisions.ts";
import { TEST_KEY } from "./test-instance.ts";
import { rows, type StoryStatus, type TestDb } from "./test-mcp.ts";
import { processDeliveries } from "./webhooks.ts";

// Shared by the tests of slice 5.2 (decision 025): an issue edited on GitHub, as the tests fabricate it.
//
// Pinned choices (the decision leaves them open), shared by every 5.2 test file:
//
// Processing (decision 025 A), in src/server/webhooks.ts:
// - `processDeliveries(db: Db, deps: { readInstance: ReadInstance }): Promise<void>`: one pass over the deliveries whose
//   `processed_at` is null. It never throws. `deps.readInstance` is the instance reader of instance.ts (it gives the App's slug);
//   the handler of `issues.edited` calls it for every delivery it handles, so a rejection of `readInstance` is a failure of the handler.
// - `scheduleDeliveries(db, deps): NodeJS.Timeout`: runs `processDeliveries` every 60,000 ms (an unref'd setInterval, like `schedulePurge`).
// - Columns to add to `webhook_deliveries`: `claimed_at timestamptz null` and `attempts integer not null default 0`.
//   A pass claims a delivery with one atomic statement: `claimed_at` empty or older than a minute. After a failure `attempts`
//   is one more and `processed_at` stays null; once `attempts` reaches 5 the delivery is marked processed and ONE entry
//   `process_webhook` (actor github, origin webhook, result error, detail { reason: "error" }, args { deliveryId },
//   user and project of the tracked repo, like `receive_webhook`) is written.
// - The route `POST /api/webhooks/github` starts a pass right after its 202 (the answer does not wait for it).
//
// What the handler reads of an `issues` delivery: `payload.action`, `payload.repository.id`, `payload.issue.number`,
// `payload.issue.title`, `payload.issue.body` (null on GitHub when empty: kept as ""), `payload.sender.login`.
//
// The divergence (decisions 025 B and C):
// - Columns to add to `user_stories`: `issue_github_title text null`, `issue_github_body text null`, `issue_diverged_at timestamptz null`.
// - The entry `issue_diverged` also carries the ticket id and the story id (so the history of the story shows it).
// - GET /api/stories/:id (and every `story` of a decision) gives `story.issue.diverged`: null, or
//   { at: ISO date, githubTitle, githubBody, cockpitTitle, cockpitBody } where the two cockpit* are `renderIssue(story)` now.
// - GET /api/projects/:id/stories: every card has `issueDiverged: boolean`.

export const REPO = "user1000/app";
/** The `githubRepoId` of Alice's project (withProject). */
export const REPO_ID = 1;
/** The slug of the test App (githubAppConfig). */
export const BOT = "cockpit-test[bot]";

export const readInstanceOf = (db: TestDb) => instanceReader(db, TEST_KEY);

/** One pass of the processing, with the real instance reader. */
export const pass = (db: TestDb) =>
  processDeliveries(db, { readInstance: readInstanceOf(db) });

let counter = 0;

export type SeedDelivery = {
  id?: string;
  event?: string;
  action?: string | null;
  repoId?: number | null;
  payload?: unknown;
  /** Seconds ago the delivery was claimed (needs the `claimed_at` column). */
  claimedAgo?: number;
  attempts?: number;
  /** Seconds ago the delivery was processed. */
  processedAgo?: number;
};

/** Inserts a delivery the way the route records it, with raw SQL so no test depends on the Drizzle export. Returns its id. */
export async function seedDelivery(db: TestDb, d: SeedDelivery = {}) {
  const id = d.id ?? `delivery-${++counter}`;
  const payload = JSON.stringify(d.payload ?? {});
  await db.execute(
    sql`insert into webhook_deliveries (id, event, action, installation_id, repo_id, payload) values (${id}, ${d.event ?? "ping"}, ${d.action ?? null}, 77, ${d.repoId ?? null}, ${payload}::jsonb)`,
  );
  if (d.claimedAgo !== undefined)
    await db.execute(
      sql`update webhook_deliveries set claimed_at = now() - make_interval(secs => ${d.claimedAgo}) where id = ${id}`,
    );
  if (d.attempts !== undefined)
    await db.execute(
      sql`update webhook_deliveries set attempts = ${d.attempts} where id = ${id}`,
    );
  if (d.processedAgo !== undefined)
    await db.execute(
      sql`update webhook_deliveries set processed_at = now() - make_interval(secs => ${d.processedAgo}) where id = ${id}`,
    );
  return id;
}

export type DeliveryRow = {
  id: string;
  processed_at: Date | null;
  claimed_at: Date | null;
  attempts: number;
};
export async function deliveryRow(db: TestDb, id: string) {
  const result = await db.execute(
    sql`select id, processed_at, claimed_at, attempts from webhook_deliveries where id = ${id}`,
  );
  const found = (result as unknown as { rows: DeliveryRow[] }).rows[0];
  expect(found, `delivery ${id} exists`).toBeDefined();
  return found as DeliveryRow;
}

/** The body of an `issues` delivery as GitHub sends it. */
export function issuesPayload(over: {
  action?: string;
  repoId?: number;
  number: number;
  title: string;
  body: string | null;
  login?: string;
}) {
  const repoId = over.repoId ?? REPO_ID;
  return {
    action: over.action ?? "edited",
    installation: { id: 77 },
    repository: { id: repoId, full_name: `owner/repo${repoId}` },
    issue: { number: over.number, title: over.title, body: over.body },
    sender: { login: over.login ?? "alice-on-github" },
  };
}

/** Delivers an edit of an issue and runs one pass; returns the delivery id. */
export async function editOnGitHub(
  db: TestDb,
  over: Parameters<typeof issuesPayload>[0] & { event?: string },
) {
  const id = await seedDelivery(db, {
    event: over.event ?? "issues",
    action: over.action ?? "edited",
    repoId: over.repoId ?? REPO_ID,
    payload: issuesPayload(over),
  });
  await pass(db);
  return id;
}

/** A story validated through the route: its issue is #1 of the repo, created by the fake GitHub. */
export async function publishedStory(
  over: Parameters<typeof withStory>[1] = {},
) {
  const s = await withStory("to_validate", over);
  expect((await validate(s.app, s.alice.cookie, s.id)).status).toBe(200);
  const issue = s.fetchMock.issues(REPO)[0];
  expect(issue, "the validation created the issue").toBeDefined();
  const github = issue as NonNullable<typeof issue>;
  return { ...s, number: github.number, github };
}

export type Published = Awaited<ReturnType<typeof publishedStory>>;

/**
 * Someone edits the issue on GitHub: the fake issue takes the new text (so a republication has something to overwrite),
 * then the delivery is processed. Returns the delivery id and the text Cockpit had published.
 */
export async function diverge(
  s: Published,
  edit: { title?: string; body?: string | null; login?: string },
) {
  const before = { title: s.github.title, body: s.github.body };
  const title = edit.title ?? before.title;
  const body =
    edit.body === undefined ? `${before.body}\n\nAjout humain` : edit.body;
  s.github.title = title;
  s.github.body = body ?? "";
  const deliveryId = await editOnGitHub(s.db, {
    number: s.number,
    title,
    body,
    login: edit.login,
  });
  return { deliveryId, before, title, body: body ?? "" };
}

/** Puts a published story in another status without touching GitHub (the sync of the route would). */
export const setStatus = (db: TestDb, id: number, status: StoryStatus) =>
  db.execute(sql`update user_stories set status = ${status} where id = ${id}`);

export type Divergence = {
  issue_github_title: string | null;
  issue_github_body: string | null;
  issue_diverged_at: Date | null;
  issue_number: number | null;
  issue_body_hash: string | null;
};
export async function divergenceOf(db: TestDb, id: number) {
  const result = await db.execute(
    sql`select issue_github_title, issue_github_body, issue_diverged_at, issue_number, issue_body_hash from user_stories where id = ${id}`,
  );
  return (result as unknown as { rows: Divergence[] }).rows[0] as Divergence;
}

export const NOT_DIVERGED = {
  issue_github_title: null,
  issue_github_body: null,
  issue_diverged_at: null,
};

export const entriesOf = (db: TestDb, action: string) =>
  rows(db, sql`action = ${action}`);

export const keepCockpit = (ctx: Ctx, cookie: string, id: number | string) =>
  send(ctx.app, cookie, "POST", `/api/stories/${id}/issue/keep-cockpit`);
export const takeGitHub = (ctx: Ctx, cookie: string, id: number | string) =>
  send(ctx.app, cookie, "POST", `/api/stories/${id}/issue/take-github`);
