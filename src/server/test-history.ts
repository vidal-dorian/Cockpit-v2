import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "./app.ts";
import { projects, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Shared by the acceptance tests of slice 11.1 (decision 053): history-filters, history-search, history-retry, history-export.

export type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

export async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app };
}

/** A user with a live session; returns the user id and the Cookie header. */
export async function userWithSession(db: TestDb, githubId: number) {
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

export async function project(db: TestDb, githubRepoId: number, name: string) {
  const [row] = await db
    .insert(projects)
    .values({
      githubRepoId,
      fullName: name,
      defaultBranch: "main",
      installationId: 1,
    })
    .returning({ id: projects.id });
  assert(row);
  return row.id;
}

export const base = { actor: "human", origin: "ui", result: "ok" } as const;

export type Entry = {
  id: number;
  at: string;
  actor: string;
  origin: string;
  action: string;
  result: string;
  project: string | null;
  projectId: number | null;
  ticketId: number | null;
  storyId: number | null;
  runId: number | null;
  args: Record<string, unknown>;
  detail: Record<string, string> | null;
  retry?: { id: number; at: string; result: string } | null;
  event?: string;
};
export type Page = { entries: Entry[]; hasMore: boolean };

export const ask = (
  app: ReturnType<typeof createApp>,
  cookie: string,
  query = "",
) => app.request(`/api/history${query}`, { headers: { cookie } });

/** The actions of the entries the route answers for `query`, in the order of the journal. */
export async function actions(
  app: ReturnType<typeof createApp>,
  cookie: string,
  query: string,
) {
  const res = await ask(app, cookie, query);
  expect(res.status, query).toBe(200);
  return ((await res.json()) as Page).entries.map((e) => e.action);
}

import { expect } from "vitest";
