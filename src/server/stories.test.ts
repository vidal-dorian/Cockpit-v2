// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceCriteria,
  storyDependencies,
  userStories,
} from "./db/schema.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  historyText,
  listedTools,
  mcpRows,
  onlyEntry,
  type Row,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  shape,
  storyCounts,
  textOf,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 4.3 (decisions 004, 010, 016, 017): Claude writes the user stories through three MCP tools.
//
// Pinned choices where decision 017 leaves room:
// - create_user_stories arguments: { ticket_id, stories: [{ as_a, i_want, so_that, notes_md?, criteria: [{ given, when, then }], depends_on?: number[] }] }
//   (the list is called `stories`, the criteria `criteria`; depends_on holds positions of the same call, from 1).
// - create_user_stories answer: { ticket_id, step, stories: [{ id, position }] }.
// - list_tickets_needing_us arguments: { project_id? }; answer: { tickets: [...], stories_to_rewrite: [...] }.
// - get_user_story arguments: { story_id }; answer: { story, criteria, depends_on, ticket, project } (fields as in 017 G).
// - get_ticket answer: stories: [{ id, position, status, i_want }]; search answer: type "story" results.
// - fixed refusal codes in history.detail.reason: not_found, ticket_abandoned, ticket_has_stories, project_archived,
//   invalid_arguments.
// - history.args of a refused call that found its ticket: { ticketId }; of an invalid call: {} (as in 4.2).
// The tables are seeded with Drizzle (userStories, acceptanceCriteria, storyDependencies: decision 017 A) only to
// reach the statuses that nothing writes yet.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Criterion = { given: string; when: string; then: string };
type StoryArgs = {
  as_a: string;
  i_want: string;
  so_that: string;
  notes_md?: string;
  criteria: Criterion[];
  depends_on?: number[];
};

/** A valid story for `create_user_stories`, numbered so that its texts are recognisable. */
const storyArgs = (n: number, over: Partial<StoryArgs> = {}): StoryArgs => ({
  as_a: `rôle-${n}`,
  i_want: `vouloir-${n}`,
  so_that: `but-${n}`,
  criteria: [{ given: `donné-${n}`, when: `quand-${n}`, then: `alors-${n}` }],
  ...over,
});

type Created = {
  ticket_id: number;
  step: string;
  stories: { id: number; position: number }[];
};

type Ctx = Awaited<ReturnType<typeof withProject>>;
const createStories = (ctx: Ctx, ticketId: unknown, stories: unknown) =>
  callTool(ctx.app, ctx.alice.secret, "create_user_stories", {
    ticket_id: ticketId,
    stories,
  });

describe("criterion 1: create_user_stories writes the stories of a ticket", () => {
  it("given a ticket without stories, when Claude sends two stories, the second depending on the first, then both exist in order as to_validate with their criteria and the dependency, the answer gives ids and step, and one history entry holds only ids", async () => {
    const ctx = await withProject();
    const { db, alice, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Idée", "à découper");

    const data = dataOf<Created>(
      await createStories(ctx, ticketId, [
        storyArgs(1, {
          as_a: "  rôle-1  ",
          notes_md: "  notes **gras**\n",
          criteria: [
            { given: "donné-1a", when: "quand-1a", then: "alors-1a" },
            { given: "donné-1b", when: "quand-1b", then: "alors-1b" },
          ],
        }),
        storyArgs(2, { depends_on: [1] }),
      ]),
    );

    const stored = await db
      .select()
      .from(userStories)
      .where(eq(userStories.ticketId, ticketId))
      .orderBy(asc(userStories.position));
    expect(
      stored.map((s) => [s.position, s.status, s.asA, s.iWant, s.soThat]),
    ).toEqual([
      [1, "to_validate", "rôle-1", "vouloir-1", "but-1"],
      [2, "to_validate", "rôle-2", "vouloir-2", "but-2"],
    ]);
    // Notes are kept as typed (decision 017 B).
    expect(stored[0]?.notesMd).toBe("  notes **gras**\n");
    const [first, second] = stored;
    const criteria = await db
      .select()
      .from(acceptanceCriteria)
      .orderBy(
        asc(acceptanceCriteria.storyId),
        asc(acceptanceCriteria.position),
      );
    expect(
      criteria.map((c) => [
        c.storyId,
        c.position,
        c.givenText,
        c.whenText,
        c.thenText,
      ]),
    ).toEqual([
      [first?.id, 1, "donné-1a", "quand-1a", "alors-1a"],
      [first?.id, 2, "donné-1b", "quand-1b", "alors-1b"],
      [second?.id, 1, "donné-2", "quand-2", "alors-2"],
    ]);
    expect(await db.select().from(storyDependencies)).toEqual([
      { storyId: second?.id, dependsOnId: first?.id },
    ]);
    expect(data).toMatchObject({ ticket_id: ticketId, step: "to_validate" });
    expect(data.stories).toEqual([
      { id: first?.id, position: 1 },
      { id: second?.id, position: 2 },
    ]);
    const entry = await onlyEntry(db);
    expect(shape(entry)).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: ticketId,
      actor: "claude",
      origin: "mcp",
      action: "create_user_stories",
      args: { ticketId, count: 2 },
      result: "ok",
      detail: null,
    });
    // Decision 017 "Limites connues": one call writes several stories, so the entry has no story_id.
    expect(entry.story_id).toBeNull();
    const text = await historyText(db);
    for (const secret of [
      "rôle-1",
      "vouloir-1",
      "but-2",
      "donné-1a",
      "alors-2",
      "gras",
    ])
      expect(text).not.toContain(secret);
  });

  it("given a ticket written by Claude, when the UI reads it, then its step is À valider (to_validate) and the ticket list says so", async () => {
    const ctx = await withProject();
    const { app, db, alice, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Idée");
    dataOf(await createStories(ctx, ticketId, [storyArgs(1)]));

    const res = await app.request(`/api/projects/${projectId}/tickets`, {
      headers: { cookie: alice.cookie },
    });

    const { tickets: listed } = (await res.json()) as {
      tickets: { id: number; step: string }[];
    };
    expect(listed.find((t) => t.id === ticketId)?.step).toBe("to_validate");
  });

  it("given the limits of decision 017 B, when stories at the maximum are sent, then they are accepted (20 stories in a chain, 20 criteria, texts of 1000 / 2000 / 50,000 characters)", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const chain = await seedTicket(db, projectId, "Vingt US");
    const criteria20 = await seedTicket(db, projectId, "Vingt critères");
    const longTexts = await seedTicket(db, projectId, "Longs textes");

    dataOf(
      await createStories(
        ctx,
        chain,
        Array.from({ length: 20 }, (_, i) =>
          storyArgs(i + 1, i === 0 ? {} : { depends_on: [i] }),
        ),
      ),
    );
    dataOf(
      await createStories(ctx, criteria20, [
        storyArgs(1, {
          criteria: Array.from({ length: 20 }, (_, i) => ({
            given: `g${i}`,
            when: `w${i}`,
            then: `t${i}`,
          })),
        }),
      ]),
    );
    dataOf(
      await createStories(ctx, longTexts, [
        storyArgs(1, {
          as_a: "a".repeat(1000),
          i_want: "i".repeat(1000),
          so_that: "s".repeat(1000),
          notes_md: "n".repeat(50_000),
          criteria: [
            {
              given: "g".repeat(2000),
              when: "w".repeat(2000),
              then: "t".repeat(2000),
            },
          ],
        }),
      ]),
    );

    const counts = await storyCounts(db);
    expect(counts).toMatchObject({ stories: 22, dependencies: 19 });
  });
});

describe("criteria 2 and 3: invalid stories are refused, and nothing is created", () => {
  const cases: [string, string, (ticketId: number) => unknown][] = [
    [
      "a whitespace-only i_want",
      "i_want",
      () => [storyArgs(1, { i_want: "   \n" })],
    ],
    [
      "a story with criteria: []",
      "criteria",
      () => [storyArgs(1, { criteria: [] })],
    ],
    [
      "21 criteria",
      "criteria",
      () => [
        storyArgs(1, {
          criteria: Array.from({ length: 21 }, () => ({
            given: "g",
            when: "w",
            then: "t",
          })),
        }),
      ],
    ],
    [
      "a depends_on pointing to its own position",
      "depends_on",
      () => [storyArgs(1), storyArgs(2, { depends_on: [2] })],
    ],
    [
      "a depends_on on the first story pointing to itself",
      "depends_on",
      () => [storyArgs(1, { depends_on: [1] })],
    ],
    [
      "a depends_on pointing to a later position",
      "depends_on",
      () => [storyArgs(1), storyArgs(2, { depends_on: [3] }), storyArgs(3)],
    ],
    [
      "a depends_on of position 0 (positions start at 1)",
      "depends_on",
      () => [storyArgs(1), storyArgs(2, { depends_on: [0] })],
    ],
    [
      "a repeated position in depends_on",
      "depends_on",
      () => [storyArgs(1), storyArgs(2, { depends_on: [1, 1] })],
    ],
    ["zero stories", "stories", () => []],
    [
      "21 stories",
      "stories",
      () => Array.from({ length: 21 }, (_, i) => storyArgs(i + 1)),
    ],
    [
      "a NUL character in so_that",
      "so_that",
      () => [storyArgs(1, { so_that: "a\0b" })],
    ],
    [
      "a NUL character in a given",
      "given",
      () => [
        storyArgs(1, { criteria: [{ given: "a\0b", when: "w", then: "t" }] }),
      ],
    ],
    [
      "an as_a of 1001 characters",
      "as_a",
      () => [storyArgs(1, { as_a: "a".repeat(1001) })],
    ],
    [
      "a then of 2001 characters",
      "then",
      () => [
        storyArgs(1, {
          criteria: [{ given: "g", when: "w", then: "t".repeat(2001) }],
        }),
      ],
    ],
    [
      "notes_md of 50,001 characters",
      "notes_md",
      () => [storyArgs(1, { notes_md: "n".repeat(50_001) })],
    ],
  ];

  it.each(cases)(
    "given %s, when create_user_stories is called, then Refused naming %s, nothing is created and one invalid_arguments entry is left",
    async (_name, field, build) => {
      const ctx = await withProject();
      const { db, alice } = ctx;
      const ticketId = await seedTicket(db, ctx.projectId, "Idée");

      const text = expectRefused(
        await createStories(ctx, ticketId, build(ticketId)),
      );

      expect(text.startsWith("Refused: invalid arguments (")).toBe(true);
      expect(text).toContain(field);
      expect(await storyCounts(db)).toEqual({
        stories: 0,
        criteria: 0,
        dependencies: 0,
      });
      expect(shape(await onlyEntry(db))).toEqual({
        user_id: alice.id,
        token_id: alice.tokenId,
        project_id: null,
        ticket_id: null,
        actor: "claude",
        origin: "mcp",
        action: "create_user_stories",
        args: {},
        result: "refused",
        detail: { reason: "invalid_arguments" },
      });
    },
  );

  it("given no stories key and a ticket_id that is not an id, when create_user_stories is called, then Refused naming stories and ticket_id", async () => {
    const ctx = await withProject();

    const missing = expectRefused(
      await callTool(ctx.app, ctx.alice.secret, "create_user_stories", {
        ticket_id: 1,
      }),
    );
    const badId = expectRefused(await createStories(ctx, 0, [storyArgs(1)]));

    expect(missing).toContain("stories");
    expect(badId).toContain("ticket_id");
  });

  it("given a valid first story and an invalid second one, when create_user_stories is called, then neither is created (all or nothing)", async () => {
    const ctx = await withProject();
    const { db } = ctx;
    const ticketId = await seedTicket(db, ctx.projectId, "Idée");

    const text = expectRefused(
      await createStories(ctx, ticketId, [
        storyArgs(1),
        storyArgs(2, { so_that: "  " }),
      ]),
    );

    expect(text).toContain("so_that");
    expect(await storyCounts(db)).toEqual({
      stories: 0,
      criteria: 0,
      dependencies: 0,
    });
    // The ticket can still be written afterwards.
    dataOf(await createStories(ctx, ticketId, [storyArgs(1)]));
  });
});

describe("criterion 4: tickets that cannot be written", () => {
  it("given a ticket that already has stories, when create_user_stories is called again, then Refused (a ticket is written once), nothing new is created and the entry is ticket_has_stories", async () => {
    const ctx = await withProject();
    const { db, alice, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Idée");
    dataOf(await createStories(ctx, ticketId, [storyArgs(1)]));
    const before = await storyCounts(db);

    const text = expectRefused(
      await createStories(ctx, ticketId, [storyArgs(2), storyArgs(3)]),
    );

    expect(text).toMatch(/already/i);
    expect(await storyCounts(db)).toEqual(before);
    const entries = await mcpRows(db);
    expect(entries.map((e) => [e.action, e.result])).toEqual([
      ["create_user_stories", "ok"],
      ["create_user_stories", "refused"],
    ]);
    const refused = entries[1] as Row;
    expect(refused).toMatchObject({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: ticketId,
      detail: { reason: "ticket_has_stories" },
    });
    expect(refused.args).toMatchObject({ ticketId });
  });

  it("given a ticket whose stories were seeded in any status, when create_user_stories is called, then Refused ticket_has_stories too (one story is enough)", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Idée");
    await seedStory(db, ticketId, { status: "abandoned" });

    expectRefused(await createStories(ctx, ticketId, [storyArgs(1)]));

    expect((await onlyEntry(db)).detail).toEqual({
      reason: "ticket_has_stories",
    });
    expect((await storyCounts(db)).stories).toBe(1);
  });

  it("given an abandoned ticket, when create_user_stories is called, then Refused abandoned and nothing is created", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Laissée", "", new Date());

    const text = expectRefused(
      await createStories(ctx, ticketId, [storyArgs(1)]),
    );

    expect(text).toMatch(/abandoned/i);
    expect((await storyCounts(db)).stories).toBe(0);
    expect(await onlyEntry(db)).toMatchObject({
      result: "refused",
      project_id: projectId,
      ticket_id: ticketId,
      detail: { reason: "ticket_abandoned" },
    });
  });

  it("given a ticket of an archived project, when create_user_stories is called, then Refused archived and nothing is created", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Figée");
    await archiveProject(db, projectId);

    const text = expectRefused(
      await createStories(ctx, ticketId, [storyArgs(1)]),
    );

    expect(text).toMatch(/archived/i);
    expect((await storyCounts(db)).stories).toBe(0);
    expect(await onlyEntry(db)).toMatchObject({
      result: "refused",
      project_id: projectId,
      ticket_id: ticketId,
      detail: { reason: "project_archived" },
    });
  });

  it("given another user's ticket and a ticket that does not exist, when create_user_stories is called on each, then both get the same Refused not found, nothing is created and the story text is not journaled", async () => {
    const ctx = await withProject();
    const { app, db } = ctx;
    const bob = await userWithToken(app, db, 2000);
    const bobsProject = await seedProject(db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });
    const bobsTicket = await seedTicket(db, bobsProject, "Idée-privée-de-Bob");

    const other = expectRefused(
      await createStories(ctx, bobsTicket, [storyArgs(1)]),
    );
    const missing = expectRefused(
      await createStories(ctx, 987654, [storyArgs(1)]),
    );

    expect(other).toMatch(/not found/i);
    expect(other.replace(String(bobsTicket), "N")).toBe(
      missing.replace("987654", "N"),
    );
    expect(other).not.toContain("Idée-privée");
    expect((await storyCounts(db)).stories).toBe(0);
    const entries = await mcpRows(db);
    expect(entries.map((e) => [e.result, e.detail])).toEqual([
      ["refused", { reason: "not_found" }],
      ["refused", { reason: "not_found" }],
    ]);
    expect(entries.every((e) => e.ticket_id === null)).toBe(true);
    expect(await historyText(db)).not.toContain("vouloir-1");
  });
});

// PGlite runs transactions one after the other, so this test checks the outcome, not the lock: the FOR UPDATE was checked by hand on a real PostgreSQL.
describe("criterion 5: two simultaneous create_user_stories on the same ticket", () => {
  it("given one ticket, when two batches are sent at the same time, then exactly one is created and the other is refused", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Course");

    const results = await Promise.all([
      createStories(ctx, ticketId, [storyArgs(1), storyArgs(2)]),
      createStories(ctx, ticketId, [storyArgs(3), storyArgs(4)]),
    ]);

    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    const refused = results.filter((r) => r.isError);
    expect(refused).toHaveLength(1);
    expect(textOf(refused[0] as (typeof results)[number])).toMatch(
      /^Refused: /,
    );
    const stored = await db
      .select()
      .from(userStories)
      .where(eq(userStories.ticketId, ticketId))
      .orderBy(asc(userStories.position));
    expect(stored.map((s) => s.position)).toEqual([1, 2]);
    // Both stories come from the same batch: 1+2 or 3+4, never one of each.
    const wants = stored.map((s) => s.iWant);
    expect([
      ["vouloir-1", "vouloir-2"],
      ["vouloir-3", "vouloir-4"],
    ]).toContainEqual(wants);
    const entries = await rows(db);
    expect(
      entries
        .filter((e) => e.action === "create_user_stories")
        .map((e) => e.result)
        .sort(),
    ).toEqual(["ok", "refused"]);
  });
});

describe("criterion 6: list_tickets_needing_us", () => {
  type Listed = {
    tickets: Record<string, unknown>[];
    stories_to_rewrite: Record<string, unknown>[];
  };
  const list = async (ctx: Ctx, args: unknown = {}) =>
    dataOf<Listed>(
      await callTool(
        ctx.app,
        ctx.alice.secret,
        "list_tickets_needing_us",
        args,
      ),
    );

  /** Alice: two active projects and an archived one; Bob: a project. */
  async function world() {
    const ctx = await withProject();
    const { app, db, alice, projectId } = ctx;
    const second = await seedProject(db, alice.id, {
      githubRepoId: 2,
      fullName: "user1000/site",
    });
    const archived = await seedProject(db, alice.id, {
      githubRepoId: 3,
      fullName: "user1000/old",
      archivedAt: new Date(),
    });
    const bob = await userWithToken(app, db, 2000);
    const bobs = await seedProject(db, bob.id, {
      githubRepoId: 4,
      fullName: "user2000/secret",
    });
    const t = {
      needsA: await seedTicket(db, projectId, "Sans US A", "description-A"),
      written: await seedTicket(db, projectId, "Déjà écrit"),
      abandoned: await seedTicket(db, projectId, "Abandonné", "", new Date()),
      rewrite: await seedTicket(db, projectId, "À réécrire"),
      needsB: await seedTicket(db, second, "Sans US B", "description-B"),
      archived: await seedTicket(db, archived, "Archivé"),
      bobs: await seedTicket(db, bobs, "Secret de Bob"),
      abandonedRewrite: await seedTicket(
        db,
        projectId,
        "Abandonné réécrit",
        "",
        new Date(),
      ),
    };
    await seedStory(db, t.written, { status: "to_validate" });
    const rewrite = await seedStory(db, t.rewrite, {
      status: "to_rewrite",
      asA: "lectrice",
      iWant: "relire",
      soThat: "corriger",
      rewriteComment: "Précise le cas vide",
    });
    await seedStory(db, t.rewrite, { status: "ready" });
    await seedStory(db, t.archived, { status: "to_rewrite" });
    await seedStory(db, t.bobs, { status: "to_rewrite" });
    await seedStory(db, t.abandonedRewrite, { status: "to_rewrite" });
    return { ...ctx, second, archived, bobs, bob, t, rewrite };
  }

  it("given tickets with and without stories, abandoned ones and other projects, when list_tickets_needing_us is called, then tickets lists only the ones without stories of my active projects and stories_to_rewrite the to_rewrite stories of the others, with their fields", async () => {
    const w = await world();

    const data = await list(w);

    expect(data.tickets).toEqual([
      {
        id: w.t.needsA,
        project_id: w.projectId,
        project: "user1000/app",
        title: "Sans US A",
        description_md: "description-A",
      },
      {
        id: w.t.needsB,
        project_id: w.second,
        project: "user1000/site",
        title: "Sans US B",
        description_md: "description-B",
      },
    ]);
    expect(data.stories_to_rewrite).toEqual([
      {
        id: w.rewrite,
        ticket_id: w.t.rewrite,
        project_id: w.projectId,
        as_a: "lectrice",
        i_want: "relire",
        so_that: "corriger",
        rewrite_comment: "Précise le cas vide",
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("Secret de Bob");
  });

  it("given a project_id, when list_tickets_needing_us is called, then only that project's items come back and the entry holds { projectId }", async () => {
    const w = await world();

    const data = await list(w, { project_id: w.second });

    expect(data.tickets.map((t) => t.id)).toEqual([w.t.needsB]);
    expect(data.stories_to_rewrite).toEqual([]);
    expect(shape(await onlyEntry(w.db))).toEqual({
      user_id: w.alice.id,
      token_id: w.alice.tokenId,
      project_id: w.second,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "list_tickets_needing_us",
      args: { projectId: w.second },
      result: "ok",
      detail: null,
    });
  });

  it("given no project_id, when list_tickets_needing_us is called, then the entry has args {} and no ticket text", async () => {
    const w = await world();
    const before = (await mcpRows(w.db)).length;

    await list(w);

    const added = (await mcpRows(w.db)).slice(before);
    expect(added.map(shape)).toEqual([
      {
        user_id: w.alice.id,
        token_id: w.alice.tokenId,
        project_id: null,
        ticket_id: null,
        actor: "claude",
        origin: "mcp",
        action: "list_tickets_needing_us",
        args: {},
        result: "ok",
        detail: null,
      },
    ]);
    const text = await historyText(w.db);
    expect(text).not.toContain("description-A");
    expect(text).not.toContain("Précise le cas vide");
  });

  it("given another user's project_id, when list_tickets_needing_us is called, then Refused not found", async () => {
    const w = await world();

    const text = expectRefused(
      await callTool(w.app, w.alice.secret, "list_tickets_needing_us", {
        project_id: w.bobs,
      }),
    );

    expect(text).toMatch(/not found/i);
    expect(text).not.toContain("Secret de Bob");
    expect(await onlyEntry(w.db)).toMatchObject({
      result: "refused",
      detail: { reason: "not_found" },
    });
  });

  it("given 25 tickets without stories and 25 stories to rewrite, when list_tickets_needing_us is called, then each list has the 20 oldest first, and a written ticket leaves the list", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ids: number[] = [];
    for (let i = 0; i < 25; i++)
      ids.push(await seedTicket(db, projectId, `idée ${i}`));
    const rewriteTicket = await seedTicket(
      db,
      projectId,
      "Beaucoup à réécrire",
    );
    const rewriteIds: number[] = [];
    for (let i = 0; i < 25; i++)
      rewriteIds.push(
        await seedStory(db, rewriteTicket, {
          status: "to_rewrite",
          rewriteComment: `commentaire ${i}`,
        }),
      );

    const first = await list(ctx);

    expect(first.tickets.map((t) => t.id)).toEqual(ids.slice(0, 20));
    expect(first.stories_to_rewrite.map((s) => s.id)).toEqual(
      rewriteIds.slice(0, 20),
    );
    dataOf(await createStories(ctx, ids[0], [storyArgs(1)]));
    const second = await list(ctx);
    expect(second.tickets.map((t) => t.id)).toEqual(ids.slice(1, 21));
  });

  it("given nothing to write, when list_tickets_needing_us is called, then two empty lists, not a refusal", async () => {
    const ctx = await withProject();

    expect(await list(ctx)).toEqual({ tickets: [], stories_to_rewrite: [] });
  });
});

describe("criterion 7: get_user_story", () => {
  /** A story with two criteria, depending on a ready story, in Alice's project. */
  async function withStory() {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Le ticket");
    const base = await seedStory(db, ticketId, {
      status: "ready",
      iWant: "la base",
    });
    const id = await seedStory(db, ticketId, {
      status: "to_rewrite",
      asA: "lectrice",
      iWant: "relire",
      soThat: "corriger",
      notesMd: "des **notes**",
      rewriteComment: "Précise le cas vide",
      criteria: [
        { given: "g1", when: "w1", then: "t1" },
        { given: "g2", when: "w2", then: "t2" },
      ],
      dependsOn: [base],
    });
    return { ...ctx, ticketId, base, id };
  }
  const read = (ctx: Ctx, storyId: unknown) =>
    callTool(ctx.app, ctx.alice.secret, "get_user_story", {
      story_id: storyId,
    });

  it("given a story with criteria and a dependency, when get_user_story is called, then it returns the story, its criteria in order, its dependencies, its ticket and its project, and one entry holds { storyId } and the story_id column", async () => {
    const s = await withStory();
    const stored = await s.db
      .select()
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.storyId, s.id))
      .orderBy(asc(acceptanceCriteria.position));

    const data = dataOf<Record<string, unknown>>(await read(s, s.id));

    expect(data).toEqual({
      story: {
        id: s.id,
        position: 2,
        as_a: "lectrice",
        i_want: "relire",
        so_that: "corriger",
        notes_md: "des **notes**",
        status: "to_rewrite",
        rewrite_comment: "Précise le cas vide",
      },
      criteria: [
        { id: stored[0]?.id, position: 1, given: "g1", when: "w1", then: "t1" },
        { id: stored[1]?.id, position: 2, given: "g2", when: "w2", then: "t2" },
      ],
      depends_on: [{ id: s.base, status: "ready", i_want: "la base" }],
      ticket: { id: s.ticketId, title: "Le ticket" },
      project: {
        id: s.projectId,
        full_name: "user1000/app",
        default_branch: "main",
        archived: false,
      },
    });
    const entry = await onlyEntry(s.db);
    expect(entry).toMatchObject({
      user_id: s.alice.id,
      token_id: s.alice.tokenId,
      actor: "claude",
      origin: "mcp",
      action: "get_user_story",
      args: { storyId: s.id },
      result: "ok",
      detail: null,
      story_id: s.id,
    });
    expect(await historyText(s.db)).not.toContain("relire");
  });

  it("given a story without dependency, when get_user_story is called, then depends_on is an empty list", async () => {
    const s = await withStory();

    const data = dataOf<{ depends_on: unknown[] }>(await read(s, s.base));

    expect(data.depends_on).toEqual([]);
  });

  it("given a story of an archived project, when get_user_story is called, then it is still readable and the project says archived", async () => {
    const s = await withStory();
    await archiveProject(s.db, s.projectId);

    const data = dataOf<{
      story: { id: number };
      project: { archived: boolean };
    }>(await read(s, s.id));

    expect(data.story.id).toBe(s.id);
    expect(data.project.archived).toBe(true);
  });

  it("given another user's story and a story that does not exist, when get_user_story is called on each, then both get the same Refused not found and nothing of the story leaks", async () => {
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

    const other = expectRefused(await read(s, bobsStory));
    const missing = expectRefused(await read(s, 987654));

    expect(other).toMatch(/not found/i);
    expect(other.replace(String(bobsStory), "N")).toBe(
      missing.replace("987654", "N"),
    );
    expect(other).not.toContain("secret-de-Bob");
    const refused = (await mcpRows(s.db)).filter((e) => e.result === "refused");
    expect(refused.map((e) => [e.args, e.detail])).toEqual([
      [{ storyId: bobsStory }, { reason: "not_found" }],
      [{ storyId: 987654 }, { reason: "not_found" }],
    ]);
    expect(refused.every((e) => e.story_id === null)).toBe(true);
  });

  it("given a story_id that is not an id, when get_user_story is called, then Refused naming story_id", async () => {
    const s = await withStory();

    const text = expectRefused(await read(s, 0));

    expect(text).toContain("story_id");
  });
});

describe("criterion 8: get_ticket and get_project show the stories and the computed step", () => {
  it("given a ticket with stories, when get_ticket is called, then it lists them { id, position, status, i_want } and the step is to_validate", async () => {
    const ctx = await withProject();
    const { db, alice, projectId } = ctx;
    const ticketId = await seedTicket(db, projectId, "Écrit");
    const a = await seedStory(db, ticketId, {
      status: "to_validate",
      iWant: "premier",
    });
    const b = await seedStory(db, ticketId, {
      status: "ready",
      iWant: "second",
    });

    const data = dataOf<Record<string, unknown>>(
      await callTool(ctx.app, alice.secret, "get_ticket", {
        ticket_id: ticketId,
      }),
    );

    expect(data).toMatchObject({
      id: ticketId,
      step: "to_validate",
      stories: [
        { id: a, position: 1, status: "to_validate", i_want: "premier" },
        { id: b, position: 2, status: "ready", i_want: "second" },
      ],
    });
  });

  it("given tickets in several states, when get_project is called, then each ticket shows its computed step", async () => {
    const ctx = await withProject({ files: { "CLAUDE.md": "# x" } });
    const { db, alice, projectId } = ctx;
    const fresh = await seedTicket(db, projectId, "Neuf");
    const toValidate = await seedTicket(db, projectId, "À valider");
    await seedStory(db, toValidate, { status: "to_validate" });
    const validated = await seedTicket(db, projectId, "Validé");
    await seedStory(db, validated, { status: "ready" });
    const inProgress = await seedTicket(db, projectId, "Entamé");
    await seedStory(db, inProgress, { status: "done" });
    await seedStory(db, inProgress, { status: "ready" });
    const done = await seedTicket(db, projectId, "Fini");
    await seedStory(db, done, { status: "done" });
    await seedStory(db, done, { status: "abandoned" });
    const allAbandoned = await seedTicket(db, projectId, "Tout lâché");
    await seedStory(db, allAbandoned, { status: "abandoned" });
    const abandonedTicket = await seedTicket(
      db,
      projectId,
      "Lâché",
      "",
      new Date(),
    );

    const data = dataOf<{ tickets: { id: number; step: string }[] }>(
      await callTool(ctx.app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    const stepOf = (id: number) => data.tickets.find((t) => t.id === id)?.step;
    expect([
      stepOf(fresh),
      stepOf(toValidate),
      stepOf(validated),
      stepOf(inProgress),
      stepOf(done),
      stepOf(allAbandoned),
      stepOf(abandonedTicket),
    ]).toEqual([
      "new",
      "to_validate",
      "validated",
      "in_progress",
      "done",
      "abandoned",
      "abandoned",
    ]);
  });
});

describe("criterion 9: search finds stories", () => {
  async function world() {
    const ctx = await withProject();
    const { app, db, alice, projectId } = ctx;
    const archived = await seedProject(db, alice.id, {
      githubRepoId: 12,
      fullName: "alice/archive",
      archivedAt: new Date(),
    });
    const other = await seedProject(db, alice.id, {
      githubRepoId: 13,
      fullName: "alice/autre",
    });
    const bob = await seedProject(db, (await userWithToken(app, db, 2000)).id, {
      githubRepoId: 14,
      fullName: "bob/projet",
    });
    const ticket = await seedTicket(db, projectId, "Un ticket");
    const otherTicket = await seedTicket(db, other, "Un autre ticket");
    const archivedTicket = await seedTicket(db, archived, "Archivé");
    const bobsTicket = await seedTicket(db, bob, "De Bob");
    const story = await seedStory(db, ticket, {
      status: "ready",
      asA: "contributrice",
      iWant: "exporter le journal",
      soThat: "garder une trace",
      notesMd: "uniquement-dans-les-notes",
    });
    const elsewhere = await seedStory(db, otherTicket, {
      asA: "contributrice",
      iWant: "exporter ailleurs",
      soThat: "garder une trace",
    });
    for (const t of [archivedTicket, bobsTicket])
      await seedStory(db, t, {
        asA: "contributrice",
        iWant: "exporter hors de portée",
        soThat: "garder une trace",
      });
    return { ...ctx, ticket, story, other, elsewhere };
  }
  const search = async (
    ctx: { app: Ctx["app"]; alice: { secret: string } },
    args: unknown,
  ) =>
    dataOf<{ results: Record<string, unknown>[] }>(
      await callTool(ctx.app, ctx.alice.secret, "search", args),
    ).results;

  it("given a word in as_a and another in so_that, when search is called in another case, then the story matches as { type: 'story', id, title: i_want, project_id, ticket_id, status }, and the stories of an archived project and of another user do not", async () => {
    const w = await world();

    const results = await search(w, { query: "CONTRIBUTRICE Trace journal" });

    expect(results).toEqual([
      {
        type: "story",
        id: w.story,
        title: "exporter le journal",
        project_id: w.projectId,
        ticket_id: w.ticket,
        status: "ready",
      },
    ]);
  });

  it("given a word that is in no story text (or only in the notes), when search is called, then the story does not match", async () => {
    const w = await world();

    expect(await search(w, { query: "contributrice inexistant" })).toEqual([]);
    expect(await search(w, { query: "uniquement-dans-les-notes" })).toEqual([]);
  });

  it("given a project_id, when search is called, then only the stories of that project come back", async () => {
    const w = await world();

    const results = await search(w, { query: "exporter", project_id: w.other });

    expect(results.map((r) => [r.type, r.id])).toEqual([
      ["story", w.elsewhere],
    ]);
  });

  it("given 25 matching stories, when search is called, then at most 20 results", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const ticket = await seedTicket(db, projectId, "Aiguille");
    for (let i = 0; i < 25; i++)
      await seedStory(db, ticket, { iWant: `aiguille numéro ${i}` });

    expect(await search(ctx, { query: "aiguille" })).toHaveLength(20);
  });

  it("given 15 matching tickets and 15 matching stories, when search is called, then the total stays at 20", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const holder = await seedTicket(db, projectId, "Porte les US");
    for (let i = 0; i < 14; i++)
      await seedTicket(db, projectId, `meule ticket ${i}`);
    for (let i = 0; i < 15; i++)
      await seedStory(db, holder, { iWant: `meule récit ${i}` });
    await seedTicket(db, projectId, "meule dernier");

    const results = await search(ctx, { query: "meule" });

    expect(results).toHaveLength(20);
    expect(results.some((r) => r.type === "story")).toBe(true);
    expect(results.some((r) => r.type === "ticket")).toBe(true);
  });
});

describe("criterion 10: tools/list", () => {
  it("given a valid token, when tools/list is posted, then the three new tools are listed with an English description and the arguments of decision 017", async () => {
    const { app, alice } = await withProject();

    const tools = await listedTools(app, alice.secret);

    const names = tools.map((t) => t.name);
    for (const name of [
      "create_user_stories",
      "get_user_story",
      "list_tickets_needing_us",
    ])
      expect(names).toContain(name);
    const byName = (name: string) => tools.find((t) => t.name === name);
    for (const name of [
      "create_user_stories",
      "get_user_story",
      "list_tickets_needing_us",
    ]) {
      const tool = byName(name);
      expect(tool?.description?.trim().length, name).toBeGreaterThan(20);
      expect(tool?.description, name).not.toMatch(/[À-ÿ]/);
      expect(tool?.inputSchema?.type, name).toBe("object");
    }
    const props = (name: string) =>
      Object.keys(byName(name)?.inputSchema?.properties ?? {}).sort();
    expect(props("create_user_stories")).toEqual(["stories", "ticket_id"]);
    expect(
      byName("create_user_stories")?.inputSchema?.required?.sort(),
    ).toEqual(["stories", "ticket_id"]);
    expect(props("get_user_story")).toEqual(["story_id"]);
    expect(byName("get_user_story")?.inputSchema?.required).toEqual([
      "story_id",
    ]);
    expect(props("list_tickets_needing_us")).toEqual(["project_id"]);
    expect(
      byName("list_tickets_needing_us")?.inputSchema?.required ?? [],
    ).toEqual([]);
  });
});
