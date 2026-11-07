// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { questions, runs, userStories } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { abandonStory, validate } from "./test-decisions.ts";
import { testAppOptions } from "./test-instance.ts";
import {
  type App,
  archiveProject,
  callTool,
  dataOf,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 4.5 (decision 019): the Kanban of a project, read from one route.
//
// Pinned shape (camelCase like the ticket routes):
// - GET /api/projects/:id/stories -> { stories: [{ id, ticketId, ticketTitle, position, iWant, status, issueDiverged }] }
//   (`issueDiverged`: boolean, added by decision 025 J, slice 5.2: the issue of the story was edited on GitHub)
//   the non-abandoned stories of the project, ordered by ticket id then position; a read, so no history entry.
// - The 404 tests always read the project of the caller first: a route that does not exist answers 404 too.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Card = {
  id: number;
  ticketId: number;
  ticketTitle: string;
  position: number;
  iWant: string;
  status: string;
  issueDiverged: boolean;
  prNumber: number | null;
  prCiState: string | null;
  criteriaCount: number;
  questionPending: boolean;
};

const listStories = (app: App, cookie: string, projectId: number | string) =>
  app.request(`/api/projects/${projectId}/stories`, { headers: { cookie } });

async function cardsOf(app: App, cookie: string, projectId: number | string) {
  const res = await listStories(app, cookie, projectId);
  expect(res.status, "listing the stories of the project").toBe(200);
  return ((await res.json()) as { stories: Card[] }).stories;
}

describe("criterion 1: GET /api/projects/:id/stories", () => {
  it("given stories on two tickets saved out of order, when the project's stories are read, then they come as { id, ticketId, ticketTitle, position, iWant, status } ordered by ticket id then position", async () => {
    const { app, db, alice, projectId } = await withProject();
    const first = await seedTicket(db, projectId, "Premier ticket");
    const second = await seedTicket(db, projectId, "Second ticket");
    const s2p1 = await seedStory(db, second, {
      position: 1,
      iWant: "s2p1",
      status: "ready",
    });
    const s1p2 = await seedStory(db, first, {
      position: 2,
      iWant: "s1p2",
      status: "in_review",
    });
    const s1p1 = await seedStory(db, first, {
      position: 1,
      iWant: "s1p1",
      status: "to_rewrite",
    });

    const res = await listStories(app, alice.cookie, projectId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stories: [
        {
          id: s1p1,
          ticketId: first,
          ticketTitle: "Premier ticket",
          position: 1,
          iWant: "s1p1",
          status: "to_rewrite",
          issueDiverged: false,
          prNumber: null,
          prCiState: null,
          criteriaCount: 1,
          questionPending: false,
        },
        {
          id: s1p2,
          ticketId: first,
          ticketTitle: "Premier ticket",
          position: 2,
          iWant: "s1p2",
          status: "in_review",
          issueDiverged: false,
          prNumber: null,
          prCiState: null,
          criteriaCount: 1,
          questionPending: false,
        },
        {
          id: s2p1,
          ticketId: second,
          ticketTitle: "Second ticket",
          position: 1,
          iWant: "s2p1",
          status: "ready",
          issueDiverged: false,
          prNumber: null,
          prCiState: null,
          criteriaCount: 1,
          questionPending: false,
        },
      ],
    });
  });

  it("given stories with criteria, a PR with a failing CI and a running run with a pending question, when read, then the card has criteriaCount, prNumber, prCiState and questionPending", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Le ticket");
    const asking = await seedStory(db, ticket, {
      status: "in_progress",
      criteria: [
        { given: "a", when: "b", then: "c" },
        { given: "d", when: "e", then: "f" },
      ],
    });
    const reviewed = await seedStory(db, ticket, { status: "in_review" });
    await db
      .update(userStories)
      .set({ prNumber: 44, prCiState: "failure" })
      .where(eq(userStories.id, reviewed));
    const [run] = await db
      .insert(runs)
      .values({
        storyId: asking,
        userId: alice.id,
        status: "running",
        modelActual: "sonnet",
      })
      .returning({ id: runs.id });
    await db
      .insert(questions)
      .values({ runId: run?.id ?? 0, question: "Quoi ?" });

    const cards = await cardsOf(app, alice.cookie, projectId);

    expect(
      cards.map((c) => [
        c.id,
        c.criteriaCount,
        c.prNumber,
        c.prCiState,
        c.questionPending,
      ]),
    ).toEqual([
      [asking, 2, null, null, true],
      [reviewed, 1, 44, "failure", false],
    ]);
  });

  it("given a project without story, when it is read, then 200 with an empty list", async () => {
    const { app, db, alice, projectId } = await withProject();
    await seedTicket(db, projectId, "Sans US");

    const res = await listStories(app, alice.cookie, projectId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stories: [] });
  });

  it("given abandoned stories and stories of other projects, when the project's stories are read, then only its own non-abandoned stories come back", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Le ticket");
    const kept = await seedStory(db, ticket, {
      iWant: "gardée",
      status: "done",
    });
    await seedStory(db, ticket, { iWant: "lâchée", status: "abandoned" });
    const otherProject = await seedProject(db, alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    const otherTicket = await seedTicket(db, otherProject, "Ailleurs");
    await seedStory(db, otherTicket, { iWant: "autre-projet" });
    const bob = await userWithToken(app, db, 2000);
    const bobsProject = await seedProject(db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });
    const bobsTicket = await seedTicket(db, bobsProject, "Idée de Bob");
    await seedStory(db, bobsTicket, { iWant: "secret-de-Bob" });

    const cards = await cardsOf(app, alice.cookie, projectId);

    expect(cards.map((c) => [c.id, c.iWant])).toEqual([[kept, "gardée"]]);
  });

  it("given a project archived after it got stories, when its stories are read, then they are still listed", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Ancien");
    const id = await seedStory(db, ticket, { status: "ready" });
    await archiveProject(db, projectId);

    const cards = await cardsOf(app, alice.cookie, projectId);

    expect(cards.map((c) => c.id)).toEqual([id]);
  });

  it("given a project with stories, when its stories are read, then no history entry is written", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Le ticket");
    await seedStory(db, ticket);
    const before = (await rows(db)).length;

    const cards = await cardsOf(app, alice.cookie, projectId);

    expect(cards).toHaveLength(1);
    expect(await rows(db)).toHaveLength(before);
  });

  it("given no session, when the stories are read, then 401", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Le ticket");
    await seedStory(db, ticket);
    expect((await listStories(app, alice.cookie, projectId)).status).toBe(200);

    const res = await listStories(app, "", projectId);

    expect(res.status).toBe(401);
  });

  it("given an instance the wizard has not configured, when the stories are read, then 503", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await listStories(app, "", 1);

    expect(res.status).toBe(503);
  });

  it("given another user's project, an unknown id and ids that are no id, when their stories are read, then every answer is 404 and nothing leaks", async () => {
    const { app, db, alice, projectId } = await withProject();
    const mine = await seedTicket(db, projectId, "À moi");
    await seedStory(db, mine);
    expect((await cardsOf(app, alice.cookie, projectId)).length).toBe(1);
    const bob = await userWithToken(app, db, 2000);
    const bobsProject = await seedProject(db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });
    const bobsTicket = await seedTicket(db, bobsProject, "Idée de Bob");
    await seedStory(db, bobsTicket, { iWant: "secret-de-Bob" });

    for (const id of [String(bobsProject), "424242", "abc", "0", "-1", "1.5"]) {
      const res = await listStories(app, alice.cookie, id);
      expect(res.status, `id ${id}`).toBe(404);
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain("secret-de-Bob");
      expect(text).not.toContain("Idée de Bob");
    }
  });
});

describe("criterion 6: the cards follow the real state of the stories", () => {
  it("given Claude wrote two stories, when the human validates one and then abandons the other, then the list shows two to_validate, then a ready and a to_validate, then only the ready one", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticketId = await seedTicket(db, projectId, "Exporter", "idée");

    // 1. Claude writes two stories: both wait for the human.
    const created = dataOf<{ stories: { id: number }[] }>(
      await callTool(app, alice.secret, "create_user_stories", {
        ticket_id: ticketId,
        stories: [1, 2].map((n) => ({
          as_a: `rôle-${n}`,
          i_want: `vouloir-${n}`,
          so_that: `but-${n}`,
          criteria: [{ given: `g-${n}`, when: `w-${n}`, then: `t-${n}` }],
        })),
      }),
    );
    const [a, b] = created.stories.map((s) => s.id) as [number, number];
    const statuses = async () =>
      (await cardsOf(app, alice.cookie, projectId)).map((c) => [
        c.id,
        c.status,
      ]);
    expect(await statuses()).toEqual([
      [a, "to_validate"],
      [b, "to_validate"],
    ]);

    // 2. The human validates the first one.
    expect((await validate(app, alice.cookie, a)).status).toBe(200);
    expect(await statuses()).toEqual([
      [a, "ready"],
      [b, "to_validate"],
    ]);

    // 3. The human abandons the second one: it leaves the board.
    expect((await abandonStory(app, alice.cookie, b)).status).toBe(200);
    expect(await statuses()).toEqual([[a, "ready"]]);
    const [card] = await cardsOf(app, alice.cookie, projectId);
    expect(card).toMatchObject({
      ticketId,
      ticketTitle: "Exporter",
      iWant: "vouloir-1",
    });
  });
});
