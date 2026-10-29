// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tickets } from "./db/schema.ts";
import { snapshot, withStory } from "./test-decisions.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  historyText,
  listedTools,
  mcpRows,
  onlyEntry,
  type StoryStatus,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
} from "./test-mcp.ts";

// Slice 4.4 (decision 018 E, H): Claude rewrites a story the user sent back, with update_user_story.
//
// Pinned choices where decision 018 leaves room:
// - arguments: { story_id, as_a, i_want, so_that, notes_md?, criteria: [{ given, when, then }] } (the criteria are the
//   complete list, at least one), same limits as create_user_stories (017 B).
// - answer: { story: { id, status, ... }, criteria: [{ id, position, given, when, then }] }, the shape of get_user_story.
// - fixed refusal codes in history.detail.reason: not_found, wrong_status, ticket_abandoned, project_archived,
//   invalid_arguments; a refusal that found its story fills project_id, ticket_id and story_id.
// - the text of a wrong_status refusal names the current status and says that only to_rewrite stories can be rewritten.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withStory>>;
type Criterion = { given: string; when: string; then: string };

/** A valid call for `update_user_story`, numbered so that its texts are recognisable. */
const rewrite = (
  id: unknown,
  n = 1,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  story_id: id,
  as_a: `rôle-réécrit-${n}`,
  i_want: `vouloir-réécrit-${n}`,
  so_that: `but-réécrit-${n}`,
  notes_md: `notes-réécrites-${n}`,
  criteria: [
    { given: `donné-r-${n}a`, when: `quand-r-${n}a`, then: `alors-r-${n}a` },
    { given: `donné-r-${n}b`, when: `quand-r-${n}b`, then: `alors-r-${n}b` },
    { given: `donné-r-${n}c`, when: `quand-r-${n}c`, then: `alors-r-${n}c` },
  ],
  ...over,
});
const call = (ctx: Ctx, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, "update_user_story", args);

describe("criterion 6: update_user_story rewrites a to_rewrite story", () => {
  it("given a to_rewrite story with a comment and a dependency, when Claude rewrites it, then it is to_validate, the comment is cleared, the narrative and the whole criteria list are replaced, the dependency is kept and the answer gives the story and its criteria ids", async () => {
    const s = await withStory("to_rewrite", {
      rewriteComment: "Précise le cas vide",
    });
    const before = await snapshot(s.db, s.id);

    const data = dataOf<{
      story: { id: number; status: string };
      criteria: { id: number; position: number; given: string }[];
    }>(
      await call(
        s,
        rewrite(s.id, 1, {
          as_a: "  rôle-réécrit-1  ",
          notes_md: "  notes **neuves**\n",
        }),
      ),
    );

    const after = await snapshot(s.db, s.id);
    expect(after).toMatchObject({
      status: "to_validate",
      rewriteComment: null,
      asA: "rôle-réécrit-1",
      iWant: "vouloir-réécrit-1",
      soThat: "but-réécrit-1",
      // Decision 017 B: the notes are kept as typed.
      notesMd: "  notes **neuves**\n",
      dependsOn: before.dependsOn,
    });
    expect(
      after.criteria.map((c) => [c.position, c.given, c.when, c.then]),
    ).toEqual([
      [1, "donné-r-1a", "quand-r-1a", "alors-r-1a"],
      [2, "donné-r-1b", "quand-r-1b", "alors-r-1b"],
      [3, "donné-r-1c", "quand-r-1c", "alors-r-1c"],
    ]);
    const oldIds = before.criteria.map((c) => c.id);
    expect(after.criteria.some((c) => oldIds.includes(c.id))).toBe(false);
    expect(data.story).toMatchObject({ id: s.id, status: "to_validate" });
    expect(data.criteria.map((c) => [c.id, c.position])).toEqual(
      after.criteria.map((c) => [c.id, c.position]),
    );
  });

  it("given a rewrite, when it is made, then one entry: claude / mcp, the token, args { storyId }, the story, ticket and project columns, ok, no detail, and no text of the story anywhere in the history", async () => {
    const s = await withStory("to_rewrite", { rewriteComment: "Précise" });

    dataOf(await call(s, rewrite(s.id)));

    const entry = await onlyEntry(s.db);
    expect(entry).toMatchObject({
      user_id: s.alice.id,
      token_id: s.alice.tokenId,
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
      actor: "claude",
      origin: "mcp",
      action: "update_user_story",
      result: "ok",
      detail: null,
    });
    expect(entry.args).toEqual({ storyId: s.id });
    const text = await historyText(s.db);
    expect(text).not.toContain("réécrit");
    expect(text).not.toContain("donné-r");
    expect(text).not.toContain("Précise");
  });

  it("given a rewrite without notes_md, when it is made, then it succeeds (the notes are optional)", async () => {
    const s = await withStory("to_rewrite");
    const { notes_md: _left, ...args } = rewrite(s.id, 2);

    const data = dataOf<{ story: { status: string } }>(await call(s, args));

    expect(data.story.status).toBe("to_validate");
  });

  it("given a to_rewrite story with notes, when Claude rewrites it without notes_md, then the notes are unchanged (decision 018 E: absent notes are kept)", async () => {
    const s = await withStory("to_rewrite", { notesMd: "  notes à garder\n" });
    const { notes_md: _left, ...args } = rewrite(s.id, 5);

    const data = dataOf<{ story: { status: string } }>(await call(s, args));

    expect(data.story.status).toBe("to_validate");
    expect(await snapshot(s.db, s.id)).toMatchObject({
      asA: "rôle-réécrit-5",
      notesMd: "  notes à garder\n",
    });
  });

  it("given a to_rewrite story with notes, when Claude rewrites it with notes_md empty, then the notes are emptied", async () => {
    const s = await withStory("to_rewrite", { notesMd: "notes à effacer" });

    const data = dataOf<{ story: { status: string } }>(
      await call(s, rewrite(s.id, 6, { notes_md: "" })),
    );

    expect(data.story.status).toBe("to_validate");
    expect(await snapshot(s.db, s.id)).toMatchObject({
      asA: "rôle-réécrit-6",
      notesMd: "",
    });
  });

  it("given 20 criteria of 2000 characters, narrative of 1000 and notes of 50,000, when Claude rewrites a story, then it is accepted (the limits of 017 B are inclusive)", async () => {
    const s = await withStory("to_rewrite");
    const long = "x".repeat(2000);

    const data = dataOf<{ story: { status: string } }>(
      await call(
        s,
        rewrite(s.id, 3, {
          as_a: "a".repeat(1000),
          notes_md: "n".repeat(50_000),
          criteria: Array.from({ length: 20 }, () => ({
            given: long,
            when: long,
            then: long,
          })),
        }),
      ),
    );

    expect(data.story.status).toBe("to_validate");
  });

  it("given a rewritten story in a ticket, when the ticket is read, then the story counts as to_validate again (the rewrite goes back to the user)", async () => {
    const s = await withStory("to_rewrite");
    dataOf(await call(s, rewrite(s.id)));

    const ticketData = dataOf<{ stories: { id: number; status: string }[] }>(
      await callTool(s.app, s.alice.secret, "get_ticket", {
        ticket_id: s.ticketId,
      }),
    );

    expect(ticketData.stories.find((x) => x.id === s.id)?.status).toBe(
      "to_validate",
    );
  });
});

describe("criterion 6: update_user_story refuses what is not a story to rewrite", () => {
  it.each([
    "to_validate",
    "ready",
    "in_progress",
    "in_review",
    "done",
    "abandoned",
  ] as StoryStatus[])(
    "given a %s story, when Claude rewrites it, then Refused naming the current status and saying only to_rewrite stories can be rewritten; the story is untouched and the entry is refused wrong_status",
    async (status) => {
      const s = await withStory(status);
      const before = await snapshot(s.db, s.id);

      const text = expectRefused(await call(s, rewrite(s.id)));

      expect(text).toContain(status);
      expect(text).toContain("to_rewrite");
      expect(text).toMatch(/only/i);
      expect(await snapshot(s.db, s.id)).toEqual(before);
      const entry = await onlyEntry(s.db);
      expect(entry).toMatchObject({
        actor: "claude",
        origin: "mcp",
        action: "update_user_story",
        result: "refused",
        detail: { reason: "wrong_status" },
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
      });
      expect(entry.args).toEqual({ storyId: s.id });
      expect(await historyText(s.db)).not.toContain("réécrit");
    },
  );

  it("given a to_rewrite story of an abandoned ticket, when Claude rewrites it, then Refused abandoned and the story is untouched", async () => {
    const s = await withStory("to_rewrite");
    await s.db
      .update(tickets)
      .set({ abandonedAt: new Date() })
      .where(eq(tickets.id, s.ticketId));
    const before = await snapshot(s.db, s.id);

    const text = expectRefused(await call(s, rewrite(s.id)));

    expect(text).toMatch(/abandoned/i);
    expect(await snapshot(s.db, s.id)).toEqual(before);
    expect(await onlyEntry(s.db)).toMatchObject({
      result: "refused",
      detail: { reason: "ticket_abandoned" },
      ticket_id: s.ticketId,
      story_id: s.id,
    });
  });

  it("given a to_rewrite story of an archived project, when Claude rewrites it, then Refused archived and the story is untouched", async () => {
    const s = await withStory("to_rewrite");
    await archiveProject(s.db, s.projectId);
    const before = await snapshot(s.db, s.id);

    const text = expectRefused(await call(s, rewrite(s.id)));

    expect(text).toMatch(/archived/i);
    expect(await snapshot(s.db, s.id)).toEqual(before);
    expect(await onlyEntry(s.db)).toMatchObject({
      result: "refused",
      detail: { reason: "project_archived" },
      project_id: s.projectId,
      story_id: s.id,
    });
  });

  it("given another user's story and a story that does not exist, when Claude rewrites each, then both get the same Refused not found, the other story is untouched and nothing of it leaks", async () => {
    const s = await withStory("to_rewrite");
    const bob = await userWithToken(s.app, s.db, 2000);
    const bobsProject = await seedProject(s.db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });
    const bobsTicket = await seedTicket(s.db, bobsProject, "Idée de Bob");
    const bobsStory = await seedStory(s.db, bobsTicket, {
      status: "to_rewrite",
      iWant: "secret-de-Bob",
    });
    const bobBefore = await snapshot(s.db, bobsStory);

    const other = expectRefused(await call(s, rewrite(bobsStory)));
    const missing = expectRefused(await call(s, rewrite(987654)));

    expect(other).toMatch(/not found/i);
    expect(other.replace(String(bobsStory), "N")).toBe(
      missing.replace("987654", "N"),
    );
    expect(other).not.toContain("secret-de-Bob");
    expect(await snapshot(s.db, bobsStory)).toEqual(bobBefore);
    const refused = await mcpRows(s.db);
    expect(refused.map((e) => [e.result, e.detail])).toEqual([
      ["refused", { reason: "not_found" }],
      ["refused", { reason: "not_found" }],
    ]);
    expect(refused.every((e) => e.story_id === null)).toBe(true);
  });

  const one: Criterion = { given: "g", when: "w", then: "t" };
  it.each<[string, string, Record<string, unknown>]>([
    ["no criterion", "criteria", { criteria: [] }],
    ["no criteria key", "criteria", { criteria: undefined }],
    [
      "21 criteria",
      "criteria",
      { criteria: Array.from({ length: 21 }, () => one) },
    ],
    ["an empty then", "criteria", { criteria: [{ ...one, then: "  " }] }],
    ["an empty given", "criteria", { criteria: [{ ...one, given: "" }] }],
    [
      "a NUL in a criterion",
      "criteria",
      { criteria: [{ ...one, when: "a\u0000b" }] },
    ],
    ["an empty as_a", "as_a", { as_a: "" }],
    ["an i_want of spaces", "i_want", { i_want: " \n" }],
    ["no so_that", "so_that", { so_that: undefined }],
    ["an as_a of 1001 characters", "as_a", { as_a: "a".repeat(1001) }],
    [
      "notes of 50,001 characters",
      "notes_md",
      { notes_md: "n".repeat(50_001) },
    ],
    ["a story_id that is no id", "story_id", { story_id: 0 }],
  ])(
    "given %s, when Claude rewrites a story, then Refused invalid arguments naming %s, the story is untouched and the entry is refused invalid_arguments",
    async (_name, field, over) => {
      const s = await withStory("to_rewrite");
      const before = await snapshot(s.db, s.id);

      const text = expectRefused(await call(s, rewrite(s.id, 4, over)));

      expect(text).toMatch(/invalid arguments/i);
      expect(text).toContain(field);
      expect(await snapshot(s.db, s.id)).toEqual(before);
      expect(await onlyEntry(s.db)).toMatchObject({
        result: "refused",
        detail: { reason: "invalid_arguments" },
      });
      expect(await historyText(s.db)).not.toContain("réécrit");
    },
  );
});

describe("criterion 6: tools/list shows update_user_story", () => {
  it("given a valid token, when tools/list is posted, then update_user_story is listed with an English description and the arguments of decision 018 E", async () => {
    const s = await withStory("to_rewrite");

    const tools = await listedTools(s.app, s.alice.secret);

    const tool = tools.find((t) => t.name === "update_user_story");
    expect(tool, "update_user_story is listed").toBeDefined();
    expect(tool?.description?.trim().length).toBeGreaterThan(20);
    expect(tool?.description).not.toMatch(/[À-ÿ]/);
    expect(tool?.inputSchema?.type).toBe("object");
    expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual([
      "as_a",
      "criteria",
      "i_want",
      "notes_md",
      "so_that",
      "story_id",
    ]);
    expect(tool?.inputSchema?.required?.sort()).toEqual([
      "as_a",
      "criteria",
      "i_want",
      "so_that",
      "story_id",
    ]);
    // The description tells Claude the one case it works in.
    expect(tool?.description).toContain("to_rewrite");
  });
});
