import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { history, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 028 F: GET /api/history by pages of 25, { entries, hasMore }, `?before=<id>` (keyset on (at desc, id desc)).
//
// Pinned choices (the decision leaves them open):
// - A page holds 25 entries; `hasMore` is true when at least one entry of the caller comes after the page.
// - `before` is the id of the last entry displayed; the answer holds the caller's entries strictly after it in the order of the journal.
// - A refused `before` (not a positive integer, or not an entry of the caller) is 400 { error: "invalid_cursor" }.

type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;
type Page = { entries: { id: number; at: string }[]; hasMore: boolean };

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app };
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

const base = { actor: "human", origin: "ui", result: "ok" } as const;

/** `count` entries of a user, one minute apart, the last inserted being the most recent. */
const spaced = (userId: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    ...base,
    userId,
    action: "login",
    at: new Date(Date.UTC(2026, 0, 1, 0, i)),
  }));

const ask = (app: ReturnType<typeof createApp>, cookie: string, query = "") =>
  app.request(`/api/history${query}`, { headers: { cookie } });

describe("GET /api/history, the pages (decision 028 F)", () => {
  it("given 30 entries of the caller, when the history is requested, then the 25 most recent come back in the order of the journal with hasMore true", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(spaced(a.id, 30));

    const res = await ask(app, a.cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Page;
    expect(body.hasMore).toBe(true);
    expect(body.entries).toHaveLength(25);
    expect(body.entries.map((e) => e.at)).toEqual(
      Array.from({ length: 25 }, (_, i) =>
        new Date(Date.UTC(2026, 0, 1, 0, 29 - i)).toISOString(),
      ),
    );
  });

  it("given exactly 25 entries, when the history is requested, then all come back with hasMore false", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(spaced(a.id, 25));

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    expect(body.entries).toHaveLength(25);
    expect(body.hasMore).toBe(false);
  });

  it("given no entry, when the history is requested, then it answers { entries: [], hasMore: false }", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);

    const res = await ask(app, a.cookie);

    expect(await res.json()).toEqual({ entries: [], hasMore: false });
  });

  it("given 30 entries, when the history is requested with before = the id of the 25th, then the 5 following come back with hasMore false", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(spaced(a.id, 30));
    const first = (await (await ask(app, a.cookie)).json()) as Page;
    const last = first.entries[24];
    assert(last);

    const res = await ask(app, a.cookie, `?before=${last.id}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Page;
    expect(body.hasMore).toBe(false);
    expect(body.entries.map((e) => e.at)).toEqual(
      Array.from({ length: 5 }, (_, i) =>
        new Date(Date.UTC(2026, 0, 1, 0, 4 - i)).toISOString(),
      ),
    );
  });

  it("given 60 entries, when the pages are followed with before, then the second page holds 25 and hasMore true and the third the last 10", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(spaced(a.id, 60));
    const one = (await (await ask(app, a.cookie)).json()) as Page;
    const two = (await (
      await ask(app, a.cookie, `?before=${one.entries[24]?.id}`)
    ).json()) as Page;
    expect(two.entries).toHaveLength(25);
    expect(two.hasMore).toBe(true);

    const three = (await (
      await ask(app, a.cookie, `?before=${two.entries[24]?.id}`)
    ).json()) as Page;

    expect(three.entries).toHaveLength(10);
    expect(three.hasMore).toBe(false);
  });

  it("given entries of the same at, when the pages are followed, then each entry appears once and only once, ordered by at then id, newest first", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const same = new Date("2026-02-01T12:00:00.000Z");
    // 40 entries share one instant (the page boundary falls inside them), 5 are older, 5 newer.
    await db.insert(history).values([
      ...Array.from({ length: 5 }, () => ({
        ...base,
        userId: a.id,
        action: "login",
        at: new Date("2026-01-01"),
      })),
      ...Array.from({ length: 40 }, () => ({
        ...base,
        userId: a.id,
        action: "login",
        at: same,
      })),
      ...Array.from({ length: 5 }, () => ({
        ...base,
        userId: a.id,
        action: "login",
        at: new Date("2026-03-01"),
      })),
    ]);

    const seen: { id: number; at: string }[] = [];
    let pages = 0;
    let query = "";
    for (let guard = 0; guard < 10; guard++) {
      const page = (await (await ask(app, a.cookie, query)).json()) as Page;
      pages += 1;
      expect(page.entries.length).toBeLessThanOrEqual(25);
      seen.push(...page.entries);
      const last = page.entries.at(-1);
      if (!page.hasMore || !last) break;
      query = `?before=${last.id}`;
    }

    expect(pages).toBe(2);
    expect(seen).toHaveLength(50);
    expect(new Set(seen.map((e) => e.id)).size).toBe(50);
    const sorted = [...seen].sort(
      (x, y) => y.at.localeCompare(x.at) || y.id - x.id,
    );
    expect(seen).toEqual(sorted);
  });

  it("given entries of another user among the caller's, when the pages are followed, then only the caller's entries are counted and returned", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    await db.insert(history).values([...spaced(a.id, 26), ...spaced(b.id, 40)]);

    const one = (await (await ask(app, a.cookie)).json()) as Page;
    const two = (await (
      await ask(app, a.cookie, `?before=${one.entries[24]?.id}`)
    ).json()) as Page;

    expect(one.entries).toHaveLength(25);
    expect(one.hasMore).toBe(true);
    expect(two.entries).toHaveLength(1);
    expect(two.hasMore).toBe(false);
  });
});

describe("GET /api/history, an invalid cursor (decision 028 F)", () => {
  it.each(["abc", "0", "-1", "2147483648", "9007199254740991"])(
    "given before=%s, when the history is requested, then it answers 400 invalid_cursor",
    async (before) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await db.insert(history).values(spaced(a.id, 3));

      const res = await ask(app, a.cookie, `?before=${before}`);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_cursor" });
    },
  );

  it("given a before that is the id of an entry of another user, when the history is requested, then it answers 400 invalid_cursor, like an id that does not exist", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    await db.insert(history).values(spaced(a.id, 3));
    const others = await db
      .insert(history)
      .values(spaced(b.id, 3))
      .returning({ id: history.id });
    const theirs = others[0];
    assert(theirs);

    const res = await ask(app, a.cookie, `?before=${theirs.id}`);
    const missing = await ask(app, a.cookie, "?before=99999999");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_cursor" });
    expect(missing.status).toBe(400);
  });

  it("given no session, when the history is requested with a before, then it answers 401", async () => {
    const { app } = await setup();

    const res = await app.request("/api/history?before=1");

    expect(res.status).toBe(401);
  });
});

describe("GET /api/history, microsecond timestamps (decision 028 F)", () => {
  /** Walks the pages with ?before and returns every page. */
  async function walk(app: ReturnType<typeof createApp>, cookie: string) {
    const pages: Page[] = [];
    let query = "";
    for (let guard = 0; guard < 6; guard++) {
      const page = (await (await ask(app, cookie, query)).json()) as Page;
      pages.push(page);
      const last = page.entries.at(-1);
      if (!page.hasMore || !last) break;
      query = `?before=${last.id}`;
    }
    return pages;
  }

  /** The ids of the user in the order of the journal, read by the database itself. */
  async function journalOrder(db: TestDb, userId: number) {
    const rows = await db.execute(
      sql`select id from history where user_id = ${userId} order by at desc, id desc`,
    );
    return (rows.rows as { id: number }[]).map((r) => r.id);
  }

  it("given 30 entries at distinct microseconds of the same millisecond, when the pages are followed, then page 1 holds 25 with hasMore true, page 2 the 5 others with hasMore false, and every entry appears once in the order of the journal", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.execute(sql`
      insert into history (user_id, actor, origin, action, result, at)
      select ${a.id}, 'human', 'ui', 'login', 'ok',
        timestamptz '2026-01-01 00:00:00.123000+00' + make_interval(secs => g / 1000000.0)
      from generate_series(1, 30) g`);

    const pages = await walk(app, a.cookie);

    expect(pages.map((p) => p.entries.length)).toEqual([25, 5]);
    expect(pages.map((p) => p.hasMore)).toEqual([true, false]);
    expect(pages.flatMap((p) => p.entries.map((e) => e.id))).toEqual(
      await journalOrder(db, a.id),
    );
  });

  it("given groups of entries sharing exactly the same microsecond, when the cursor sits among a group, then the pages still hold every entry once in the order of the journal", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    // 10 instants of 3 entries each, the earliest ids on the latest instants; the page boundary (25) falls inside a group.
    await db.execute(sql`
      insert into history (user_id, actor, origin, action, result, at)
      select ${a.id}, 'human', 'ui', 'login', 'ok',
        timestamptz '2026-01-01 00:00:00.123000+00' + make_interval(secs => (30 - g) / 3 / 1000000.0)
      from generate_series(1, 30) g`);

    const pages = await walk(app, a.cookie);

    expect(pages.map((p) => p.entries.length)).toEqual([25, 5]);
    expect(pages.map((p) => p.hasMore)).toEqual([true, false]);
    const ids = pages.flatMap((p) => p.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(30);
    expect(ids).toEqual(await journalOrder(db, a.id));
  });
});
