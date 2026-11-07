// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import assert from "node:assert/strict";
import { asc, eq, sql } from "drizzle-orm";
import {
  acceptanceCriteria,
  storyDependencies,
  tickets,
  userStories,
} from "./db/schema.ts";
import {
  type App,
  rows,
  type StoryStatus,
  seedProject,
  seedStory,
  seedTicket,
  type TestDb,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Shared by the tests of slice 4.4 (decision 018): the human routes, called the way the page calls them, and a
// snapshot of a story to compare "nothing was written".
//
// Pinned shapes (camelCase like the ticket routes; the decision leaves them open):
// - POST /api/stories/:id/validate        no body            -> 200 { story }
// - POST /api/stories/:id/send-back       { comment }        -> 200 { story }
// - PATCH /api/stories/:id                { asA, iWant, soThat, notesMd?, criteria: [{ given, when, then }] } -> 200 { story }
// - POST /api/stories/:id/abandon         no body            -> 200 { story }
// - POST /api/tickets/:id/abandon         no body            -> 200 { ticket }
// - `story` is the story of GET /api/stories/:id (id, status, criteria, ...), which also carries `rewriteComment`
//   (string | null) and whose `project` also says `archived` (boolean).
// - Refusals: 400 { error: "Bad request" }, 404 { error: "Not found" }, 409 { error: "wrong_status" |
//   "project_archived" | "ticket_abandoned" }; a refusal that found its story leaves one `refused` entry
//   whose detail is { reason: <the same code> }, a 400 or a 404 leaves none.
// - GET /api/stories/:id/history -> { entries: [{ at, action, result, actor }] }, newest first.

export type Criterion = { given: string; when: string; then: string };
type EditBody = {
  asA: string;
  iWant: string;
  soThat: string;
  notesMd?: string;
  criteria: Criterion[];
};

export function send(
  app: App,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const validate = (app: App, cookie: string, id: number | string) =>
  send(app, cookie, "POST", `/api/stories/${id}/validate`);
export const sendBack = (
  app: App,
  cookie: string,
  id: number | string,
  body: unknown,
) => send(app, cookie, "POST", `/api/stories/${id}/send-back`, body);
export const editStory = (
  app: App,
  cookie: string,
  id: number | string,
  body: unknown,
) => send(app, cookie, "PATCH", `/api/stories/${id}`, body);
export const abandonStory = (app: App, cookie: string, id: number | string) =>
  send(app, cookie, "POST", `/api/stories/${id}/abandon`);
export const abandonTicket = (app: App, cookie: string, id: number | string) =>
  send(app, cookie, "POST", `/api/tickets/${id}/abandon`);
export const storyHistory = (app: App, cookie: string, id: number | string) =>
  send(app, cookie, "GET", `/api/stories/${id}/history`);

/** A valid body for the edit route, numbered so that its texts are recognisable. */
export const editBody = (
  n: number,
  over: Partial<EditBody> = {},
): EditBody => ({
  asA: `rôle-modifié-${n}`,
  iWant: `vouloir-modifié-${n}`,
  soThat: `but-modifié-${n}`,
  notesMd: `notes-modifiées-${n}`,
  criteria: [
    {
      given: `donné-neuf-${n}a`,
      when: `quand-neuf-${n}a`,
      then: `alors-neuf-${n}a`,
    },
    {
      given: `donné-neuf-${n}b`,
      when: `quand-neuf-${n}b`,
      then: `alors-neuf-${n}b`,
    },
    {
      given: `donné-neuf-${n}c`,
      when: `quand-neuf-${n}c`,
      then: `alors-neuf-${n}c`,
    },
  ],
  ...over,
});

export type Ctx = Awaited<ReturnType<typeof withProject>>;

/** Alice's project with one ticket, a ready story (the base) and a story in the wanted status that depends on it and has two criteria. */
export async function withStory(
  status: StoryStatus = "to_validate",
  over: Parameters<typeof seedStory>[2] = {},
) {
  const ctx = await withProject();
  const { db, projectId } = ctx;
  const ticketId = await seedTicket(db, projectId, "Le ticket");
  const base = await seedStory(db, ticketId, {
    status: "ready",
    iWant: "la base",
  });
  const id = await seedStory(db, ticketId, {
    status,
    asA: "lectrice",
    iWant: "relire",
    soThat: "corriger",
    notesMd: "des notes",
    criteria: [
      { given: "g1", when: "w1", then: "t1" },
      { given: "g2", when: "w2", then: "t2" },
    ],
    dependsOn: [base],
    ...over,
  });
  return { ...ctx, ticketId, base, id };
}

/** Bob, with a project, a ticket and a story Alice must never reach. */
export async function bobsStory(ctx: Ctx) {
  const bob = await userWithToken(ctx.app, ctx.db, 2000);
  const project = await seedProject(ctx.db, bob.id, {
    githubRepoId: 9,
    fullName: "user2000/private",
  });
  const ticketId = await seedTicket(ctx.db, project, "Idée de Bob");
  const storyId = await seedStory(ctx.db, ticketId, {
    status: "to_validate",
    iWant: "secret-de-Bob",
  });
  return { bob, project, ticketId, storyId };
}

/** Everything the decisions can change on a story, read straight from the tables. */
export async function snapshot(db: TestDb, storyId: number) {
  const [story] = await db
    .select()
    .from(userStories)
    .where(eq(userStories.id, storyId));
  assert(story, `story ${storyId} exists`);
  const criteria = await db
    .select()
    .from(acceptanceCriteria)
    .where(eq(acceptanceCriteria.storyId, storyId))
    .orderBy(asc(acceptanceCriteria.position));
  const dependencies = await db
    .select()
    .from(storyDependencies)
    .where(eq(storyDependencies.storyId, storyId))
    .orderBy(asc(storyDependencies.dependsOnId));
  return {
    status: story.status,
    asA: story.asA,
    iWant: story.iWant,
    soThat: story.soThat,
    notesMd: story.notesMd,
    rewriteComment: story.rewriteComment,
    criteria: criteria.map((c) => ({
      id: c.id,
      position: c.position,
      given: c.givenText,
      when: c.whenText,
      then: c.thenText,
    })),
    dependsOn: dependencies.map((d) => d.dependsOnId),
  };
}

export async function statusesOf(db: TestDb, ticketId: number) {
  const found = await db
    .select({ id: userStories.id, status: userStories.status })
    .from(userStories)
    .where(eq(userStories.ticketId, ticketId))
    .orderBy(asc(userStories.position));
  return found.map((s) => s.status);
}

export async function ticketRow(db: TestDb, ticketId: number) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  assert(ticket, `ticket ${ticketId} exists`);
  return ticket;
}

/** The decision entries, as a number: "this call wrote no entry". The fixture's create_token and the issue syncs that follow a decision (decision 020, tested in issues.test.ts) are left out. */
export async function entryCount(db: TestDb) {
  return (await rows(db, sql`action not in ('create_token', 'sync_issue')`))
    .length;
}
