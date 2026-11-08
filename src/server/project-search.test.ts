// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of a criterion (decision 017)
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { history, tickets, userStories } from "./db/schema.ts";
import {
  archiveProject,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 11.2, decision 055 C: GET /api/projects/:id/search?q=
//
// Pinned choices (the decision leaves them open):
// - Answer 200 { tickets: [{ id, title, step }], stories: [{ id, ticketId, title, status }] } and nothing else in the objects.
//   A story's `title` is its `i_want`; `status` is the code of the server (to_validate, ready...); `step` the computed step of the ticket (new, in_progress...).
// - `q` is used as typed (not trimmed): 1 to 100 characters, missing or empty or 101+ is a 400 { error: "Bad request" }.
// - Case-insensitive substring; `%` and `_` are literals (they match themselves only).
// - Tickets: title and description_md. Stories: as_a, i_want, so_that, notes_md and the given, when and then of their criteria.
//   A story found through its criteria is found once (no duplicate).
// - 50 of each at most, newest first (id descending).
// - Only members (404 for another user's project, 401 without session); an archived project is readable; a read writes no history entry.

const search = (
  app: Awaited<ReturnType<typeof withProject>>["app"],
  cookie: string | undefined,
  projectId: number | string,
  q?: string,
) =>
  app.request(
    `/api/projects/${projectId}/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
    cookie ? { headers: { cookie } } : {},
  );
type Found = {
  tickets: { id: number; title: string; step: string }[];
  stories: { id: number; ticketId: number; title: string; status: string }[];
};
const found = async (res: Response) => {
  expect(res.status).toBe(200);
  return (await res.json()) as Found;
};

describe("055 C: access", () => {
  it("given no session, when the search is called, then 401", async () => {
    const { app, projectId } = await withProject();

    expect((await search(app, undefined, projectId, "x")).status).toBe(401);
  });

  it("given a project of another user, when the search is called, then 404 and nothing of the project leaks", async () => {
    const { app, db, alice, projectId } = await withProject();
    const bob = await userWithToken(app, db, 2000);
    const bobProject = await seedProject(db, bob.id, {
      githubRepoId: 2,
      fullName: "user2000/app",
    });
    await seedTicket(db, bobProject, "Secret de Bob");

    const own = await search(app, alice.cookie, projectId, "secret");
    const res = await search(app, alice.cookie, bobProject, "secret");

    // The route exists for a member (not a 404 of a missing route), and says 404 for the stranger.
    expect(own.status).toBe(200);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Secret de Bob");
  });

  it("given an archived project, when the search is called, then it answers", async () => {
    const { app, db, alice, projectId } = await withProject();
    await seedTicket(db, projectId, "Ancienne idée");
    await archiveProject(db, projectId);

    const result = await found(
      await search(app, alice.cookie, projectId, "ancienne"),
    );

    expect(result.tickets.map((t) => t.title)).toEqual(["Ancienne idée"]);
  });

  it("given a read, when the search is called, then no history entry is written", async () => {
    const { app, db, alice, projectId } = await withProject();
    await seedTicket(db, projectId, "Une idée");
    const before = (await db.select().from(history)).length;

    await found(await search(app, alice.cookie, projectId, "idée"));
    await search(app, alice.cookie, projectId, "");

    expect((await db.select().from(history)).length).toBe(before);
  });
});

describe("055 C: the query", () => {
  it("given no q, an empty q or a q of 101 characters, when the search is called, then 400", async () => {
    const { app, alice, projectId } = await withProject();

    expect((await search(app, alice.cookie, projectId)).status).toBe(400);
    expect((await search(app, alice.cookie, projectId, "")).status).toBe(400);
    expect(
      (await search(app, alice.cookie, projectId, "x".repeat(101))).status,
    ).toBe(400);
  });

  it("given a q of 1 and one of 100 characters, when the search is called, then both answer 200", async () => {
    const { app, alice, projectId } = await withProject();

    expect((await search(app, alice.cookie, projectId, "x")).status).toBe(200);
    expect(
      (await search(app, alice.cookie, projectId, "x".repeat(100))).status,
    ).toBe(200);
  });

  it("given tickets, when q differs by case only, then they are found", async () => {
    const { app, db, alice, projectId } = await withProject();
    await seedTicket(db, projectId, "Exporter les FACTURES");

    const result = await found(
      await search(app, alice.cookie, projectId, "factures"),
    );
    const upper = await found(
      await search(app, alice.cookie, projectId, "EXPORTER"),
    );

    expect(result.tickets).toHaveLength(1);
    expect(upper.tickets).toHaveLength(1);
  });

  it("given the word facture, when q is facture, then factures is found (substring) but facturé is not", async () => {
    const { app, db, alice, projectId } = await withProject();
    await seedTicket(db, projectId, "Les factures");
    await seedTicket(db, projectId, "Un envoi facturé");

    const result = await found(
      await search(app, alice.cookie, projectId, "facture"),
    );

    expect(result.tickets.map((t) => t.title)).toEqual(["Les factures"]);
  });

  it("given titles with % and _, when q holds one, then it matches itself only", async () => {
    const { app, db, alice, projectId } = await withProject();
    await seedTicket(db, projectId, "Remise de 100% fiable");
    await seedTicket(db, projectId, "Remise de 100 pourcent");
    await seedTicket(db, projectId, "champ a_b");
    await seedTicket(db, projectId, "champ axb");

    const percent = await found(
      await search(app, alice.cookie, projectId, "100%"),
    );
    const underscore = await found(
      await search(app, alice.cookie, projectId, "a_b"),
    );
    const alone = await found(await search(app, alice.cookie, projectId, "%"));

    expect(percent.tickets.map((t) => t.title)).toEqual([
      "Remise de 100% fiable",
    ]);
    expect(underscore.tickets.map((t) => t.title)).toEqual(["champ a_b"]);
    expect(alone.tickets.map((t) => t.title)).toEqual([
      "Remise de 100% fiable",
    ]);
  });
});

describe("055 C: where it looks", () => {
  it.each([
    ["the title of a ticket", "title"],
    ["the description of a ticket", "description"],
  ])(
    "given a word in %s, when it is searched, then the ticket is found with { id, title, step } and no story",
    async (_name, where) => {
      const { app, db, alice, projectId } = await withProject();
      const id = await seedTicket(
        db,
        projectId,
        where === "title" ? "zebulon dans le titre" : "Un titre",
        where === "description" ? "du texte avec zebulon dedans" : "",
      );
      await seedTicket(db, projectId, "Sans rapport");

      const result = await found(
        await search(app, alice.cookie, projectId, "ZEBULON"),
      );

      expect(result.tickets).toEqual([
        {
          id,
          title: where === "title" ? "zebulon dans le titre" : "Un titre",
          step: "new",
        },
      ]);
      expect(result.stories).toEqual([]);
    },
  );

  it.each([
    ["asA", { asA: "un zebulon curieux" }],
    ["iWant", { iWant: "voir le zebulon" }],
    ["soThat", { soThat: "aimer le zebulon" }],
    ["notesMd", { notesMd: "note sur le zebulon" }],
    [
      "criterion given",
      { criteria: [{ given: "un zebulon", when: "w", then: "t" }] },
    ],
    [
      "criterion when",
      { criteria: [{ given: "g", when: "je zebulon", then: "t" }] },
    ],
    [
      "criterion then",
      { criteria: [{ given: "g", when: "w", then: "zebulon est là" }] },
    ],
  ])(
    "given a word in the %s of a story, when it is searched, then the story is found once as { id, ticketId, title: its i_want, status } and its ticket is not",
    async (_name, values) => {
      const { app, db, alice, projectId } = await withProject();
      const ticketId = await seedTicket(db, projectId, "Un ticket");
      const storyId = await seedStory(db, ticketId, {
        iWant: "faire une chose",
        status: "ready",
        ...values,
      });
      const [row] = await db
        .select({ iWant: userStories.iWant })
        .from(userStories)
        .where(sql`id = ${storyId}`);

      const result = await found(
        await search(app, alice.cookie, projectId, "zebulon"),
      );

      expect(result.tickets).toEqual([]);
      expect(result.stories).toEqual([
        { id: storyId, ticketId, title: row?.iWant, status: "ready" },
      ]);
    },
  );

  it("given a ticket and a story of another project holding the word, when it is searched, then they are not found", async () => {
    const { app, db, alice, projectId } = await withProject();
    const other = await seedProject(db, alice.id, {
      githubRepoId: 3,
      fullName: "user1000/autre",
    });
    const foreign = await seedTicket(db, other, "zebulon ailleurs");
    await seedStory(db, foreign, { iWant: "zebulon aussi" });

    const result = await found(
      await search(app, alice.cookie, projectId, "zebulon"),
    );

    expect(result).toEqual({ tickets: [], stories: [] });
  });
});

describe("055 C: how many and in which order", () => {
  it("given 55 tickets and 55 stories that match, when it is searched, then 50 of each come back, newest first", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticketIds: number[] = [];
    for (let i = 0; i < 55; i++)
      ticketIds.push(await seedTicket(db, projectId, `zebulon ${i}`));
    const [parent] = await db
      .insert(tickets)
      .values({ projectId, title: "Parent" })
      .returning({ id: tickets.id });
    const storyIds: number[] = [];
    for (let i = 0; i < 55; i++)
      storyIds.push(
        await seedStory(db, parent?.id ?? 0, { iWant: `zebulon ${i}` }),
      );

    const result = await found(
      await search(app, alice.cookie, projectId, "zebulon"),
    );

    expect(result.tickets.map((t) => t.id)).toEqual(
      ticketIds.slice(5).reverse(),
    );
    expect(result.stories.map((s) => s.id)).toEqual(
      storyIds.slice(5).reverse(),
    );
  });
});
