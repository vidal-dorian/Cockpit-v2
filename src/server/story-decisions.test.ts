// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abandonStory,
  bobsStory,
  type Ctx,
  editBody,
  editStory,
  entryCount,
  send,
  sendBack,
  snapshot,
  validate,
  withStory,
} from "./test-decisions.ts";
import {
  archiveProject,
  historyText,
  rows,
  type StoryStatus,
} from "./test-mcp.ts";

// Slice 4.4 (decision 018 A to C, F, H): the four human actions on a user story, through the UI routes.
// The pinned shapes (bodies, answers, refusal codes) are listed at the top of test-decisions.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALL: StoryStatus[] = [
  "to_validate",
  "to_rewrite",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "abandoned",
];
const except = (...excluded: StoryStatus[]) =>
  ALL.filter((s) => !excluded.includes(s));

/** The entries of one action, in order. */
const entriesOf = (ctx: Ctx, action: string) =>
  rows(ctx.db, sql`action = ${action}`);

/** The refusal every wrong-status call must leave: one `refused` entry that found its story. */
async function expectRefusedEntry(
  ctx: Ctx & { id: number; ticketId: number },
  action: string,
  reason: string,
) {
  const entries = await entriesOf(ctx, action);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    user_id: ctx.alice.id,
    token_id: null,
    project_id: ctx.projectId,
    ticket_id: ctx.ticketId,
    story_id: ctx.id,
    actor: "human",
    origin: "ui",
    action,
    args: { storyId: ctx.id },
    result: "refused",
    detail: { reason },
  });
}

describe("criterion 1: validate a story", () => {
  it.each(["to_validate", "to_rewrite"] as const)(
    "given a %s story, when it is validated, then 200 with the story now ready, the rewrite comment cleared, and one validate_story entry (human, ui, args { storyId }, ids filled)",
    async (status) => {
      const s = await withStory(status, {
        rewriteComment: status === "to_rewrite" ? "Précise le cas vide" : null,
      });
      const before = await snapshot(s.db, s.id);

      const res = await validate(s.app, s.alice.cookie, s.id);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { story: Record<string, unknown> };
      expect(body.story).toMatchObject({ id: s.id, status: "ready" });
      const after = await snapshot(s.db, s.id);
      expect(after).toEqual({
        ...before,
        status: "ready",
        rewriteComment: null,
      });
      const entries = await entriesOf(s, "validate_story");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        user_id: s.alice.id,
        token_id: null,
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
        actor: "human",
        origin: "ui",
        result: "ok",
        detail: null,
      });
      expect(entries[0]?.args).toEqual({ storyId: s.id });
      expect(await entryCount(s.db)).toBe(1);
    },
  );

  it.each(except("to_validate", "to_rewrite"))(
    "given a %s story, when it is validated, then 409 wrong_status, nothing changes and one refused validate_story entry is written",
    async (status) => {
      const s = await withStory(status);
      const before = await snapshot(s.db, s.id);

      const res = await validate(s.app, s.alice.cookie, s.id);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "wrong_status" });
      expect(await snapshot(s.db, s.id)).toEqual(before);
      await expectRefusedEntry(s, "validate_story", "wrong_status");
    },
  );

  it("given a story of an archived project, when it is validated, then 409 project_archived, nothing changes and one refused entry is written", async () => {
    const s = await withStory("to_validate");
    await archiveProject(s.db, s.projectId);
    const before = await snapshot(s.db, s.id);

    const res = await validate(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    await expectRefusedEntry(s, "validate_story", "project_archived");
  });
});

describe("criterion 2: send a story back", () => {
  it("given a to_validate story, when it is sent back with a comment padded with spaces, then 200, the story is to_rewrite with the trimmed comment, and the entry holds only { storyId }", async () => {
    const s = await withStory("to_validate");
    const before = await snapshot(s.db, s.id);

    const res = await sendBack(s.app, s.alice.cookie, s.id, {
      comment: "  Précise-le-cas-vide-ZQX  \n",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { story: Record<string, unknown> };
    expect(body.story).toMatchObject({ id: s.id, status: "to_rewrite" });
    expect(await snapshot(s.db, s.id)).toEqual({
      ...before,
      status: "to_rewrite",
      rewriteComment: "Précise-le-cas-vide-ZQX",
    });
    const entries = await entriesOf(s, "send_back_story");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: s.alice.id,
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      detail: null,
    });
    expect(entries[0]?.args).toEqual({ storyId: s.id });
    // Decision 010 D: the comment lives in its table, never in the history.
    expect(await historyText(s.db)).not.toContain("ZQX");
  });

  it("given a comment of exactly 2000 characters, when the story is sent back, then 200 (the limit is inclusive)", async () => {
    const s = await withStory("to_validate");

    const res = await sendBack(s.app, s.alice.cookie, s.id, {
      comment: "c".repeat(2000),
    });

    expect(res.status).toBe(200);
  });

  it.each([
    ["no comment", {}],
    ["an empty comment", { comment: "" }],
    ["a comment of spaces only", { comment: "  \n\t " }],
    ["a comment that is not a string", { comment: 12 }],
    ["a comment of 2001 characters", { comment: "c".repeat(2001) }],
    ["a NUL character in the comment", { comment: "a\u0000b" }],
  ])(
    "given %s, when a story is sent back, then 400, the story is untouched and not even the history is written",
    async (_name, body) => {
      const s = await withStory("to_validate");
      const before = await snapshot(s.db, s.id);

      const res = await sendBack(s.app, s.alice.cookie, s.id, body);

      expect(res.status).toBe(400);
      expect(await snapshot(s.db, s.id)).toEqual(before);
      expect(await entryCount(s.db)).toBe(0);
    },
  );

  it("given a body that is not JSON, when a story is sent back, then 400 and nothing is written", async () => {
    const s = await withStory("to_validate");
    const before = await snapshot(s.db, s.id);

    const res = await s.app.request(`/api/stories/${s.id}/send-back`, {
      method: "POST",
      headers: { cookie: s.alice.cookie, "content-type": "application/json" },
      body: "{not json",
    });

    expect(res.status).toBe(400);
    expect(await snapshot(s.db, s.id)).toEqual(before);
    expect(await entryCount(s.db)).toBe(0);
  });

  it.each(except("to_validate"))(
    "given a %s story, when it is sent back, then 409 wrong_status, nothing changes, one refused entry is written and the comment is nowhere in the history",
    async (status) => {
      const s = await withStory(status);
      const before = await snapshot(s.db, s.id);

      const res = await sendBack(s.app, s.alice.cookie, s.id, {
        comment: "commentaire-ZQX",
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "wrong_status" });
      expect(await snapshot(s.db, s.id)).toEqual(before);
      await expectRefusedEntry(s, "send_back_story", "wrong_status");
      expect(await historyText(s.db)).not.toContain("ZQX");
    },
  );
});

describe("criterion 3: edit a story", () => {
  it.each(["to_validate", "to_rewrite", "ready"] as const)(
    "given a %s story, when its narrative, notes and criteria are edited, then 200, all are replaced (old criteria gone, new ones in order from position 1), the status and the dependencies are unchanged and the entry holds only { storyId }",
    async (status) => {
      const s = await withStory(status, {
        rewriteComment: status === "to_rewrite" ? "À préciser" : null,
      });
      const before = await snapshot(s.db, s.id);
      const body = editBody(1, {
        asA: "  rôle-modifié-1  ",
        iWant: "  vouloir-modifié-1  ",
        notesMd: "  notes **neuves**\n",
      });

      const res = await editStory(s.app, s.alice.cookie, s.id, body);

      expect(res.status).toBe(200);
      const answer = (await res.json()) as { story: Record<string, unknown> };
      expect(answer.story).toMatchObject({ id: s.id, status });
      const after = await snapshot(s.db, s.id);
      expect(after).toMatchObject({
        status,
        asA: "rôle-modifié-1",
        iWant: "vouloir-modifié-1",
        soThat: "but-modifié-1",
        // Decision 017 B: the notes are kept as typed.
        notesMd: "  notes **neuves**\n",
        dependsOn: before.dependsOn,
      });
      expect(
        after.criteria.map((c) => [c.position, c.given, c.when, c.then]),
      ).toEqual([
        [1, "donné-neuf-1a", "quand-neuf-1a", "alors-neuf-1a"],
        [2, "donné-neuf-1b", "quand-neuf-1b", "alors-neuf-1b"],
        [3, "donné-neuf-1c", "quand-neuf-1c", "alors-neuf-1c"],
      ]);
      const oldIds = before.criteria.map((c) => c.id);
      expect(after.criteria.some((c) => oldIds.includes(c.id))).toBe(false);
      const entries = await entriesOf(s, "update_story");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        user_id: s.alice.id,
        token_id: null,
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
        actor: "human",
        origin: "ui",
        result: "ok",
        detail: null,
      });
      expect(entries[0]?.args).toEqual({ storyId: s.id });
      const text = await historyText(s.db);
      expect(text).not.toContain("rôle-modifié");
      expect(text).not.toContain("neuves");
      expect(text).not.toContain("donné-neuf");
    },
  );

  it("given a story with three criteria, when it is edited down to one, then only that criterion remains, at position 1; the other stories are untouched", async () => {
    const s = await withStory("to_validate", {
      criteria: [
        { given: "g1", when: "w1", then: "t1" },
        { given: "g2", when: "w2", then: "t2" },
        { given: "g3", when: "w3", then: "t3" },
      ],
    });
    const baseBefore = await snapshot(s.db, s.base);

    const res = await editStory(
      s.app,
      s.alice.cookie,
      s.id,
      editBody(2, {
        criteria: [{ given: "seul-g", when: "seul-w", then: "seul-t" }],
      }),
    );

    expect(res.status).toBe(200);
    const after = await snapshot(s.db, s.id);
    expect(
      after.criteria.map((c) => [c.position, c.given, c.when, c.then]),
    ).toEqual([[1, "seul-g", "seul-w", "seul-t"]]);
    expect(await snapshot(s.db, s.base)).toEqual(baseBefore);
  });

  it("given a body without notesMd, when a story is edited, then 200 (the notes are optional)", async () => {
    const s = await withStory("to_validate");
    const { notesMd: _left, ...body } = editBody(3);

    const res = await editStory(s.app, s.alice.cookie, s.id, body);

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).asA).toBe("rôle-modifié-3");
  });

  it("given the limits of decision 017 B at their maximum, when a story is edited, then 200 (narrative 1000, 20 criteria of 2000, notes 50,000)", async () => {
    const s = await withStory("to_validate");
    const long = "x".repeat(2000);

    const res = await editStory(
      s.app,
      s.alice.cookie,
      s.id,
      editBody(4, {
        asA: "a".repeat(1000),
        iWant: "i".repeat(1000),
        soThat: "s".repeat(1000),
        notesMd: "n".repeat(50_000),
        criteria: Array.from({ length: 20 }, () => ({
          given: long,
          when: long,
          then: long,
        })),
      }),
    );

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).criteria).toHaveLength(20);
  });

  const one = { given: "g", when: "w", then: "t" };
  it.each([
    ["an empty as_a", editBody(5, { asA: "" })],
    ["an i_want of spaces only", editBody(5, { iWant: "  \n " })],
    ["no so_that", { ...editBody(5), soThat: undefined }],
    ["an as_a of 1001 characters", editBody(5, { asA: "a".repeat(1001) })],
    ["no criteria key", { ...editBody(5), criteria: undefined }],
    ["an empty list of criteria", editBody(5, { criteria: [] })],
    [
      "21 criteria",
      editBody(5, { criteria: Array.from({ length: 21 }, () => one) }),
    ],
    ["an empty then", editBody(5, { criteria: [{ ...one, then: " " }] })],
    ["an empty given", editBody(5, { criteria: [{ ...one, given: "" }] })],
    [
      "a criterion text of 2001 characters",
      editBody(5, { criteria: [{ ...one, when: "w".repeat(2001) }] }),
    ],
    [
      "notes of 50,001 characters",
      editBody(5, { notesMd: "n".repeat(50_001) }),
    ],
    ["a NUL character in the notes", editBody(5, { notesMd: "a\u0000b" })],
    [
      "a NUL character in a criterion",
      editBody(5, { criteria: [{ ...one, then: "a\u0000b" }] }),
    ],
    ["a NUL character in the narrative", editBody(5, { soThat: "a\u0000b" })],
    ["a narrative that is not a string", { ...editBody(5), asA: 12 }],
  ])(
    "given %s, when a story is edited, then 400, the story keeps its narrative, notes and criteria, and nothing is written to the history",
    async (_name, body) => {
      const s = await withStory("to_validate");
      const before = await snapshot(s.db, s.id);

      const res = await editStory(s.app, s.alice.cookie, s.id, body);

      expect(res.status).toBe(400);
      expect(await snapshot(s.db, s.id)).toEqual(before);
      expect(await entryCount(s.db)).toBe(0);
    },
  );

  it.each(except("to_validate", "to_rewrite", "ready"))(
    "given a %s story, when it is edited, then 409 wrong_status, nothing changes and one refused update_story entry is written",
    async (status) => {
      const s = await withStory(status);
      const before = await snapshot(s.db, s.id);

      const res = await editStory(s.app, s.alice.cookie, s.id, editBody(6));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "wrong_status" });
      expect(await snapshot(s.db, s.id)).toEqual(before);
      await expectRefusedEntry(s, "update_story", "wrong_status");
      expect(await historyText(s.db)).not.toContain("modifié");
    },
  );

  it("given a story of an archived project, when it is edited, then 409 project_archived, nothing changes and one refused entry is written", async () => {
    const s = await withStory("to_validate");
    await archiveProject(s.db, s.projectId);
    const before = await snapshot(s.db, s.id);

    const res = await editStory(s.app, s.alice.cookie, s.id, editBody(7));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    await expectRefusedEntry(s, "update_story", "project_archived");
  });
});

describe("criterion 4: abandon a story", () => {
  it.each(except("abandoned"))(
    "given a %s story, when it is abandoned, then 200 with the story abandoned and one abandon_story entry (human, ui, args { storyId }, ids filled)",
    async (status) => {
      const s = await withStory(status);
      const before = await snapshot(s.db, s.id);

      const res = await abandonStory(s.app, s.alice.cookie, s.id);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { story: Record<string, unknown> };
      expect(body.story).toMatchObject({ id: s.id, status: "abandoned" });
      expect(await snapshot(s.db, s.id)).toEqual({
        ...before,
        status: "abandoned",
      });
      const entries = await entriesOf(s, "abandon_story");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        user_id: s.alice.id,
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
        actor: "human",
        origin: "ui",
        result: "ok",
        detail: null,
      });
      expect(entries[0]?.args).toEqual({ storyId: s.id });
    },
  );

  it("given an abandoned story, when it is abandoned again, then 409 wrong_status, nothing changes and one refused entry is written", async () => {
    const s = await withStory("abandoned");
    const before = await snapshot(s.db, s.id);

    const res = await abandonStory(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wrong_status" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    await expectRefusedEntry(s, "abandon_story", "wrong_status");
  });

  it("given a story of an archived project, when it is abandoned, then 409 project_archived and nothing changes", async () => {
    const s = await withStory("to_validate");
    await archiveProject(s.db, s.projectId);
    const before = await snapshot(s.db, s.id);

    const res = await abandonStory(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    await expectRefusedEntry(s, "abandon_story", "project_archived");
  });

  it("given a ticket of two stories, when they are abandoned one after the other, then the step of the ticket is recomputed each time: validated (only the ready one is left), then abandoned (all abandoned)", async () => {
    const s = await withStory("to_validate");
    const stepOf = async () =>
      (
        (await (
          await send(s.app, s.alice.cookie, "GET", `/api/tickets/${s.ticketId}`)
        ).json()) as { ticket: { step: string } }
      ).ticket.step;
    // The base story is ready, the other one to_validate: the ticket is to be validated.
    expect(await stepOf()).toBe("to_validate");

    expect((await abandonStory(s.app, s.alice.cookie, s.id)).status).toBe(200);
    expect(await stepOf()).toBe("validated");

    expect((await abandonStory(s.app, s.alice.cookie, s.base)).status).toBe(
      200,
    );
    expect(await stepOf()).toBe("abandoned");
  });
});

describe("the gates of the four story routes (decision 018 A)", () => {
  // Each route with a call that works on an own to_validate story, to prove the route exists before it is refused.
  const routes: {
    name: string;
    action: string;
    call: (
      ctx: Ctx,
      cookie: string,
      id: number | string,
    ) => Response | Promise<Response>;
  }[] = [
    {
      name: "validate",
      action: "validate_story",
      call: (c, cookie, id) => validate(c.app, cookie, id),
    },
    {
      name: "send-back",
      action: "send_back_story",
      call: (c, cookie, id) => sendBack(c.app, cookie, id, { comment: "Non" }),
    },
    {
      name: "edit",
      action: "update_story",
      call: (c, cookie, id) => editStory(c.app, cookie, id, editBody(8)),
    },
    {
      name: "abandon",
      action: "abandon_story",
      call: (c, cookie, id) => abandonStory(c.app, cookie, id),
    },
  ];

  it.each(routes)(
    "given no session, when $name is called, then 401 and the story is untouched",
    async ({ call }) => {
      const s = await withStory("to_validate");
      const before = await snapshot(s.db, s.id);

      const res = await call(s, "", s.id);

      expect(res.status).toBe(401);
      expect(await snapshot(s.db, s.id)).toEqual(before);
      expect(await entryCount(s.db)).toBe(0);
    },
  );

  it.each(routes)(
    "given my own story works, when $name is called on another user's story, an unknown id and ids that are no id, then every answer is 404, nothing of Bob's story leaks, it is untouched and no entry is written",
    async ({ call }) => {
      const s = await withStory("to_validate");
      const bob = await bobsStory(s);
      const bobBefore = await snapshot(s.db, bob.storyId);
      // Control: the route exists and works on my own story (the entry it leaves is not counted below).
      expect((await call(s, s.alice.cookie, s.id)).status).toBe(200);
      const entriesBefore = await entryCount(s.db);

      for (const id of [
        String(bob.storyId),
        "424242",
        "abc",
        "0",
        "-1",
        "1.5",
      ]) {
        const res = await call(s, s.alice.cookie, id);
        expect(res.status, `id ${id}`).toBe(404);
        expect(JSON.stringify(await res.json())).not.toContain("secret-de-Bob");
      }

      expect(await snapshot(s.db, bob.storyId)).toEqual(bobBefore);
      expect(await entryCount(s.db)).toBe(entriesBefore);
    },
  );
});

// PGlite runs transactions one after the other, so these tests check the outcome, not the lock (decision 018 F): the FOR UPDATE is checked by hand on a real PostgreSQL.
describe("criterion 8: simultaneous decisions on the same story", () => {
  it("given a to_validate story, when a validation and a sending back arrive together, then exactly one succeeds, the other gets 409 wrong_status, and the story ends in the state of the winner", async () => {
    const s = await withStory("to_validate");

    const [validated, sentBack] = await Promise.all([
      validate(s.app, s.alice.cookie, s.id),
      sendBack(s.app, s.alice.cookie, s.id, { comment: "Précise" }),
    ]);

    expect([validated.status, sentBack.status].sort()).toEqual([200, 409]);
    const loser = validated.status === 409 ? validated : sentBack;
    expect(await loser.json()).toEqual({ error: "wrong_status" });
    const after = await snapshot(s.db, s.id);
    if (validated.status === 200)
      expect(after).toMatchObject({ status: "ready", rewriteComment: null });
    else
      expect(after).toMatchObject({
        status: "to_rewrite",
        rewriteComment: "Précise",
      });
    // The fixture's create_token entry is not part of the race.
    const results = (await rows(s.db, sql`action <> 'create_token'`)).map(
      (e) => [e.action, e.result],
    );
    expect(results).toHaveLength(2);
    expect(results.filter(([, result]) => result === "ok")).toHaveLength(1);
    expect(results.filter(([, result]) => result === "refused")).toHaveLength(
      1,
    );
  });

  it("given a to_validate story, when two validations arrive together, then exactly one succeeds and the other gets 409 wrong_status", async () => {
    const s = await withStory("to_validate");

    const answers = await Promise.all([
      validate(s.app, s.alice.cookie, s.id),
      validate(s.app, s.alice.cookie, s.id),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect((await snapshot(s.db, s.id)).status).toBe("ready");
  });

  it("given a to_validate story, when a sending back and an edit arrive together, then both succeed in turn (editing a to_rewrite story is allowed) and the story is to_rewrite with the edited text", async () => {
    const s = await withStory("to_validate");

    const [sentBack, edited] = await Promise.all([
      sendBack(s.app, s.alice.cookie, s.id, { comment: "Précise" }),
      editStory(s.app, s.alice.cookie, s.id, editBody(9)),
    ]);

    expect([sentBack.status, edited.status]).toEqual([200, 200]);
    expect(await snapshot(s.db, s.id)).toMatchObject({
      status: "to_rewrite",
      asA: "rôle-modifié-9",
    });
  });
});
