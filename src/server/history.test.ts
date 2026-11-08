import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { history, projects, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
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
    // Decision 053 B adds the ids, `args`, `detail` and, on a refused or error entry, `retry`; the user and token stay on the server.
    expect(Object.keys(first).sort()).toEqual([
      "action",
      "actor",
      "args",
      "at",
      "detail",
      "id",
      "origin",
      "project",
      "projectId",
      "result",
      "retry",
      "runId",
      "storyId",
      "ticketId",
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

  it("given 105 entries for A, when A asks for the history, then only the 25 most recent come back (decision 028 F)", async () => {
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
    expect(body.entries).toHaveLength(25);
    expect(body.entries[0]?.at).toBe(
      new Date(Date.UTC(2026, 0, 1, 0, 104)).toISOString(),
    );
    expect(body.entries[24]?.at).toBe(
      new Date(Date.UTC(2026, 0, 1, 0, 80)).toISOString(),
    );
  });

  it("given entries on a project and one without, when A asks for the history, then each entry has project as owner/repo or null", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const [project] = await db
      .insert(projects)
      .values({
        githubRepoId: 77,
        fullName: "octocat/hello",
        defaultBranch: "main",
        installationId: 1,
      })
      .returning({ id: projects.id });
    assert(project);
    await db.insert(history).values([
      {
        ...base,
        userId: a.id,
        action: "login",
        at: new Date("2026-01-01"),
        projectId: project.id,
      },
      { ...base, userId: a.id, action: "logout", at: new Date("2026-01-02") },
    ]);

    const res = await app.request("/api/history", {
      headers: { cookie: a.cookie },
    });

    const body = (await res.json()) as {
      entries: { action: string; project: string | null }[];
    };
    expect(body.entries.map((e) => [e.action, e.project])).toEqual([
      ["logout", null],
      ["login", "octocat/hello"],
    ]);
  });
});
