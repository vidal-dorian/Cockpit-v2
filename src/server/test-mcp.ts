// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  projectMembers,
  projects,
  sessions,
  storyDependencies,
  tickets,
  userStories,
  users,
} from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { INSTALLATION_ID, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Shared by the tests of slice 4.3 (decision 017): the MCP harness of mcp.test.ts (a user with a real token, JSON-RPC
// over app.request(), the history read with raw SQL) and a way to put a story in any status, since only
// create_user_stories exists to write one and it always writes `to_validate`.

export type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;
export type App = ReturnType<typeof createApp>;

/** The GitHub stub is always on: a tool that must not reach GitHub fails loudly if it does. */
export async function setup(
  github: Partial<Parameters<typeof stubGitHub>[0]> = {},
) {
  const fetchMock = stubGitHub({ account: null, ...github });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app, fetchMock };
}

/** A user with a live session and a real MCP token created through the 4.1 route. */
export async function userWithToken(app: App, db: TestDb, githubId: number) {
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
  const cookie = `cockpit_session=${value}`;
  const res = await app.request("/api/me/tokens", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Mon Claude" }),
  });
  expect(res.status, "creating a token must work for this test").toBe(201);
  const { token, secret } = (await res.json()) as {
    token: { id: number };
    secret: string;
  };
  return { id: user.id, cookie, secret, tokenId: token.id };
}

export async function seedProject(
  db: TestDb,
  ownerId: number,
  values: { githubRepoId: number; fullName: string; archivedAt?: Date },
) {
  const [project] = await db
    .insert(projects)
    .values({
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
      ...values,
    })
    .returning({ id: projects.id });
  assert(project);
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: ownerId, role: "owner" });
  return project.id;
}

export async function seedTicket(
  db: TestDb,
  projectId: number,
  title: string,
  descriptionMd = "",
  abandonedAt?: Date,
) {
  const [ticket] = await db
    .insert(tickets)
    .values({ projectId, title, descriptionMd, abandonedAt })
    .returning({ id: tickets.id });
  assert(ticket);
  return ticket.id;
}

/** Closes the writing of a ticket's stories (decision 017 N): raw SQL, so the test does not depend on the Drizzle export of the column. */
export const closeWriting = (db: TestDb, ticketId: number, at = new Date()) =>
  db.execute(
    sql`update tickets set stories_written_at = ${at.toISOString()}::timestamptz where id = ${ticketId}`,
  );

/** `stories_written_at` of a ticket: null while Claude may still add stories. */
export async function writingClosedAt(db: TestDb, ticketId: number) {
  const result = await db.execute(
    sql`select stories_written_at from tickets where id = ${ticketId}`,
  );
  const found = (
    result as unknown as { rows: { stories_written_at: Date | null }[] }
  ).rows[0];
  assert(found, "the ticket exists");
  return found.stories_written_at;
}

export const archiveProject = (db: TestDb, projectId: number) =>
  db
    .update(projects)
    .set({ archivedAt: new Date() })
    .where(eq(projects.id, projectId));

/** Alice (and her token) with one project. */
export async function withProject(
  github: Partial<Parameters<typeof stubGitHub>[0]> = {},
) {
  const ctx = await setup({ account: 1000, ...github });
  const alice = await userWithToken(ctx.app, ctx.db, 1000);
  const projectId = await seedProject(ctx.db, alice.id, {
    githubRepoId: 1,
    fullName: "user1000/app",
  });
  return { ...ctx, alice, projectId };
}

// --- user stories, seeded straight into the tables of decision 017 A ---

export type StoryStatus =
  | "to_validate"
  | "to_rewrite"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done"
  | "abandoned";

type SeedStory = {
  position?: number;
  status?: StoryStatus;
  asA?: string;
  iWant?: string;
  soThat?: string;
  notesMd?: string;
  rewriteComment?: string | null;
  criteria?: { given: string; when: string; then: string }[];
  /** Ids of stories this one depends on. */
  dependsOn?: number[];
};

/** Inserts a story with its criteria and dependencies; returns its id. Fails with a clear message while the tables do not exist. */
export async function seedStory(
  db: TestDb,
  ticketId: number,
  values: SeedStory = {},
) {
  assert(
    userStories && acceptanceCriteria && storyDependencies,
    "schema.ts must export userStories, acceptanceCriteria and storyDependencies (decision 017 A)",
  );
  const position =
    values.position ??
    (
      await db
        .select({ id: userStories.id })
        .from(userStories)
        .where(eq(userStories.ticketId, ticketId))
    ).length + 1;
  const [story] = await db
    .insert(userStories)
    .values({
      ticketId,
      position,
      asA: values.asA ?? "un utilisateur",
      iWant: values.iWant ?? `faire la chose ${position}`,
      soThat: values.soThat ?? "gagner du temps",
      notesMd: values.notesMd ?? "",
      status: values.status ?? "to_validate",
      rewriteComment: values.rewriteComment ?? null,
    })
    .returning({ id: userStories.id });
  assert(story);
  const criteria = values.criteria ?? [
    { given: "un état", when: "une action", then: "un résultat" },
  ];
  await db.insert(acceptanceCriteria).values(
    criteria.map((c, i) => ({
      storyId: story.id,
      position: i + 1,
      givenText: c.given,
      whenText: c.when,
      thenText: c.then,
    })),
  );
  for (const dependsOnId of values.dependsOn ?? [])
    await db
      .insert(storyDependencies)
      .values({ storyId: story.id, dependsOnId });
  return story.id;
}

// --- JSON-RPC over HTTP ---

let nextId = 1;

/** One JSON-RPC request per POST. `authorization` undefined sends no header. */
export function rpc(
  app: App,
  method: string,
  params: unknown,
  authorization?: string,
) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
}

export type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

/** A tools/call that must come back as a JSON-RPC result (a refusal or an error is a result with isError, not a protocol error). */
export async function callTool(
  app: App,
  secret: string,
  name: string,
  args: unknown,
) {
  const res = await rpc(
    app,
    "tools/call",
    { name, arguments: args },
    `Bearer ${secret}`,
  );
  expect(res.status, "POST /mcp with a valid token").toBe(200);
  const body = (await res.json()) as { result?: ToolResult; error?: unknown };
  expect(
    body.error,
    "a tool outcome is never a protocol error",
  ).toBeUndefined();
  assert(body.result, "a JSON-RPC result");
  return body.result;
}

export const textOf = (result: ToolResult) => result.content[0]?.text ?? "";

/** The JSON of a successful tool call. */
export function dataOf<T>(result: ToolResult): T {
  expect(result.isError, textOf(result)).not.toBe(true);
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(textOf(result)) as T;
}

export function expectRefused(result: ToolResult) {
  expect(result.isError).toBe(true);
  expect(textOf(result)).toMatch(/^Refused: \S/);
  return textOf(result);
}

/** The names `tools/list` shows. */
export async function listedTools(app: App, secret: string) {
  const res = await rpc(app, "tools/list", {}, `Bearer ${secret}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: {
      tools: {
        name: string;
        description?: string;
        inputSchema?: {
          type?: string;
          properties?: Record<string, unknown>;
          required?: string[];
        };
      }[];
    };
  };
  return body.result.tools;
}

// --- history, read with raw SQL (so no test depends on the Drizzle export of a column) ---

export type Row = {
  id: number;
  user_id: number | null;
  token_id: number | null;
  project_id: number | null;
  ticket_id: number | null;
  story_id: number | null;
  actor: string;
  origin: string;
  action: string;
  args: Record<string, unknown>;
  result: string;
  detail: Record<string, string> | null;
};

export async function rows(db: Db, where = sql`true`) {
  const result = await db.execute(
    sql`select * from history where ${where} order by id`,
  );
  return (result as unknown as { rows: Row[] }).rows;
}

/** What Claude's calls left in the history. */
export const mcpRows = (db: Db) => rows(db, sql`origin = 'mcp'`);

/** The columns of an entry that every test compares (not story_id: checked where it matters). */
export const shape = (r: Row) => ({
  user_id: r.user_id,
  token_id: r.token_id,
  project_id: r.project_id,
  ticket_id: r.ticket_id,
  actor: r.actor,
  origin: r.origin,
  action: r.action,
  args: r.args,
  result: r.result,
  detail: r.detail,
});

/** The whole history as text, for "this never appears anywhere". */
export async function historyText(db: Db) {
  return JSON.stringify(await rows(db));
}

/** The one entry of a single call. */
export async function onlyEntry(db: Db) {
  const found = await mcpRows(db);
  expect(found, "one history entry for one call").toHaveLength(1);
  return found[0] as Row;
}

// --- what is in the story tables, for "nothing was created" ---

export async function storyCounts(db: Db) {
  const count = async (table: string) => {
    const result = await db.execute(
      sql.raw(`select count(*)::int as n from ${table}`),
    );
    return (result as unknown as { rows: { n: number }[] }).rows[0]?.n;
  };
  return {
    stories: await count("user_stories"),
    criteria: await count("acceptance_criteria"),
    dependencies: await count("story_dependencies"),
  };
}
