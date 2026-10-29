import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { users } from "./schema.ts";
import { openTestDatabase } from "./test-db.ts";

/** Drizzle wraps the driver error: the "duplicate key" text is in the cause. */
async function errorText(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${(error as Error).message} ${(cause as Error | undefined)?.message ?? ""}`;
  }
  return "";
}

describe("first migration", () => {
  it("given an empty database, when a user is inserted, then it gets id 1 and a creation Date close to now", async () => {
    const db = await openTestDatabase();

    const [user] = await db
      .insert(users)
      .values({ githubId: 42, login: "octocat" })
      .returning();

    assert(user);
    expect(user.id).toBe(1);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(user.createdAt.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("given a user with GitHub id 42, when another user with the same GitHub id is inserted, then the database refuses it", async () => {
    const db = await openTestDatabase();
    await db.insert(users).values({ githubId: 42, login: "octocat" });

    const text = await errorText(
      db.insert(users).values({ githubId: 42, login: "other" }),
    );

    expect(text).toMatch(/duplicate key|unique/i);
  });

  it("given a GitHub id above 2^31, when a user is inserted, then it is read back as the same number", async () => {
    const db = await openTestDatabase();

    await db.insert(users).values({ githubId: 3_000_000_000, login: "late" });
    const [user] = await db.select().from(users);

    assert(user);
    expect(user.githubId).toBe(3_000_000_000);
  });
});

// openTestDatabase hands every test the same database, emptied (test-db.ts).
describe("openTestDatabase", () => {
  it("given a test that leaves a user behind, when the next test opens the database, then it is empty again", async () => {
    const db = await openTestDatabase();
    await db.insert(users).values({ githubId: 7, login: "left-behind" });
  });

  it("given the previous test left a user, when a user is inserted, then it is the only one and gets id 1", async () => {
    const db = await openTestDatabase();

    const [user] = await db
      .insert(users)
      .values({ githubId: 8, login: "fresh" })
      .returning();

    expect(user?.id).toBe(1);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("given a database already open in this test, when a second one is opened, then it is separate and empty", async () => {
    const first = await openTestDatabase();
    await first.insert(users).values({ githubId: 9, login: "first" });

    const second = await openTestDatabase();

    expect(await second.select().from(users)).toEqual([]);
    expect(await first.select().from(users)).toHaveLength(1);
  });
});
