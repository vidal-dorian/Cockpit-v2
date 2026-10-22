import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { act, Refused } from "./action.ts";
import { history, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";

const entry = {
  userId: 7,
  actor: "human",
  origin: "ui",
  action: "ticket.close",
  args: { ticket: 17, status: "done" },
} as const;

describe("history is tamper-proof", () => {
  it.each([
    ["an UPDATE", "update history set action = 'forged'"],
    ["a DELETE", "delete from history"],
    ["a TRUNCATE", "truncate table history"],
  ])(
    "given an entry in history, when %s is run on it, then the database refuses and the entry is unchanged",
    async (_name, statement) => {
      const db = await openTestDatabase();
      await act(db, entry, async () => {});
      const [before] = await db.select().from(history);
      assert(before, "act must have written an entry");

      await expect(db.execute(sql.raw(statement))).rejects.toThrow();

      expect(await db.select().from(history)).toEqual([before]);
    },
  );
});

describe("act", () => {
  it("given work that inserts a row, when it succeeds, then the row exists and one ok entry is written", async () => {
    const db = await openTestDatabase();

    const result = await act(db, entry, async (tx) => {
      await tx.insert(users).values({ githubId: 5, login: "someone" });
      return "done";
    });

    expect(result).toBe("done");
    expect(await db.select().from(users)).toHaveLength(1);
    const rows = await db.select().from(history);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 7,
      actor: "human",
      origin: "ui",
      action: "ticket.close",
      args: { ticket: 17, status: "done" },
      result: "ok",
    });
    expect(rows[0]?.at).toBeInstanceOf(Date);
  });

  it("given work that inserts a row then throws Refused, when act runs, then nothing is applied, one refused entry holds the reason and Refused is rethrown", async () => {
    const db = await openTestDatabase();
    const refusal = new Refused("not allowed");

    await expect(
      act(db, entry, async (tx) => {
        await tx.insert(users).values({ githubId: 5, login: "someone" });
        throw refusal;
      }),
    ).rejects.toBe(refusal);

    expect(await db.select().from(users)).toHaveLength(0);
    const rows = await db.select().from(history);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 7,
      action: "ticket.close",
      result: "refused",
      detail: { reason: "not allowed" },
    });
  });

  it("given work that inserts a row then throws a plain Error, when act runs, then nothing is applied, one error entry is written and the error is rethrown", async () => {
    const db = await openTestDatabase();
    const failure = new Error("boom");

    await expect(
      act(db, entry, async (tx) => {
        await tx.insert(users).values({ githubId: 5, login: "someone" });
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await db.select().from(users)).toHaveLength(0);
    const rows = await db
      .select()
      .from(history)
      .where(eq(history.result, "error"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 7, action: "ticket.close" });
    expect(await db.select().from(history)).toHaveLength(1);
  });

  it("given work that fails with a database error carrying a string parameter, when act runs, then the error entry holds only a generic reason and act rejects", async () => {
    const db = await openTestDatabase();
    await db.insert(users).values({ githubId: 5, login: "first" });

    await expect(
      act(db, entry, async (tx) => {
        await tx.insert(users).values({ githubId: 5, login: "Jean Dupont" });
      }),
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(history)
      .where(eq(history.result, "error"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toEqual({ reason: "error" });
    expect(JSON.stringify(rows[0])).not.toContain("Jean Dupont");
  });
});
