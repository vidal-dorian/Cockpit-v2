import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { users } from "./schema.ts";

describe("first migration", () => {
  it("creates users with an ISO 8601 UTC creation date", () => {
    const db = openDatabase(":memory:");

    const user = db
      .insert(users)
      .values({ githubId: 42, login: "octocat" })
      .returning()
      .get();

    expect(user.id).toBe(1);
    expect(user.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("refuses two accounts with the same GitHub id", () => {
    const db = openDatabase(":memory:");
    db.insert(users).values({ githubId: 42, login: "octocat" }).run();

    expect(() =>
      db.insert(users).values({ githubId: 42, login: "other" }).run(),
    ).toThrow(/UNIQUE/);
  });
});
