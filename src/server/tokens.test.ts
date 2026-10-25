import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { history, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  createAdminWithSession,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Slice 4.1 (decisions 002, 004, 006, 010): MCP tokens, created, listed and revoked by their owner.
// Expected table `mcp_tokens` (migration to add): id serial pk, user_id integer not null references users,
// name text not null, token_hash text not null unique, last_four text not null,
// created_at timestamptz not null default now(), last_used_at timestamptz null, revoked_at timestamptz null.
// The table is read here with raw SQL, so the tests do not depend on the Drizzle export.

type App = ReturnType<typeof createApp>;
type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  const admin = await createAdminWithSession(db, 99);
  return { db, app, admin };
}

/** A non-administrator with a live session. */
async function userWithSession(db: TestDb, githubId: number) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `user${githubId}` })
    .returning({ id: users.id });
  assert(user);
  const value = `cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: sha256(value),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: user.id, cookie: `cockpit_session=${value}` };
}

const create = (app: App, cookie: string, body: unknown) =>
  app.request("/api/me/tokens", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const list = (app: App, cookie: string) =>
  app.request("/api/me/tokens", { headers: { cookie } });

const revoke = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/me/tokens/${id}/revoke`, {
    method: "POST",
    headers: { cookie },
  });

type Token = {
  id: number;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
type Created = { token: Token; secret: string };

/** Creates a token and checks the 201, so a test never goes on from a missing feature. */
async function created(app: App, cookie: string, name = "Mon Claude") {
  const res = await create(app, cookie, { name });
  expect(res.status, "creating a token must work for this test").toBe(201);
  return (await res.json()) as Created;
}

async function listed(app: App, cookie: string) {
  const res = await list(app, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { tokens: Token[] }).tokens;
}

async function tokenRows(db: TestDb) {
  const result = await db.execute(sql`select * from mcp_tokens order by id`);
  return (result as { rows: Record<string, unknown>[] }).rows;
}

const entriesOf = (db: TestDb, action: string) =>
  db
    .select()
    .from(history)
    .where(eq(history.action, action))
    .orderBy(history.id);

const allEntries = (db: TestDb) => db.select().from(history);

describe("POST /api/me/tokens", () => {
  it("given a user, when they create a token, then 201 with { token: { id, name, lastFour, createdAt, lastUsedAt: null, revokedAt: null }, secret } and the secret is ckp_ plus 43 base64url characters", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const res = await create(app, alice.cookie, { name: "Mon Claude" });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Created;
    expect(Object.keys(body).sort()).toEqual(["secret", "token"]);
    expect(body.secret).toMatch(/^ckp_[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(body.token).sort()).toEqual([
      "createdAt",
      "id",
      "lastFour",
      "lastUsedAt",
      "name",
      "revokedAt",
    ]);
    expect(body.token).toMatchObject({
      name: "Mon Claude",
      lastFour: body.secret.slice(-4),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(Number.isInteger(body.token.id)).toBe(true);
    expect(
      Math.abs(Date.parse(body.token.createdAt) - Date.now()),
    ).toBeLessThan(60_000);
  });

  it("given a created token, when the database is read, then only sha256(secret) is stored in token_hash and no column anywhere holds the secret", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const { token, secret } = await created(app, alice.cookie, "Portable");

    const rows = await tokenRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: token.id,
      user_id: alice.id,
      name: "Portable",
      token_hash: sha256(secret),
      last_four: secret.slice(-4),
      last_used_at: null,
      revoked_at: null,
    });
    for (const row of rows)
      for (const value of Object.values(row)) expect(value).not.toBe(secret);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(await allEntries(db))).not.toContain(secret);
    expect(JSON.stringify(await db.select().from(sessions))).not.toContain(
      secret,
    );
  });

  it("given two creations, when they are compared, then the secrets, the hashes and the ids differ", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const first = await created(app, alice.cookie, "Un");
    const second = await created(app, alice.cookie, "Un");

    expect(first.secret).not.toBe(second.secret);
    expect(first.token.id).not.toBe(second.token.id);
    const hashes = (await tokenRows(db)).map((r) => r.token_hash);
    expect(new Set(hashes).size).toBe(2);
  });

  it("given a name with spaces around it, when the token is created, then the name is trimmed in the answer and in the database", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const { token } = await created(app, alice.cookie, "  Mon Claude  ");

    expect(token.name).toBe("Mon Claude");
    expect((await tokenRows(db))[0]?.name).toBe("Mon Claude");
  });

  it("given a name of exactly 100 characters, when the token is created, then 201", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const { token } = await created(app, alice.cookie, "n".repeat(100));

    expect(token.name).toHaveLength(100);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a name of spaces only", { name: "   " }],
    ["a name of 101 characters", { name: "n".repeat(101) }],
    ["a name with a NUL character", { name: "a\u0000b" }],
    ["a name that is not a string", { name: 3 }],
    ["no name", {}],
  ])(
    "given %s, when a token is created, then 400 and nothing is written, not even in the history",
    async (_name, body) => {
      const { app, db } = await setup();
      const alice = await userWithSession(db, 5);
      // The route must exist: a token created with a good name proves it.
      await created(app, alice.cookie, "Bon");
      const entriesBefore = (await allEntries(db)).length;

      const res = await create(app, alice.cookie, body);

      expect(res.status).toBe(400);
      expect(await tokenRows(db)).toHaveLength(1);
      expect(await allEntries(db)).toHaveLength(entriesBefore);
    },
  );

  it("given a body that is not JSON, when a token is created, then 400 and nothing is written", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    await created(app, alice.cookie, "Bon");
    const entriesBefore = (await allEntries(db)).length;

    const res = await app.request("/api/me/tokens", {
      method: "POST",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: "{not json",
    });

    expect(res.status).toBe(400);
    expect(await tokenRows(db)).toHaveLength(1);
    expect(await allEntries(db)).toHaveLength(entriesBefore);
  });

  it("given a created token, when the history is read, then one create_token entry is ok with args { tokenId } and the user id, and neither the name nor the secret appears in any entry", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const { token, secret } = await created(app, alice.cookie, "Zephyr-perso");

    const entries = await entriesOf(db, "create_token");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { tokenId: token.id },
    });
    // Rule D of decision 010: the name is free text.
    const text = JSON.stringify(await allEntries(db));
    expect(text).not.toContain("Zephyr");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(secret.slice(4));
  });

  it("given a user whose account got blocked while their session still exists, when they create a token, then 403 account_blocked, no row and one refused create_token entry holds the reason", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    // A block committing between the session check and the insert: blocked_at set, the session row still there.
    await db
      .update(users)
      .set({ blockedAt: new Date() })
      .where(eq(users.id, alice.id));

    const res = await create(app, alice.cookie, { name: "Mon Claude" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_blocked" });
    expect(await tokenRows(db)).toHaveLength(0);
    const entries = await entriesOf(db, "create_token");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: alice.id,
      result: "refused",
      detail: { reason: "account_blocked" },
    });
    expect(JSON.stringify(entries[0])).not.toContain("Mon Claude");
  });

  it("given a user with 20 active tokens, when they create a 21st, then 409 too_many_tokens, no row is added and a refused create_token entry holds the reason", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    for (let i = 0; i < 20; i++) await created(app, alice.cookie, `t${i}`);

    const res = await create(app, alice.cookie, { name: "de trop" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too_many_tokens" });
    expect(await tokenRows(db)).toHaveLength(20);
    const entries = await entriesOf(db, "create_token");
    expect(entries.map((e) => e.result)).toEqual([
      ...Array(20).fill("ok"),
      "refused",
    ]);
    expect(entries[20]).toMatchObject({
      userId: alice.id,
      detail: { reason: "too_many_tokens" },
    });
    expect(JSON.stringify(entries[20])).not.toContain("de trop");
  });

  it("given a user with 20 tokens of which one is revoked, when they create another, then 201: a revoked token does not count", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const first = await created(app, alice.cookie, "t0");
    for (let i = 1; i < 20; i++) await created(app, alice.cookie, `t${i}`);
    expect((await revoke(app, alice.cookie, first.token.id)).status).toBe(204);

    const res = await create(app, alice.cookie, { name: "21e" });

    expect(res.status).toBe(201);
    expect(await tokenRows(db)).toHaveLength(21);
  });

  it("given a user with 20 active tokens, when another user creates one, then 201: the limit is per user", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const bob = await userWithSession(db, 6);
    for (let i = 0; i < 20; i++) await created(app, alice.cookie, `t${i}`);

    const res = await create(app, bob.cookie, { name: "à moi" });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/me/tokens", () => {
  it("given no token, when the list is requested, then { tokens: [] }", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const res = await list(app, alice.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tokens: [] });
  });

  it("given tokens of two users, when one lists, then only their own come, newest first, each as { id, name, lastFour, createdAt, lastUsedAt, revokedAt }", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const bob = await userWithSession(db, 6);
    const a1 = await created(app, alice.cookie, "premier");
    await created(app, bob.cookie, "de bob");
    const a2 = await created(app, alice.cookie, "second");

    const tokens = await listed(app, alice.cookie);

    expect(tokens.map((t) => t.id)).toEqual([a2.token.id, a1.token.id]);
    expect(tokens.map((t) => t.name)).toEqual(["second", "premier"]);
    for (const token of tokens)
      expect(Object.keys(token).sort()).toEqual([
        "createdAt",
        "id",
        "lastFour",
        "lastUsedAt",
        "name",
        "revokedAt",
      ]);
    expect(tokens[0]?.lastFour).toBe(a2.secret.slice(-4));
  });

  it("given a revoked token and a used one, when the list is requested, then both are there with revokedAt and lastUsedAt set", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const used = await created(app, alice.cookie, "utilisé");
    const gone = await created(app, alice.cookie, "révoqué");
    await revoke(app, alice.cookie, gone.token.id);
    await db.execute(
      sql`update mcp_tokens set last_used_at = '2026-10-20T09:00:00Z' where id = ${used.token.id}`,
    );

    const tokens = await listed(app, alice.cookie);

    const byId = new Map(tokens.map((t) => [t.id, t]));
    expect(byId.get(gone.token.id)?.revokedAt).toEqual(expect.any(String));
    expect(byId.get(used.token.id)?.revokedAt).toBeNull();
    expect(Date.parse(byId.get(used.token.id)?.lastUsedAt ?? "")).toBe(
      Date.parse("2026-10-20T09:00:00Z"),
    );
  });

  it("given created tokens, when the list is requested, then neither the secret nor the hash appears anywhere in the answer", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const { secret } = await created(app, alice.cookie);
    const hash = sha256(secret);

    const res = await list(app, alice.cookie);

    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain(hash);
    expect(text).not.toContain("secret");
    expect(text).not.toMatch(/hash/i);
  });
});

describe("POST /api/me/tokens/:id/revoke", () => {
  it("given an active token, when its owner revokes it, then 204, revokedAt is set, the others are untouched and one revoke_token entry holds { tokenId } and no name", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const keep = await created(app, alice.cookie, "garde");
    const gone = await created(app, alice.cookie, "Zephyr-à-jeter");

    const res = await revoke(app, alice.cookie, gone.token.id);

    expect(res.status).toBe(204);
    const tokens = await listed(app, alice.cookie);
    const revokedAt = tokens.find((t) => t.id === gone.token.id)?.revokedAt;
    expect(Math.abs(Date.parse(revokedAt ?? "") - Date.now())).toBeLessThan(
      60_000,
    );
    expect(tokens.find((t) => t.id === keep.token.id)?.revokedAt).toBeNull();
    const entries = await entriesOf(db, "revoke_token");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { tokenId: gone.token.id },
    });
    expect(JSON.stringify(await allEntries(db))).not.toContain("Zephyr");
  });

  it("given an already revoked token, when it is revoked again, then 409 already_revoked, revokedAt keeps its first value and the entries are ok then refused", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const { token } = await created(app, alice.cookie);
    await revoke(app, alice.cookie, token.id);
    const first = (await listed(app, alice.cookie))[0]?.revokedAt;
    expect(first).toBeTruthy();

    const res = await revoke(app, alice.cookie, token.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_revoked" });
    expect((await listed(app, alice.cookie))[0]?.revokedAt).toBe(first);
    const entries = await entriesOf(db, "revoke_token");
    expect(entries.map((e) => e.result)).toEqual(["ok", "refused"]);
    expect(entries[1]).toMatchObject({
      userId: alice.id,
      args: { tokenId: token.id },
      detail: { reason: "already_revoked" },
    });
  });

  it("given a token of another user, when it is revoked, then 404, it stays active and nothing is written to the history", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);
    const bob = await userWithSession(db, 6);
    const { token } = await created(app, alice.cookie);

    const res = await revoke(app, bob.cookie, token.id);

    expect(res.status).toBe(404);
    expect((await listed(app, alice.cookie))[0]?.revokedAt).toBeNull();
    expect(await entriesOf(db, "revoke_token")).toHaveLength(0);
  });

  it("given an administrator, when they revoke the token of a user, then 404 too: tokens are personal", async () => {
    const { app, db, admin } = await setup();
    const alice = await userWithSession(db, 5);
    const { token } = await created(app, alice.cookie);

    const res = await revoke(app, admin.cookie, token.id);

    expect(res.status).toBe(404);
    expect((await listed(app, alice.cookie))[0]?.revokedAt).toBeNull();
    expect(await entriesOf(db, "revoke_token")).toHaveLength(0);
  });

  it.each([
    ["an unknown id", "999"],
    ["a non-numeric id", "abc"],
    ["zero", "0"],
    ["a negative id", "-1"],
    ["a decimal id", "1.5"],
    ["an id beyond a PostgreSQL integer", "99999999999"],
  ])(
    "given %s, when it is revoked, then 404, a real token stays active and nothing is written to the history",
    async (_name, id) => {
      const { app, db } = await setup();
      const alice = await userWithSession(db, 5);
      await created(app, alice.cookie);

      const res = await revoke(app, alice.cookie, id);

      expect(res.status).toBe(404);
      expect((await listed(app, alice.cookie))[0]?.revokedAt).toBeNull();
      expect(await entriesOf(db, "revoke_token")).toHaveLength(0);
    },
  );
});

describe("access to /api/me/tokens", () => {
  const routes: [
    string,
    (app: App, cookie: string) => Response | Promise<Response>,
  ][] = [
    [
      "POST /api/me/tokens",
      (app, cookie) => create(app, cookie, { name: "x" }),
    ],
    ["GET /api/me/tokens", (app, cookie) => list(app, cookie)],
    ["POST /api/me/tokens/:id/revoke", (app, cookie) => revoke(app, cookie, 1)],
  ];

  it.each(routes)(
    "given no session, when %s is called, then 401",
    async (_route, call) => {
      const { app } = await setup();

      const res = await call(app, "");

      expect(res.status).toBe(401);
    },
  );

  it("given no session, when a token is created with an invalid name, then 401 and nothing is written", async () => {
    const { app, db } = await setup();

    const res = await create(app, "", { name: "" });

    expect(res.status).toBe(401);
    expect(await allEntries(db)).toHaveLength(0);
  });

  it("given a session that is not an administrator, when the three routes are used, then they all work", async () => {
    const { app, db } = await setup();
    const alice = await userWithSession(db, 5);

    const { token } = await created(app, alice.cookie);
    expect(await listed(app, alice.cookie)).toHaveLength(1);
    const res = await revoke(app, alice.cookie, token.id);

    expect(res.status).toBe(204);
  });
});
