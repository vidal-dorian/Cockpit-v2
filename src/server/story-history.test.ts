import { afterEach, describe, expect, it, vi } from "vitest";
import { history } from "./db/schema.ts";
import {
  bobsStory,
  entryCount,
  storyHistory,
  withStory,
} from "./test-decisions.ts";
import { archiveProject, seedTicket, userWithToken } from "./test-mcp.ts";

// Slice 4.4 (decision 018 I): GET /api/stories/:id/history, the entries of the user about one story.
// The entries are inserted straight into the history, so this file depends on the new route only.
// Pinned: { entries: [{ at (ISO), action, result, actor }] }, newest first (like GET /api/history).

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withStory>>;
type Listed = {
  entries: { at: string; action: string; result: string; actor: string }[];
};

const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 10, minute));

/** Inserts an entry of the history: who, what, and the objects it is about. */
function note(
  ctx: Ctx,
  minute: number,
  action: string,
  over: Partial<typeof history.$inferInsert> = {},
) {
  const claude = over.actor === "claude" || over.origin === "mcp";
  return ctx.db.insert(history).values({
    at: at(minute),
    userId: ctx.alice.id,
    actor: claude ? "claude" : "human",
    origin: claude ? "mcp" : "ui",
    action,
    args: {},
    result: "ok",
    projectId: ctx.projectId,
    ...over,
  });
}

const read = async (ctx: Ctx, cookie = ctx.alice.cookie, id = ctx.id) => {
  const res = await storyHistory(ctx.app, cookie, id);
  expect(res.status).toBe(200);
  return ((await res.json()) as Listed).entries;
};

describe("criterion 9: the history of a story", () => {
  /** The entries of the story, of its ticket, of another story, of another ticket and of someone else. */
  async function seedHistory(ctx: Ctx) {
    const { id, ticketId } = ctx;
    const other = await seedTicket(ctx.db, ctx.projectId, "Autre ticket");
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    await note(ctx, 0, "create_user_stories", {
      origin: "mcp",
      ticketId,
      args: { ticketId, count: 2, moreToCome: false },
    });
    await note(ctx, 1, "get_user_story", {
      origin: "mcp",
      ticketId,
      storyId: id,
      args: { storyId: id },
    });
    await note(ctx, 2, "send_back_story", {
      ticketId,
      storyId: id,
      args: { storyId: id },
    });
    await note(ctx, 3, "update_user_story", {
      origin: "mcp",
      ticketId,
      storyId: id,
      args: { storyId: id },
    });
    await note(ctx, 4, "validate_story", {
      ticketId,
      storyId: id,
      args: { storyId: id },
      result: "refused",
      detail: { reason: "wrong_status" },
    });
    // Reads are not shown (decision 018 I), whatever ids they carry.
    for (const [minute, action] of [
      [5, "list_tickets_needing_us"],
      [6, "search"],
      [7, "get_ticket"],
      [8, "get_project"],
      [9, "list_projects"],
    ] as const)
      await note(ctx, minute, action, { origin: "mcp", ticketId });
    // Not about this story nor its ticket.
    await note(ctx, 10, "validate_story", {
      ticketId,
      storyId: ctx.base,
      args: { storyId: ctx.base },
    });
    await note(ctx, 11, "create_user_stories", {
      origin: "mcp",
      ticketId: other,
      args: { ticketId: other, count: 1, moreToCome: false },
    });
    await note(ctx, 12, "update_ticket", { ticketId, args: { ticketId } });
    await note(ctx, 13, "abandon_ticket", {
      ticketId: other,
      args: { ticketId: other, abandonedStories: 0 },
    });
    // Another user's entry about this very story (a membership that changed, a bug): never shown (decision 010 G).
    await note(ctx, 14, "validate_story", {
      userId: bob.id,
      ticketId,
      storyId: id,
      args: { storyId: id },
    });
    return { other };
  }

  it("given entries of every kind, when the history of the story is read, then it lists its own entries and the creation of its ticket, newest first, without reads, other stories, other tickets or other users", async () => {
    const ctx = await withStory("to_validate");
    await seedHistory(ctx);
    const before = await entryCount(ctx.db);

    const entries = await read(ctx);

    expect(entries.map((e) => [e.action, e.result, e.actor])).toEqual([
      ["validate_story", "refused", "human"],
      ["update_user_story", "ok", "claude"],
      ["send_back_story", "ok", "human"],
      ["create_user_stories", "ok", "claude"],
    ]);
    expect(entries.map((e) => Date.parse(e.at))).toEqual([
      at(4).getTime(),
      at(3).getTime(),
      at(2).getTime(),
      at(0).getTime(),
    ]);
    // Reading the history is a read: no entry of its own.
    expect(await entryCount(ctx.db)).toBe(before);
  });

  it("given the ticket was abandoned, when the history of the story is read, then the abandon_ticket entry of its ticket comes first, and the abandonment of another ticket is not shown", async () => {
    const ctx = await withStory("abandoned");
    await seedHistory(ctx);
    await note(ctx, 20, "abandon_ticket", {
      ticketId: ctx.ticketId,
      args: { ticketId: ctx.ticketId, abandonedStories: 1 },
    });

    const entries = await read(ctx);

    expect(entries.map((e) => e.action)).toEqual([
      "abandon_ticket",
      "validate_story",
      "update_user_story",
      "send_back_story",
      "create_user_stories",
    ]);
    expect(entries[0]).toMatchObject({ actor: "human", result: "ok" });
  });

  it("given entries of the story, when its history is read, then every entry carries a numeric id, distinct from the others, so that the page can key on it", async () => {
    const ctx = await withStory("to_validate");
    // Same date and same action twice: only the id tells them apart.
    for (const minute of [1, 1, 2])
      await note(ctx, minute, "send_back_story", {
        ticketId: ctx.ticketId,
        storyId: ctx.id,
        args: { storyId: ctx.id },
      });

    const res = await storyHistory(ctx.app, ctx.alice.cookie, ctx.id);

    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: { id?: unknown }[] };
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => typeof e.id === "number")).toBe(true);
    expect(new Set(entries.map((e) => e.id)).size).toBe(3);
  });

  it("given a story nothing happened to, when its history is read, then entries is an empty list", async () => {
    const ctx = await withStory("to_validate");

    const res = await storyHistory(ctx.app, ctx.alice.cookie, ctx.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("given a story of an archived project, when its history is read, then it is still readable", async () => {
    const ctx = await withStory("to_validate");
    await note(ctx, 1, "send_back_story", {
      ticketId: ctx.ticketId,
      storyId: ctx.id,
    });
    await archiveProject(ctx.db, ctx.projectId);

    const entries = await read(ctx);

    expect(entries.map((e) => e.action)).toEqual(["send_back_story"]);
  });

  it("given no session, when the history of a story is read, then 401", async () => {
    const ctx = await withStory("to_validate");

    const res = await storyHistory(ctx.app, "", ctx.id);

    expect(res.status).toBe(401);
  });

  it("given my own story works, when the history of another user's story, an unknown id and ids that are no id are read, then every answer is 404 and nothing of Bob leaks", async () => {
    const ctx = await withStory("to_validate");
    const bob = await bobsStory(ctx);
    await note(ctx, 1, "send_back_story", {
      userId: bob.bob.id,
      projectId: bob.project,
      ticketId: bob.ticketId,
      storyId: bob.storyId,
    });
    // Control: the route exists and answers for my own story.
    await read(ctx);

    for (const id of [String(bob.storyId), "424242", "abc", "0", "-1"]) {
      const res = await storyHistory(ctx.app, ctx.alice.cookie, id);
      expect(res.status, `id ${id}`).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("send_back");
    }
  });
});
