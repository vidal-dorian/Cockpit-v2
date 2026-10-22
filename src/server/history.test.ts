import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { history, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";

const config = {
  githubClientId: "Iv1.client",
  githubClientSecret: "secret",
  publicUrl: "https://cockpit.example.com",
  allowedLogins: ["octocat"],
};

async function setup() {
  const db = await openTestDatabase();
  const app = createApp(db, "1.2.3", config);
  return { db, app };
}

/** A user with a live session; returns the user id and the Cookie header. */
async function userWithSession(
  db: Awaited<ReturnType<typeof openTestDatabase>>,
  githubId: number,
) {
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

describe("GET /api/history", () => {
  it("given no session, when the history is requested, then it answers 401", async () => {
    const { app } = await setup();

    const res = await app.request("/api/history");

    expect(res.status).toBe(401);
  });

  it("given entries of two users, when A asks for the history, then only A's entries come back, newest first, with only the public fields", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    await db.insert(history).values([
      { ...base, userId: a.id, action: "login", at: new Date("2026-01-01") },
      {
        ...base,
        userId: a.id,
        action: "logout",
        at: new Date("2026-01-03"),
        result: "error",
      },
      { ...base, userId: b.id, action: "other", at: new Date("2026-01-02") },
      { ...base, userId: null, action: "other", at: new Date("2026-01-04") },
    ]);

    const res = await app.request("/api/history", {
      headers: { cookie: a.cookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Record<string, unknown>[];
    };
    expect(body.entries.map((e) => e.action)).toEqual(["logout", "login"]);
    const [first] = body.entries;
    assert(first);
    expect(Object.keys(first).sort()).toEqual([
      "action",
      "actor",
      "at",
      "id",
      "origin",
      "result",
    ]);
    expect(first).toMatchObject({
      actor: "human",
      origin: "ui",
      result: "error",
    });
    expect(new Date(String(first.at)).toISOString()).toBe(
      "2026-01-03T00:00:00.000Z",
    );
  });

  it("given 105 entries for A, when A asks for the history, then only the 100 most recent come back", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(
      Array.from({ length: 105 }, (_, i) => ({
        ...base,
        userId: a.id,
        action: "login",
        at: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    );

    const res = await app.request("/api/history", {
      headers: { cookie: a.cookie },
    });

    const body = (await res.json()) as { entries: { at: string }[] };
    expect(body.entries).toHaveLength(100);
    expect(body.entries[0]?.at).toBe(
      new Date(Date.UTC(2026, 0, 1, 0, 104)).toISOString(),
    );
    expect(body.entries[99]?.at).toBe(
      new Date(Date.UTC(2026, 0, 1, 0, 5)).toISOString(),
    );
  });
});
