import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import {
  history,
  projectMembers,
  projects,
  sessions,
  users,
} from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 024 A, B, C, E (slice 5.1): POST /api/webhooks/github receives, verifies and records GitHub's deliveries.
//
// Pinned choices (the decision leaves them open):
// - A body over 25 MiB is refused with 413 (what Hono's bodyLimit answers), and nothing is stored.
// - The signature is checked first: a request with a wrong or missing signature is a 401 even when its other headers
//   or its body are also invalid.
// - A body without an `action` is stored and journaled with `action: null`.
// - Expected table `webhook_deliveries` (migration to add): id text pk, event text, action text null,
//   installation_id and repo_id (integers, null when the body has none), payload jsonb, received_at timestamptz
//   default now(), processed_at timestamptz null. It is read here with raw SQL, so the tests do not depend on the
//   Drizzle export.
// - GET /api/history adds an `event` field (the event code of args) to the entries whose action is receive_webhook,
//   so the Journal can name the event; the entries of every other action keep their exact keys.

const SECRET = "whsec-test-secret";
const GUID = "72d3162e-cc78-11e3-81ab-4c9367dc0958";

type App = ReturnType<typeof createApp>;
type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, { githubWebhookSecret: SECRET });
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app };
}

const sign = (body: string | Buffer, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

type Delivery = {
  body?: string | Buffer;
  /** undefined: signed with the instance secret; null: no header. */
  signature?: string | null;
  delivery?: string | null;
  event?: string | null;
  cookie?: string;
};

/** Sends a delivery the way GitHub does: the raw body, signed with the instance secret unless told otherwise. */
function deliver(app: App, over: Delivery = {}) {
  const body =
    over.body ?? JSON.stringify({ zen: "Keep it logically awesome." });
  const signature = over.signature === undefined ? sign(body) : over.signature;
  const delivery = over.delivery === undefined ? GUID : over.delivery;
  const event = over.event === undefined ? "ping" : over.event;
  return app.request("/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "x-hub-signature-256": signature }),
      ...(delivery === null ? {} : { "x-github-delivery": delivery }),
      ...(event === null ? {} : { "x-github-event": event }),
      ...(over.cookie ? { cookie: over.cookie } : {}),
    },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
}

async function deliveries(db: TestDb) {
  const result = await db.execute(
    sql`select id, event, action, installation_id, repo_id, payload, received_at, processed_at from webhook_deliveries order by received_at, id`,
  );
  return (result as { rows: Record<string, unknown>[] }).rows;
}

const receiptEntries = (db: TestDb) =>
  db.select().from(history).where(eq(history.action, "receive_webhook"));

async function nothingRecorded(db: TestDb) {
  expect(await deliveries(db)).toEqual([]);
  expect(await db.select().from(history)).toEqual([]);
}

async function userWithSession(db: TestDb, githubId: number) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `user${githubId}` })
    .returning({ id: users.id });
  assert(user);
  const value = `cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: createHash("sha256").update(value).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: user.id, cookie: `cockpit_session=${value}` };
}

/** A tracked project (GitHub repo id `repoId`) owned by `ownerId`. */
async function trackedProject(db: TestDb, ownerId: number, repoId: number) {
  const [project] = await db
    .insert(projects)
    .values({
      githubRepoId: repoId,
      fullName: `owner/repo${repoId}`,
      defaultBranch: "main",
      installationId: 77,
    })
    .returning({ id: projects.id });
  assert(project);
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: ownerId, role: "owner" });
  return project.id;
}

describe("decision 024 A, the route", () => {
  it("given a correctly signed delivery and no session, when it is posted, then 202", async () => {
    const { app } = await setup();

    const res = await deliver(app);

    expect(res.status).toBe(202);
  });

  it("given an instance the wizard has not configured, when a delivery is posted, then 503 and nothing is stored", async () => {
    const db = await openTestDatabase();
    const app = createApp(db, "1.2.3", testAppOptions);

    const res = await deliver(app);

    expect(res.status).toBe(503);
    await nothingRecorded(db);
  });

  it("given a correctly signed body of 300 KiB, when it is posted, then 202 and it is stored whole: the 256 KiB limit of /api/* does not apply", async () => {
    const { app, db } = await setup();
    const body = JSON.stringify({ zen: "x".repeat(300 * 1024) });

    const res = await deliver(app, { body });

    expect(res.status).toBe(202);
    const [row] = await deliveries(db);
    assert(row);
    expect((row.payload as { zen: string }).zen).toHaveLength(300 * 1024);
  });

  it("given a correctly signed body of 26 MiB, when it is posted, then 413 and nothing is stored: GitHub's own limit is 25 MiB", async () => {
    const { app, db } = await setup();
    const body = JSON.stringify({ zen: "x".repeat(26 * 1024 * 1024) });

    const res = await deliver(app, { body });

    expect(res.status).toBe(413);
    await nothingRecorded(db);
  });
});

describe("decision 024 B, the signature", () => {
  const body = JSON.stringify({ zen: "Keep it logically awesome." });
  const otherSecret = sign(body, "another-secret");
  const hex = createHmac("sha256", SECRET).update(body).digest("hex");

  it.each([
    ["missing", null],
    ["empty", ""],
    ["without the sha256= prefix", hex],
    ["with another algorithm", `sha1=${hex.slice(0, 40)}`],
    ["not hexadecimal", `sha256=${"z".repeat(64)}`],
    ["too short", `sha256=${hex.slice(0, 63)}`],
    ["too long", `sha256=${hex}0`],
    ["made with another secret", otherSecret],
    ["made over another body", sign("{}")],
  ])(
    "given a signature that is %s, when the delivery is posted, then 401, no delivery is stored and nothing is journaled",
    async (_name, signature) => {
      const { app, db } = await setup();

      const res = await deliver(app, { body, signature });

      expect(res.status).toBe(401);
      await nothingRecorded(db);
    },
  );

  it("given a body altered by one byte after it was signed, when it is posted, then 401", async () => {
    const { app, db } = await setup();

    const res = await deliver(app, {
      body: body.replace("Keep", "keep"),
      signature: sign(body),
    });

    expect(res.status).toBe(401);
    await nothingRecorded(db);
  });

  it("given a body with odd spacing and non-ASCII text signed over its exact bytes, when it is posted, then 202: the signature is checked on the raw bytes, not on a re-serialisation", async () => {
    const { app, db } = await setup();
    const raw = Buffer.from('{ "zen" :   "café ☕",\n  "n":1.0 }');

    const res = await deliver(app, { body: raw });

    expect(res.status).toBe(202);
    expect((await deliveries(db))[0]?.payload).toEqual({
      zen: "café ☕",
      n: 1,
    });
  });

  it("given a wrong signature and invalid headers and body, when it is posted, then 401: the signature is judged first", async () => {
    const { app, db } = await setup();

    const res = await deliver(app, {
      body: "not json",
      signature: otherSecret,
      delivery: null,
      event: null,
    });

    expect(res.status).toBe(401);
    await nothingRecorded(db);
  });

  it.each([
    ["no X-GitHub-Delivery", { delivery: null }],
    ["an empty X-GitHub-Delivery", { delivery: "" }],
    ["an X-GitHub-Delivery of 101 characters", { delivery: "d".repeat(101) }],
    ["no X-GitHub-Event", { event: null }],
    ["an empty X-GitHub-Event", { event: "" }],
    ["an X-GitHub-Event with a capital", { event: "Push" }],
    ["an X-GitHub-Event with a dash", { event: "check-run" }],
    ["an X-GitHub-Event with a digit", { event: "push2" }],
    ["an X-GitHub-Event of 65 characters", { event: "a".repeat(65) }],
    ["a body that is not JSON", { body: "not json" }],
    ["an empty body", { body: "" }],
    ["a JSON array", { body: "[]" }],
    ["JSON null", { body: "null" }],
    ["a JSON number", { body: "42" }],
    ["a JSON string", { body: '"text"' }],
  ] satisfies [string, Delivery][])(
    "given a signed delivery with %s, when it is posted, then 400, no delivery is stored and nothing is journaled",
    async (_name, over) => {
      const { app, db } = await setup();

      const res = await deliver(app, over);

      expect(res.status).toBe(400);
      await nothingRecorded(db);
    },
  );

  it("given an X-GitHub-Delivery of exactly 100 characters and an event of exactly 64, when it is posted, then 202: those are the limits", async () => {
    const { app, db } = await setup();

    const res = await deliver(app, {
      delivery: "d".repeat(100),
      event: "e_".repeat(32),
    });

    expect(res.status).toBe(202);
    expect((await deliveries(db))[0]).toMatchObject({
      id: "d".repeat(100),
      event: "e_".repeat(32),
    });
  });
});

describe("decision 024 C, the record", () => {
  it("given a valid delivery, when it is posted, then 202 and one row holds the delivery id, event, action, installation, repo, the body as payload, a reception date and no processing date", async () => {
    const { app, db } = await setup();
    const payload = {
      action: "opened",
      installation: { id: 77 },
      repository: { id: 4242, full_name: "owner/repo" },
      issue: { number: 3, title: "Un titre" },
    };
    const before = Date.now();

    const res = await deliver(app, {
      body: JSON.stringify(payload),
      event: "issues",
    });

    expect(res.status).toBe(202);
    const rows = await deliveries(db);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    assert(row);
    expect(row).toMatchObject({
      id: GUID,
      event: "issues",
      action: "opened",
      payload,
      processed_at: null,
    });
    expect(Number(row.installation_id)).toBe(77);
    expect(Number(row.repo_id)).toBe(4242);
    const receivedAt = new Date(row.received_at as string | Date).getTime();
    expect(receivedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(receivedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("given a ping without action, installation or repository, when it is posted, then the row has null for action, installation_id and repo_id", async () => {
    const { app, db } = await setup();

    const res = await deliver(app);

    expect(res.status).toBe(202);
    expect((await deliveries(db))[0]).toMatchObject({
      id: GUID,
      event: "ping",
      action: null,
      installation_id: null,
      repo_id: null,
      processed_at: null,
    });
  });

  it("given a delivery GitHub sends twice with the same X-GitHub-Delivery, when both are posted, then both answer 202 and there is still one row and one history entry", async () => {
    const { app, db } = await setup();
    const body = JSON.stringify({ action: "opened", repository: { id: 1 } });

    const first = await deliver(app, { body, event: "issues" });
    const second = await deliver(app, { body, event: "issues" });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await deliveries(db)).toHaveLength(1);
    expect(await receiptEntries(db)).toHaveLength(1);
  });

  it("given two deliveries with different ids, when both are posted, then there are two rows and two history entries", async () => {
    const { app, db } = await setup();

    await deliver(app, { delivery: "a-1" });
    await deliver(app, { delivery: "a-2" });

    expect((await deliveries(db)).map((r) => r.id).sort()).toEqual([
      "a-1",
      "a-2",
    ]);
    expect(await receiptEntries(db)).toHaveLength(2);
  });
});

describe("decision 024 E, the history", () => {
  it("given a ping, when it is posted, then one receive_webhook entry by github from the webhook has no user and no project, and its args are exactly { deliveryId, event, action: null }", async () => {
    const { app, db } = await setup();

    await deliver(app);

    const entries = await receiptEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: null,
      projectId: null,
      actor: "github",
      origin: "webhook",
      action: "receive_webhook",
      result: "ok",
      args: { deliveryId: GUID, event: "ping", action: null },
    });
    expect(Object.keys(entries[0]?.args ?? {}).sort()).toEqual([
      "action",
      "deliveryId",
      "event",
    ]);
  });

  it("given a delivery for a repo nobody tracks, when it is posted, then the entry has no user and no project", async () => {
    const { app, db } = await setup();
    const owner = await userWithSession(db, 10);
    await trackedProject(db, owner.id, 1);

    await deliver(app, {
      body: JSON.stringify({ action: "opened", repository: { id: 999 } }),
      event: "issues",
    });

    const [entry] = await receiptEntries(db);
    expect(entry).toMatchObject({ userId: null, projectId: null });
    const seen = await app.request("/api/history", {
      headers: { cookie: owner.cookie },
    });
    expect(((await seen.json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it("given a delivery for the repo of a tracked project, when it is posted, then the entry names the project and its owner, with args { deliveryId, event, action } and never the body", async () => {
    const { app, db } = await setup();
    const owner = await userWithSession(db, 10);
    const projectId = await trackedProject(db, owner.id, 4242);
    const body = JSON.stringify({
      action: "opened",
      repository: { id: 4242 },
      issue: { title: "Titre confidentiel" },
    });

    await deliver(app, { body, event: "issues" });

    const [entry] = await receiptEntries(db);
    expect(entry).toMatchObject({
      userId: owner.id,
      projectId,
      actor: "github",
      origin: "webhook",
      action: "receive_webhook",
      result: "ok",
      args: { deliveryId: GUID, event: "issues", action: "opened" },
    });
    expect(JSON.stringify(entry)).not.toContain("confidentiel");
  });

  it("given a delivery for the repo of a tracked project, when its owner reads the history, then they see it, with the event; another user does not", async () => {
    const { app, db } = await setup();
    const owner = await userWithSession(db, 10);
    const other = await userWithSession(db, 11);
    await trackedProject(db, owner.id, 4242);
    await deliver(app, {
      body: JSON.stringify({ action: "opened", repository: { id: 4242 } }),
      event: "issues",
    });

    const mine = await app.request("/api/history", {
      headers: { cookie: owner.cookie },
    });
    const theirs = await app.request("/api/history", {
      headers: { cookie: other.cookie },
    });

    expect(((await mine.json()) as { entries: unknown[] }).entries).toEqual([
      expect.objectContaining({
        actor: "github",
        origin: "webhook",
        action: "receive_webhook",
        result: "ok",
        event: "issues",
      }),
    ]);
    expect(((await theirs.json()) as { entries: unknown[] }).entries).toEqual(
      [],
    );
  });
});
