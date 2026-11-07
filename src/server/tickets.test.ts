import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import {
  acceptanceCriteria,
  history,
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

// Slice 3.1: a ticket is an idea of a project (decision 002). Its step is computed, never stored.
// Expected table `tickets`: id (identity), project_id (FK projects, restrict), title, description_md (default ''),
// abandoned_at (null), created_at, updated_at; and a new nullable `ticket_id` column on `history` (no FK, decision 010).

afterEach(() => {
  vi.unstubAllGlobals();
});

type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;
type App = ReturnType<typeof createApp>;

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app };
}

/** A user with a live session (login user<githubId>); returns the user id and the Cookie header. */
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

async function seedProject(
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

/** A user with one project; the common starting point. */
async function withProject(archived = false) {
  const { app, db } = await setup();
  const a = await userWithSession(db, 1000);
  const projectId = await seedProject(db, a.id, {
    githubRepoId: 1,
    fullName: "user1000/app",
  });
  const archive = () =>
    db
      .update(projects)
      .set({ archivedAt: new Date() })
      .where(eq(projects.id, projectId));
  if (archived) await archive();
  return { app, db, a, projectId, archive };
}

type Ticket = {
  id: number;
  projectId: number;
  title: string;
  descriptionMd: string;
  step: string;
  createdAt: string;
  updatedAt: string;
};

const json = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const createTicket = (
  app: App,
  cookie: string,
  projectId: number | string,
  body: unknown,
) =>
  app.request(`/api/projects/${projectId}/tickets`, json(cookie, "POST", body));
const listTickets = (app: App, cookie: string, projectId: number | string) =>
  app.request(`/api/projects/${projectId}/tickets`, { headers: { cookie } });
const getTicket = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/tickets/${id}`, { headers: { cookie } });
const patchTicket = (
  app: App,
  cookie: string,
  id: number | string,
  body: unknown,
) => app.request(`/api/tickets/${id}`, json(cookie, "PATCH", body));
const deleteTicket = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/tickets/${id}`, { method: "DELETE", headers: { cookie } });

/** Creates a ticket through the API (the way a user does) and returns it. */
async function makeTicket(
  app: App,
  cookie: string,
  projectId: number,
  body: { title: string; descriptionMd?: string } = { title: "Un ticket" },
) {
  const res = await createTicket(app, cookie, projectId, body);
  expect(res.status, "the ticket must be created").toBe(201);
  return ((await res.json()) as { ticket: Ticket }).ticket;
}

const entriesOf = (db: TestDb, action: string) =>
  db.select().from(history).where(eq(history.action, action));
const ticketActions = ["create_ticket", "update_ticket", "delete_ticket"];
const allTicketEntries = async (db: TestDb) =>
  (await db.select().from(history)).filter((e) =>
    ticketActions.includes(e.action),
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("POST /api/projects/:id/tickets", () => {
  it("given a title and a project, when the ticket is created, then 201, the ticket is new with an empty description, and one create_ticket/ok entry holds only its ids", async () => {
    const { app, db, a, projectId } = await withProject();

    const res = await createTicket(app, a.cookie, projectId, {
      title: "Ajouter la recherche",
    });

    expect(res.status).toBe(201);
    const { ticket } = (await res.json()) as { ticket: Ticket };
    expect(ticket).toMatchObject({
      projectId,
      title: "Ajouter la recherche",
      descriptionMd: "",
      step: "new",
    });
    expect(Object.keys(ticket).sort()).toEqual([
      "abandonedAt",
      "createdAt",
      "descriptionMd",
      "id",
      "projectId",
      "step",
      "storiesWrittenAt",
      "title",
      "updatedAt",
    ]);
    expect(Number.isNaN(Date.parse(ticket.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(ticket.updatedAt))).toBe(false);
    const rows = await db.select().from(tickets);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ticket.id, projectId });
    const entries = await entriesOf(db, "create_ticket");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId,
      ticketId: ticket.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { ticketId: ticket.id },
    });
  });

  it("given a title padded with spaces and a markdown description, when the ticket is created, then the title is trimmed and the description is stored as sent", async () => {
    const { app, a, projectId } = await withProject();
    const description =
      "# Contexte\n\n- un **point**\n\n  fin avec espaces  \n";

    const res = await createTicket(app, a.cookie, projectId, {
      title: "   Un titre   ",
      descriptionMd: description,
    });

    expect(res.status).toBe(201);
    const { ticket } = (await res.json()) as { ticket: Ticket };
    expect(ticket.title).toBe("Un titre");
    expect(ticket.descriptionMd).toBe(description);
  });

  it("given a title of 200 characters and a description of 50,000, when the ticket is created, then 201 (the limits are inclusive)", async () => {
    const { app, a, projectId } = await withProject();

    const res = await createTicket(app, a.cookie, projectId, {
      title: "t".repeat(200),
      descriptionMd: "d".repeat(50_000),
    });

    expect(res.status).toBe(201);
  });

  it.each([
    ["no title", {}],
    ["an empty title", { title: "" }],
    ["a title of spaces only", { title: "   \n\t " }],
    ["a title that is not a string", { title: 12 }],
    ["a title of 201 characters", { title: "t".repeat(201) }],
    ["a NUL character in the title", { title: "a\u0000b" }],
    [
      "a NUL character in the description",
      { title: "ok", descriptionMd: "a\u0000b" },
    ],
    ["a description that is not a string", { title: "ok", descriptionMd: 3 }],
    [
      "a description of 50,001 characters",
      { title: "ok", descriptionMd: "d".repeat(50_001) },
    ],
  ])(
    "given %s, when the ticket is created, then 400 and nothing is written, not even in the history",
    async (_name, body) => {
      const { app, db, a, projectId } = await withProject();

      const res = await createTicket(app, a.cookie, projectId, body);

      expect(res.status).toBe(400);
      expect(await db.select().from(tickets)).toHaveLength(0);
      expect(await allTicketEntries(db)).toHaveLength(0);
    },
  );

  it("given a body that is not JSON, when the ticket is created, then 400 and nothing is written", async () => {
    const { app, db, a, projectId } = await withProject();

    const res = await app.request(`/api/projects/${projectId}/tickets`, {
      method: "POST",
      headers: { cookie: a.cookie, "content-type": "application/json" },
      body: "{not json",
    });

    expect(res.status).toBe(400);
    expect(await db.select().from(tickets)).toHaveLength(0);
    expect(await allTicketEntries(db)).toHaveLength(0);
  });

  it("given an archived project, when a ticket is created, then 409 project_archived, no ticket and one refused create_ticket entry", async () => {
    const { app, db, a, projectId } = await withProject(true);

    const res = await createTicket(app, a.cookie, projectId, { title: "Non" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await db.select().from(tickets)).toHaveLength(0);
    const entries = await entriesOf(db, "create_ticket");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId,
      result: "refused",
      detail: { reason: "project_archived" },
    });
  });

  it("given a title and a description with recognisable text, when tickets are created, edited and deleted, then that text appears nowhere in the history", async () => {
    const { app, db, a, projectId } = await withProject();
    const ticket = await makeTicket(app, a.cookie, projectId, {
      title: "TITRE-SECRET-4711",
      descriptionMd: "DESCRIPTION-SECRETE-4711",
    });
    await patchTicket(app, a.cookie, ticket.id, {
      title: "AUTRE-TITRE-4711",
      descriptionMd: "AUTRE-DESCRIPTION-4711",
    });
    await deleteTicket(app, a.cookie, ticket.id);

    const everything = JSON.stringify(await db.select().from(history));

    expect(await allTicketEntries(db)).toHaveLength(3);
    expect(everything).not.toMatch(/4711/);
  });
});

describe("GET /api/projects/:id/tickets", () => {
  it("given three tickets of the project and one of another project, when the list is requested, then only the three come back, newest first, each new", async () => {
    const { app, db, a, projectId } = await withProject();
    const other = await seedProject(db, a.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    await makeTicket(app, a.cookie, projectId, { title: "premier" });
    await makeTicket(app, a.cookie, projectId, { title: "deuxième" });
    await makeTicket(app, a.cookie, other, { title: "ailleurs" });
    await makeTicket(app, a.cookie, projectId, { title: "troisième" });

    const res = await listTickets(app, a.cookie, projectId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: Ticket[] };
    expect(body.tickets.map((t) => t.title)).toEqual([
      "troisième",
      "deuxième",
      "premier",
    ]);
    expect(body.tickets.every((t) => t.step === "new")).toBe(true);
    expect(body.tickets.every((t) => t.projectId === projectId)).toBe(true);
  });

  it("given a project without ticket, when the list is requested, then 200 with an empty list", async () => {
    const { app, a, projectId } = await withProject();

    const res = await listTickets(app, a.cookie, projectId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tickets: [] });
  });

  it("given a project archived after it got a ticket, when the list is requested, then the ticket is still listed", async () => {
    const { app, a, projectId, archive } = await withProject();
    await makeTicket(app, a.cookie, projectId, { title: "ancien" });
    await archive();

    const res = await listTickets(app, a.cookie, projectId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: Ticket[] };
    expect(body.tickets.map((t) => t.title)).toEqual(["ancien"]);
  });
});

describe("GET /api/tickets/:id", () => {
  it("given a ticket with a markdown description, when it is read, then 200 and the description comes back exactly as stored", async () => {
    const { app, a, projectId } = await withProject();
    const description = "## Titre\n\n**gras**, `code`\n\n  deux espaces  \n\n";
    const created = await makeTicket(app, a.cookie, projectId, {
      title: "Lire",
      descriptionMd: description,
    });

    const res = await getTicket(app, a.cookie, created.id);

    expect(res.status).toBe(200);
    // Slice 4.3 (decision 017 L): the answer also carries the ticket's stories, none here.
    expect(await res.json()).toEqual({
      ticket: { ...created, descriptionMd: description, step: "new" },
      stories: [],
    });
  });
});

describe("GET /api/tickets/:id, the rows of the stories", () => {
  it("given two stories, one with two criteria that depends on the other, when the ticket is read, then each story carries its criteria count, its dependencies and its latest run", async () => {
    const { app, db, a, projectId } = await withProject();
    const created = await makeTicket(app, a.cookie, projectId, { title: "T" });
    const [first, second] = await db
      .insert(userStories)
      .values(
        [1, 2].map((position) => ({
          ticketId: created.id,
          position,
          asA: "a",
          iWant: `veut ${position}`,
          soThat: "b",
          status: "ready",
        })),
      )
      .returning();
    assert(first && second);
    await db.insert(acceptanceCriteria).values(
      [1, 2].map((position) => ({
        storyId: second.id,
        position,
        given: "g",
        when: "w",
        then: "t",
      })),
    );
    await db
      .insert(storyDependencies)
      .values({ storyId: second.id, dependsOnId: first.id });

    const res = await getTicket(app, a.cookie, created.id);

    const body = (await res.json()) as {
      stories: {
        id: number;
        criteriaCount: number;
        dependsOn: number[];
        runId: number | null;
      }[];
    };
    expect(
      body.stories.map((s) => [s.id, s.criteriaCount, s.dependsOn, s.runId]),
    ).toEqual([
      [first.id, 0, [], null],
      [second.id, 2, [first.id], null],
    ]);
  });
});

describe("PATCH /api/tickets/:id", () => {
  it("given a ticket, when its title and description are edited, then 200, updatedAt moves, createdAt does not and one update_ticket/ok entry holds only the ids", async () => {
    const { app, db, a, projectId } = await withProject();
    const created = await makeTicket(app, a.cookie, projectId, {
      title: "Avant",
      descriptionMd: "avant",
    });
    await sleep(25);

    const res = await patchTicket(app, a.cookie, created.id, {
      title: "  Après  ",
      descriptionMd: "**après**",
    });

    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: Ticket };
    expect(ticket).toMatchObject({
      id: created.id,
      projectId,
      title: "Après",
      descriptionMd: "**après**",
      step: "new",
      createdAt: created.createdAt,
    });
    expect(Date.parse(ticket.updatedAt)).toBeGreaterThan(
      Date.parse(created.updatedAt),
    );
    const read = (await (
      await getTicket(app, a.cookie, created.id)
    ).json()) as {
      ticket: Ticket;
    };
    expect(read.ticket).toEqual(ticket);
    const entries = await entriesOf(db, "update_ticket");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId,
      ticketId: created.id,
      result: "ok",
      args: { ticketId: created.id },
    });
  });

  it("given a ticket, when only the description is edited, then the title is kept, and when only the title is edited, then the description is kept (it can be emptied)", async () => {
    const { app, a, projectId } = await withProject();
    const created = await makeTicket(app, a.cookie, projectId, {
      title: "Garde-moi",
      descriptionMd: "ancienne",
    });

    const first = await patchTicket(app, a.cookie, created.id, {
      descriptionMd: "",
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { ticket: Ticket }).ticket).toMatchObject({
      title: "Garde-moi",
      descriptionMd: "",
    });
    const second = await patchTicket(app, a.cookie, created.id, {
      title: "Nouveau titre",
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { ticket: Ticket }).ticket).toMatchObject({
      title: "Nouveau titre",
      descriptionMd: "",
    });
  });

  it.each([
    ["no key", {}],
    ["an empty title", { title: "" }],
    ["a title of spaces only", { title: "  " }],
    ["a title of 201 characters", { title: "t".repeat(201) }],
    ["a title that is not a string", { title: null }],
    ["a NUL character in the title", { title: "a\u0000b" }],
    ["a NUL character in the description", { descriptionMd: "a\u0000b" }],
    [
      "a description of 50,001 characters",
      { descriptionMd: "d".repeat(50_001) },
    ],
    ["a description that is not a string", { descriptionMd: 7 }],
  ])(
    "given %s, when a ticket is edited, then 400 and the ticket and the history are unchanged",
    async (_name, body) => {
      const { app, db, a, projectId } = await withProject();
      const created = await makeTicket(app, a.cookie, projectId, {
        title: "Intact",
        descriptionMd: "intact",
      });

      const res = await patchTicket(app, a.cookie, created.id, body);

      expect(res.status).toBe(400);
      const read = (await (
        await getTicket(app, a.cookie, created.id)
      ).json()) as {
        ticket: Ticket;
      };
      expect(read.ticket).toEqual(created);
      expect(await entriesOf(db, "update_ticket")).toHaveLength(0);
    },
  );

  it("given a ticket of an archived project, when it is edited, then 409 project_archived, the ticket is unchanged and one refused update_ticket entry is written", async () => {
    const { app, db, a, projectId, archive } = await withProject();
    const created = await makeTicket(app, a.cookie, projectId, {
      title: "Figé",
    });
    await archive();

    const res = await patchTicket(app, a.cookie, created.id, { title: "Non" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    const read = (await (
      await getTicket(app, a.cookie, created.id)
    ).json()) as {
      ticket: Ticket;
    };
    expect(read.ticket.title).toBe("Figé");
    const entries = await entriesOf(db, "update_ticket");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId,
      ticketId: created.id,
      result: "refused",
      detail: { reason: "project_archived" },
    });
  });
});

describe("DELETE /api/tickets/:id", () => {
  // Decision 002 rule 2 (a ticket is deleted only while it has no US) is trivially true until US exist (slice 4.3): no test yet.
  it("given a ticket without user story, when it is deleted, then 204, it is gone, the others stay and one delete_ticket/ok entry keeps its id", async () => {
    const { app, db, a, projectId } = await withProject();
    const doomed = await makeTicket(app, a.cookie, projectId, {
      title: "À supprimer",
    });
    const kept = await makeTicket(app, a.cookie, projectId, { title: "Reste" });

    const res = await deleteTicket(app, a.cookie, doomed.id);

    expect(res.status).toBe(204);
    expect((await getTicket(app, a.cookie, doomed.id)).status).toBe(404);
    const rows = await db.select().from(tickets);
    expect(rows.map((t) => t.id)).toEqual([kept.id]);
    const entries = await entriesOf(db, "delete_ticket");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId,
      ticketId: doomed.id,
      result: "ok",
      args: { ticketId: doomed.id },
    });
    // The create entry survives the deletion and still points at the vanished ticket.
    const created = await entriesOf(db, "create_ticket");
    expect(created.map((e) => e.ticketId)).toContain(doomed.id);
  });

  it("given a ticket of an archived project, when it is deleted, then 409 project_archived, the ticket still exists and one refused delete_ticket entry is written", async () => {
    const { app, db, a, projectId, archive } = await withProject();
    const ticket = await makeTicket(app, a.cookie, projectId, {
      title: "Figé",
    });
    await archive();

    const res = await deleteTicket(app, a.cookie, ticket.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect((await getTicket(app, a.cookie, ticket.id)).status).toBe(200);
    expect(await db.select().from(tickets)).toHaveLength(1);
    const entries = await entriesOf(db, "delete_ticket");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: a.id,
      projectId,
      ticketId: ticket.id,
      result: "refused",
      detail: { reason: "project_archived" },
    });
  });

  it("given a ticket deleted once, when it is deleted again, then 404 and no second delete_ticket entry", async () => {
    const { app, db, a, projectId } = await withProject();
    const ticket = await makeTicket(app, a.cookie, projectId);
    await deleteTicket(app, a.cookie, ticket.id);

    const res = await deleteTicket(app, a.cookie, ticket.id);

    expect(res.status).toBe(404);
    expect(await entriesOf(db, "delete_ticket")).toHaveLength(1);
  });
});

describe("access to the ticket routes", () => {
  const routes: [
    string,
    (app: App, cookie: string, id: string) => Promise<Response> | Response,
  ][] = [
    ["GET /api/projects/:id/tickets", listTickets],
    [
      "POST /api/projects/:id/tickets",
      (app, cookie, id) => createTicket(app, cookie, id, { title: "Non" }),
    ],
    ["GET /api/tickets/:id", getTicket],
    [
      "PATCH /api/tickets/:id",
      (app, cookie, id) => patchTicket(app, cookie, id, { title: "Non" }),
    ],
    ["DELETE /api/tickets/:id", deleteTicket],
  ];

  it.each(routes)(
    "given no session, when %s is called, then 401 and nothing is written",
    async (_name, call) => {
      const { app, db, a, projectId } = await withProject();
      const ticket = await makeTicket(app, a.cookie, projectId);
      const before = (await db.select().from(history)).length;

      const res = await call(app, "", String(ticket.id));
      // The two project routes take a project id, not a ticket id.
      const projectRes = await call(app, "", String(projectId));

      expect(res.status).toBe(401);
      expect(projectRes.status).toBe(401);
      expect((await db.select().from(tickets)).map((t) => t.title)).toEqual([
        "Un ticket",
      ]);
      expect((await db.select().from(history)).length).toBe(before);
    },
  );

  it.each(routes)(
    "given an instance the wizard has not configured, when %s is called, then 503 whoever asks",
    async (_name, call) => {
      const db = await openTestDatabase();
      const app = createApp(db, "1.2.3", testAppOptions);

      const res = await call(app, "", "1");

      expect(res.status).toBe(503);
    },
  );

  it("given a project and a ticket of user B, when A reads, lists, creates, edits or deletes through them, then every answer is 404, B's ticket is intact and no ticket entry is written for A", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1000);
    const b = await userWithSession(db, 2000);
    const bProject = await seedProject(db, b.id, {
      githubRepoId: 2,
      fullName: "user2000/app",
    });
    const theirs = await makeTicket(app, b.cookie, bProject, {
      title: "Secret de B",
      descriptionMd: "pas pour A",
    });
    const before = (await allTicketEntries(db)).length;

    const answers = [
      await listTickets(app, a.cookie, bProject),
      await createTicket(app, a.cookie, bProject, { title: "Intrus" }),
      await getTicket(app, a.cookie, theirs.id),
      await patchTicket(app, a.cookie, theirs.id, { title: "Piraté" }),
      await deleteTicket(app, a.cookie, theirs.id),
    ];

    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    for (const res of answers) {
      expect(JSON.stringify(await res.json())).not.toContain("Secret de B");
    }
    const read = (await (await getTicket(app, b.cookie, theirs.id)).json()) as {
      ticket: Ticket;
    };
    expect(read.ticket).toEqual(theirs);
    expect((await db.select().from(tickets)).map((t) => t.title)).toEqual([
      "Secret de B",
    ]);
    const entries = await allTicketEntries(db);
    expect(entries).toHaveLength(before);
    expect(entries.some((e) => e.userId === a.id)).toBe(false);
  });

  it.each(routes)(
    "given an id that is no id (abc, 0, -1, 1.5, 99999999999) or unknown, when %s is called, then 404, no error and no entry",
    async (_name, call) => {
      const { app, db, a, projectId } = await withProject();
      // Control: the feature works for a real ticket, so a 404 below is about the id.
      await makeTicket(app, a.cookie, projectId);
      const before = await allTicketEntries(db);

      for (const id of ["abc", "0", "-1", "1.5", "99999999999", "424242"]) {
        const res = await call(app, a.cookie, id);
        expect(res.status, `id ${id}`).toBe(404);
      }
      expect(await allTicketEntries(db)).toEqual(before);
    },
  );
});

// A JSON body is read whole in memory: the limit is 256 KiB for every JSON route, checked before the session and the validation.
describe("the size of a request body", () => {
  const LIMIT = 256 * 1024;
  const huge = (extra: Record<string, unknown>) => ({
    ...extra,
    padding: "x".repeat(LIMIT + 1),
  });

  it("given a body over 256 KiB, when a ticket is created or edited, then 413 and nothing is written, with or without a session", async () => {
    const { app, db, a, projectId } = await withProject();
    const ticket = await makeTicket(app, a.cookie, projectId, {
      title: "Intact",
    });
    const before = (await db.select().from(history)).length;

    for (const cookie of [a.cookie, ""]) {
      const created = await createTicket(
        app,
        cookie,
        projectId,
        huge({ title: "Trop gros" }),
      );
      const edited = await patchTicket(
        app,
        cookie,
        ticket.id,
        huge({ title: "Trop gros" }),
      );
      const bigDescription = await createTicket(app, cookie, projectId, {
        title: "Trop gros",
        descriptionMd: "d".repeat(LIMIT + 1),
      });
      expect([created.status, edited.status, bigDescription.status]).toEqual([
        413, 413, 413,
      ]);
    }
    expect((await db.select().from(tickets)).map((t) => t.title)).toEqual([
      "Intact",
    ]);
    expect((await db.select().from(history)).length).toBe(before);
  });

  it("given a body over 256 KiB, when a project is imported, then 413 too (the limit is not only for tickets)", async () => {
    // Stubbed so that, until the limit exists, the import cannot reach the real GitHub.
    stubGitHub({ account: 1000 });
    const { app, a } = await withProject();

    const res = await app.request(
      "/api/projects",
      json(a.cookie, "POST", huge({ githubRepoId: 1 })),
    );

    expect(res.status).toBe(413);
  });

  it("given a valid ticket whose body is large but under the limit (50,000 two-byte characters), when it is created and then edited, then 201 and 200", async () => {
    const { app, a, projectId } = await withProject();
    const description = "é".repeat(50_000);

    const created = await createTicket(app, a.cookie, projectId, {
      title: "Gros mais permis",
      descriptionMd: description,
    });
    const id = ((await created.json()) as { ticket: Ticket }).ticket?.id;
    const edited = await patchTicket(app, a.cookie, id, {
      descriptionMd: description,
    });

    expect(created.status).toBe(201);
    expect(edited.status).toBe(200);
  });
});
