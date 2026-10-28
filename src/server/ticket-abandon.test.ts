import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abandonTicket,
  bobsStory,
  entryCount,
  send,
  snapshot,
  statusesOf,
  ticketRow,
} from "./test-decisions.ts";
import {
  archiveProject,
  callTool,
  closeWriting,
  dataOf,
  rows,
  seedStory,
  seedTicket,
  withProject,
} from "./test-mcp.ts";

// Slice 4.4 (decision 018 D): the human abandons a whole ticket; its unfinished stories go with it, in one transaction.
// POST /api/tickets/:id/abandon -> 200 { ticket } (the ticket of GET /api/tickets/:id, its step is "abandoned").

afterEach(() => {
  vi.unstubAllGlobals();
});

type Listed = {
  tickets: { id: number }[];
  stories_to_rewrite: { id: number }[];
};
const listNeedingUs = async (ctx: Awaited<ReturnType<typeof withProject>>) =>
  dataOf<Listed>(
    await callTool(ctx.app, ctx.alice.secret, "list_tickets_needing_us", {}),
  );

/** A ticket with one story per unfinished status and a done one, next to another ticket that must not move. */
async function withBigTicket() {
  const ctx = await withProject();
  const { db, projectId } = ctx;
  const ticketId = await seedTicket(db, projectId, "À lâcher");
  for (const status of [
    "to_validate",
    "to_rewrite",
    "ready",
    "in_progress",
    "in_review",
    "done",
  ] as const)
    await seedStory(db, ticketId, { status });
  const otherId = await seedTicket(db, projectId, "Autre ticket");
  const otherStory = await seedStory(db, otherId, { status: "ready" });
  return { ...ctx, ticketId, otherId, otherStory };
}

describe("criterion 5: abandon a ticket", () => {
  it("given a ticket with stories in every unfinished status and a done one, when it is abandoned, then 200, abandoned_at is set, the unfinished stories are abandoned, the done one stays done, and one abandon_ticket entry holds { ticketId, abandonedStories: 5 }", async () => {
    const t = await withBigTicket();
    const otherBefore = await snapshot(t.db, t.otherStory);

    const res = await abandonTicket(t.app, t.alice.cookie, t.ticketId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: Record<string, unknown> };
    expect(body.ticket).toMatchObject({ id: t.ticketId, step: "abandoned" });
    expect((await ticketRow(t.db, t.ticketId)).abandonedAt).toBeInstanceOf(
      Date,
    );
    expect(await statusesOf(t.db, t.ticketId)).toEqual([
      "abandoned",
      "abandoned",
      "abandoned",
      "abandoned",
      "abandoned",
      "done",
    ]);
    expect((await ticketRow(t.db, t.otherId)).abandonedAt).toBeNull();
    expect(await snapshot(t.db, t.otherStory)).toEqual(otherBefore);
    const entries = await rows(t.db, sql`action = 'abandon_ticket'`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: t.alice.id,
      token_id: null,
      project_id: t.projectId,
      ticket_id: t.ticketId,
      story_id: null,
      actor: "human",
      origin: "ui",
      result: "ok",
      detail: null,
    });
    // Decision 018 H: ids and one number, nothing else.
    expect(entries[0]?.args).toEqual({
      ticketId: t.ticketId,
      abandonedStories: 5,
    });
    expect(await entryCount(t.db)).toBe(1);
  });

  it("given a ticket where a story is already abandoned, when it is abandoned, then every story that is not done ends abandoned and the done one stays done", async () => {
    const ctx = await withProject();
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "Mixte");
    await seedStory(ctx.db, ticketId, { status: "abandoned" });
    await seedStory(ctx.db, ticketId, { status: "ready" });
    await seedStory(ctx.db, ticketId, { status: "done" });

    const res = await abandonTicket(ctx.app, ctx.alice.cookie, ticketId);

    expect(res.status).toBe(200);
    expect(await statusesOf(ctx.db, ticketId)).toEqual([
      "abandoned",
      "abandoned",
      "done",
    ]);
  });

  it("given a ticket without stories, when it is abandoned, then 200, abandoned_at is set and the entry says abandonedStories 0", async () => {
    const ctx = await withProject();
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "Vide");

    const res = await abandonTicket(ctx.app, ctx.alice.cookie, ticketId);

    expect(res.status).toBe(200);
    expect((await ticketRow(ctx.db, ticketId)).abandonedAt).toBeInstanceOf(
      Date,
    );
    const entries = await rows(ctx.db, sql`action = 'abandon_ticket'`);
    expect(entries.map((e) => e.args)).toEqual([
      { ticketId, abandonedStories: 0 },
    ]);
  });

  it("given an abandoned ticket, when it is abandoned again, then 409 ticket_abandoned, nothing changes (same date, same stories) and one refused abandon_ticket entry is written", async () => {
    const t = await withBigTicket();
    expect(
      (await abandonTicket(t.app, t.alice.cookie, t.ticketId)).status,
    ).toBe(200);
    const abandonedAt = (await ticketRow(t.db, t.ticketId)).abandonedAt;
    const statuses = await statusesOf(t.db, t.ticketId);

    const res = await abandonTicket(t.app, t.alice.cookie, t.ticketId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ticket_abandoned" });
    expect((await ticketRow(t.db, t.ticketId)).abandonedAt).toEqual(
      abandonedAt,
    );
    expect(await statusesOf(t.db, t.ticketId)).toEqual(statuses);
    const entries = await rows(t.db, sql`action = 'abandon_ticket'`);
    expect(entries.map((e) => [e.result, e.detail])).toEqual([
      ["ok", null],
      ["refused", { reason: "ticket_abandoned" }],
    ]);
    expect(entries[1]).toMatchObject({
      project_id: t.projectId,
      ticket_id: t.ticketId,
    });
  });

  it("given a ticket of an archived project, when it is abandoned, then 409 project_archived, the ticket and its stories are untouched and one refused entry is written", async () => {
    const t = await withBigTicket();
    await archiveProject(t.db, t.projectId);
    const statuses = await statusesOf(t.db, t.ticketId);

    const res = await abandonTicket(t.app, t.alice.cookie, t.ticketId);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect((await ticketRow(t.db, t.ticketId)).abandonedAt).toBeNull();
    expect(await statusesOf(t.db, t.ticketId)).toEqual(statuses);
    const entries = await rows(t.db, sql`action = 'abandon_ticket'`);
    expect(entries.map((e) => [e.result, e.detail])).toEqual([
      ["refused", { reason: "project_archived" }],
    ]);
  });

  it("given no session, when a ticket is abandoned, then 401 and nothing changes", async () => {
    const t = await withBigTicket();

    const res = await abandonTicket(t.app, "", t.ticketId);

    expect(res.status).toBe(401);
    expect((await ticketRow(t.db, t.ticketId)).abandonedAt).toBeNull();
    expect(await entryCount(t.db)).toBe(0);
  });

  it("given my own ticket works, when another user's ticket, an unknown id and ids that are no id are abandoned, then every answer is 404, Bob's ticket and story are untouched and no entry is written", async () => {
    const t = await withBigTicket();
    const bob = await bobsStory(t);
    const bobBefore = await snapshot(t.db, bob.storyId);
    // Control: the route exists and works on my own ticket.
    expect((await abandonTicket(t.app, t.alice.cookie, t.otherId)).status).toBe(
      200,
    );
    const entriesBefore = await entryCount(t.db);

    for (const id of [String(bob.ticketId), "424242", "abc", "0", "-1"]) {
      const res = await abandonTicket(t.app, t.alice.cookie, id);
      expect(res.status, `id ${id}`).toBe(404);
    }

    expect((await ticketRow(t.db, bob.ticketId)).abandonedAt).toBeNull();
    expect(await snapshot(t.db, bob.storyId)).toEqual(bobBefore);
    expect(await entryCount(t.db)).toBe(entriesBefore);
  });

  it("given a ticket Claude must still write and a ticket with a story to rewrite, when they are abandoned, then list_tickets_needing_us no longer lists them nor the story", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const unwritten = await seedTicket(db, projectId, "À écrire");
    const rewriting = await seedTicket(db, projectId, "À réécrire");
    const story = await seedStory(db, rewriting, { status: "to_rewrite" });
    await closeWriting(db, rewriting);
    const before = await listNeedingUs(ctx);
    expect(before.tickets.map((t) => t.id)).toEqual([unwritten]);
    expect(before.stories_to_rewrite.map((s) => s.id)).toEqual([story]);

    expect(
      (await abandonTicket(ctx.app, ctx.alice.cookie, unwritten)).status,
    ).toBe(200);
    expect(
      (await abandonTicket(ctx.app, ctx.alice.cookie, rewriting)).status,
    ).toBe(200);

    const after = await listNeedingUs(ctx);
    expect(after.tickets).toEqual([]);
    expect(after.stories_to_rewrite).toEqual([]);
  });
});

describe("criterion 5: an abandoned ticket is not modified any more", () => {
  const patch = (
    ctx: Awaited<ReturnType<typeof withProject>>,
    id: number,
    body: unknown,
  ) => send(ctx.app, ctx.alice.cookie, "PATCH", `/api/tickets/${id}`, body);

  it("given an abandoned ticket, when its title is edited, then 409 ticket_abandoned, the title stays and one refused update_ticket entry is written (a ticket that is not abandoned is still edited)", async () => {
    const ctx = await withProject();
    const live = await seedTicket(ctx.db, ctx.projectId, "Vivant");
    const ticketId = await seedTicket(
      ctx.db,
      ctx.projectId,
      "Avant",
      "",
      new Date(),
    );
    expect((await patch(ctx, live, { title: "Vivant 2" })).status).toBe(200);

    const res = await patch(ctx, ticketId, { title: "Après" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ticket_abandoned" });
    expect((await ticketRow(ctx.db, ticketId)).title).toBe("Avant");
    const entries = await rows(
      ctx.db,
      sql`action = 'update_ticket' and ticket_id = ${ticketId}`,
    );
    expect(entries.map((e) => [e.result, e.detail])).toEqual([
      ["refused", { reason: "ticket_abandoned" }],
    ]);
  });
});
