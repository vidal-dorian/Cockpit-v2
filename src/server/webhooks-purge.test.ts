import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestDatabase } from "./db/test-db.ts";
import { schedulePurge } from "./tokens.ts";

// Decision 024 H: the daily purge (schedulePurge, run once at once) deletes the webhook deliveries received more than
// 30 days ago, processed or not, and keeps the newer ones. It is read like the token purge tests do: schedulePurge(db)
// runs immediately; the table is read and written with raw SQL (see webhooks.test.ts for its columns).

afterEach(() => {
  vi.useRealTimers();
});

type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seed(
  db: TestDb,
  id: string,
  receivedAt: Date,
  processedAt: Date | null = null,
) {
  await db.execute(
    sql`insert into webhook_deliveries (id, event, payload, received_at, processed_at)
      values (${id}, 'push', '{}'::jsonb, ${receivedAt.toISOString()}::timestamptz,
        ${processedAt ? processedAt.toISOString() : null}::timestamptz)`,
  );
}

const remaining = async (db: TestDb) =>
  (
    (await db.execute(sql`select id from webhook_deliveries order by id`)) as {
      rows: { id: string }[];
    }
  ).rows.map((r) => r.id);

/** Polls with the real setTimeout, like the token purge tests: the purge runs in the background. */
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(await check()).toBe(true);
}

/** Runs the purge once and waits for it to be over: the marker row, received 40 days ago, is the first thing it deletes. */
async function purged(db: TestDb) {
  await seed(db, "marker", daysAgo(40));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const timer = schedulePurge(db);
  await until(async () => !(await remaining(db)).includes("marker"));
  clearInterval(timer);
}

describe("the purge of webhook deliveries (decision 024 H)", () => {
  it("given deliveries received 31 days ago and 29 days ago, when the purge runs, then only the first is deleted", async () => {
    const db = await openTestDatabase();
    await seed(db, "old", daysAgo(31));
    await seed(db, "recent", daysAgo(29));

    await purged(db);

    expect(await remaining(db)).toEqual(["recent"]);
  });

  it("given an old delivery that was processed and an old one that was not, when the purge runs, then both are deleted", async () => {
    const db = await openTestDatabase();
    await seed(db, "old-processed", daysAgo(45), daysAgo(45));
    await seed(db, "old-unprocessed", daysAgo(45));

    await purged(db);

    expect(await remaining(db)).toEqual([]);
  });

  it("given recent deliveries, processed or not, when the purge runs, then both are kept", async () => {
    const db = await openTestDatabase();
    await seed(db, "today", new Date(), new Date());
    await seed(db, "yesterday", daysAgo(1));
    await seed(db, "old", daysAgo(100));

    await purged(db);

    expect(await remaining(db)).toEqual(["today", "yesterday"]);
  });
});
