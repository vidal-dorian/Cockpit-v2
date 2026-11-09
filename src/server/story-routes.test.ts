// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { history, tickets, userStories } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { testAppOptions } from "./test-instance.ts";
import {
  type App,
  archiveProject,
  closeWriting,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 4.3 (decision 017 J, L): the UI routes that show the stories of a ticket and one story, and the rule that
// a ticket with stories is not deleted.
//
// Pinned shapes (camelCase like the ticket routes):
// - GET /api/tickets/:id        -> { ticket: { ..., storiesWrittenAt: ISO string | null }, stories: [{ id, position, iWant, status }] }
// - GET /api/stories/:id        -> { story: { id, ticketId, position, asA, iWant, soThat, notesMd, status,
//                                   criteria: [{ id, position, given, when, then }], dependsOn: [{ id, iWant, status }] },
//                                   ticket: { id, title }, project: { id, fullName, archived } }
// - DELETE /api/tickets/:id with stories -> 409 { error: "ticket_has_stories" }, one refused delete_ticket entry.

afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (app: App, cookie: string, path: string) =>
  app.request(path, { headers: { cookie } });

describe("criterion 11: GET /api/tickets/:id and the ticket list carry the stories and the computed step", () => {
  it("given a ticket with two stories, when it is read, then it comes with its stories { id, position, iWant, status } in order and its step is to_validate", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticketId = await seedTicket(db, projectId, "Écrit");
    const a = await seedStory(db, ticketId, {
      iWant: "premier",
      status: "ready",
    });
    const b = await seedStory(db, ticketId, {
      iWant: "second",
      status: "to_validate",
    });
    const other = await seedTicket(db, projectId, "Autre");
    await seedStory(db, other, { iWant: "ailleurs" });

    const res = await get(app, alice.cookie, `/api/tickets/${ticketId}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ticket: { id: number; step: string };
      stories: unknown[];
    };
    expect(body.ticket).toMatchObject({ id: ticketId, step: "to_validate" });
    expect(body.stories).toEqual([
      {
        id: a,
        position: 1,
        iWant: "premier",
        status: "ready",
        criteriaCount: 1,
        dependsOn: [],
        runId: null,
      },
      {
        id: b,
        position: 2,
        iWant: "second",
        status: "to_validate",
        criteriaCount: 1,
        dependsOn: [],
        runId: null,
      },
    ]);
  });

  it("given tickets in several states, when the project's ticket list is read, then each step is computed from its stories", async () => {
    const { app, db, alice, projectId } = await withProject();
    const fresh = await seedTicket(db, projectId, "Neuf");
    const toValidate = await seedTicket(db, projectId, "À valider");
    await seedStory(db, toValidate, { status: "to_validate" });
    const inProgress = await seedTicket(db, projectId, "Entamé");
    await seedStory(db, inProgress, { status: "done" });
    await seedStory(db, inProgress, { status: "ready" });
    const validated = await seedTicket(db, projectId, "Validé");
    await seedStory(db, validated, { status: "ready" });
    const done = await seedTicket(db, projectId, "Fini");
    await seedStory(db, done, { status: "done" });
    const abandoned = await seedTicket(db, projectId, "Lâché", "", new Date());

    const res = await get(
      app,
      alice.cookie,
      `/api/projects/${projectId}/tickets`,
    );

    const { tickets: listed } = (await res.json()) as {
      tickets: { id: number; step: string }[];
    };
    const stepOf = (id: number) => listed.find((t) => t.id === id)?.step;
    expect([
      stepOf(fresh),
      stepOf(toValidate),
      stepOf(inProgress),
      stepOf(validated),
      stepOf(done),
      stepOf(abandoned),
    ]).toEqual([
      "new",
      "to_validate",
      "in_progress",
      "validated",
      "done",
      "abandoned",
    ]);
  });
});

describe("choice N: GET /api/tickets/:id exposes whether Claude finished writing", () => {
  it("given a ticket whose writing is open and one whose writing is closed, when they are read, then storiesWrittenAt is null for the first and the ISO date of the closing for the second", async () => {
    const { app, db, alice, projectId } = await withProject();
    const open = await seedTicket(db, projectId, "Ouvert");
    await seedStory(db, open);
    const closed = await seedTicket(db, projectId, "Clos");
    await seedStory(db, closed);
    await closeWriting(db, closed, new Date("2026-10-26T10:00:00.000Z"));

    const read = async (id: number) =>
      (
        (await (await get(app, alice.cookie, `/api/tickets/${id}`)).json()) as {
          ticket: { storiesWrittenAt?: string | null };
        }
      ).ticket.storiesWrittenAt;

    expect(await read(open)).toBeNull();
    expect(await read(closed)).toBe("2026-10-26T10:00:00.000Z");
  });
});

describe("criterion 12: GET /api/stories/:id", () => {
  async function withStory() {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Le ticket");
    const base = await seedStory(db, ticketId, {
      status: "ready",
      iWant: "la base",
    });
    const id = await seedStory(db, ticketId, {
      status: "to_validate",
      asA: "lectrice",
      iWant: "relire",
      soThat: "corriger",
      notesMd: "des **notes**",
      criteria: [
        { given: "g1", when: "w1", then: "t1" },
        { given: "g2", when: "w2", then: "t2" },
      ],
      dependsOn: [base],
    });
    return { ...ctx, ticketId, base, id };
  }

  it("given a story of mine, when it is read, then the story with its criteria and dependencies, its ticket and its project, and no history entry is written", async () => {
    const s = await withStory();
    const before = (await rows(s.db)).length;

    const res = await get(s.app, s.alice.cookie, `/api/stories/${s.id}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      story: { criteria: { id: number }[] };
      ticket: unknown;
      project: unknown;
    };
    expect(body.story).toMatchObject({
      id: s.id,
      ticketId: s.ticketId,
      position: 2,
      asA: "lectrice",
      iWant: "relire",
      soThat: "corriger",
      notesMd: "des **notes**",
      status: "to_validate",
      criteria: [
        { position: 1, given: "g1", when: "w1", then: "t1" },
        { position: 2, given: "g2", when: "w2", then: "t2" },
      ],
      dependsOn: [{ id: s.base, iWant: "la base", status: "ready" }],
    });
    expect(body.story.criteria.every((c) => Number.isInteger(c.id))).toBe(true);
    expect(body.ticket).toEqual({ id: s.ticketId, title: "Le ticket" });
    // Slice 4.4 (decision 018 J): the project also says whether it is archived, so the page can disable the decisions.
    expect(body.project).toEqual({
      id: s.projectId,
      fullName: "user1000/app",
      defaultBranch: "main",
      archived: false,
      role: "owner",
    });
    expect(await rows(s.db)).toHaveLength(before);
  });

  it("given a story of an archived project, when it is read, then it is still readable", async () => {
    const s = await withStory();
    await archiveProject(s.db, s.projectId);

    const res = await get(s.app, s.alice.cookie, `/api/stories/${s.id}`);

    expect(res.status).toBe(200);
  });

  it("given no session, when it is read, then 401", async () => {
    const { app } = await withProject();

    const res = await get(app, "", "/api/stories/1");

    expect(res.status).toBe(401);
  });

  it("given an instance the wizard has not configured, when a story is read, then 503", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request("/api/stories/1");

    expect(res.status).toBe(503);
  });

  it("given another user's story, an unknown id and ids that are no id, when they are read, then every answer is 404 and nothing of the story leaks", async () => {
    const s = await withStory();
    const bob = await userWithToken(s.app, s.db, 2000);
    const bobsProject = await seedProject(s.db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });
    const bobsTicket = await seedTicket(s.db, bobsProject, "Idée de Bob");
    const bobsStory = await seedStory(s.db, bobsTicket, {
      iWant: "secret-de-Bob",
    });

    for (const id of [String(bobsStory), "424242", "abc", "0", "-1", "1.5"]) {
      const res = await get(s.app, s.alice.cookie, `/api/stories/${id}`);
      expect(res.status, `id ${id}`).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("secret-de-Bob");
    }
  });
});

describe("criterion 13: DELETE /api/tickets/:id when the ticket has stories", () => {
  it("given a ticket with stories, when it is deleted, then 409 ticket_has_stories, the ticket and its stories remain and one refused delete_ticket entry is written", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticketId = await seedTicket(db, projectId, "Écrit");
    await seedStory(db, ticketId, { status: "abandoned" });
    await seedStory(db, ticketId, { status: "ready" });

    const res = await app.request(`/api/tickets/${ticketId}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ticket_has_stories" });
    expect(await db.select().from(tickets)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(userStories)
        .where(eq(userStories.ticketId, ticketId)),
    ).toHaveLength(2);
    const entries = await db
      .select()
      .from(history)
      .where(eq(history.action, "delete_ticket"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: alice.id,
      projectId,
      ticketId,
      actor: "human",
      origin: "ui",
      result: "refused",
      detail: { reason: "ticket_has_stories" },
    });
  });

  it("given a ticket without stories next to one with stories, when the first is deleted, then 204 and the other keeps its stories", async () => {
    const { app, db, alice, projectId } = await withProject();
    const empty = await seedTicket(db, projectId, "Vide");
    const written = await seedTicket(db, projectId, "Écrit");
    await seedStory(db, written);

    const res = await app.request(`/api/tickets/${empty}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie },
    });

    expect(res.status).toBe(204);
    expect((await db.select().from(userStories)).length).toBe(1);
    expect((await db.select().from(tickets)).map((t) => t.id)).toEqual([
      written,
    ]);
  });
});
