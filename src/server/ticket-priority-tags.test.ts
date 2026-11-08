import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { history, tickets } from "./db/schema.ts";
import { withProject } from "./test-mcp.ts";
import {
  type ApiTicket,
  getTicket,
  listTickets,
  makeTicket,
  patchTicket,
  postTicket,
} from "./test-tickets.ts";

// Slice 11.2, decision 055 A and B: the priority and the tags of a ticket.
//
// Pinned choices (the decision leaves them open):
// - Columns `tickets.priority` (text, default 'normal', CHECK in low | normal | high) and `tickets.tags` (text[], default '{}').
// - The routes answer `priority` and `tags` on every ticket they present (POST, PATCH, GET one, GET list).
// - Tags are normalised (trim, inner whitespace runs to one space, lowercase) BEFORE the length check: "  A  " is one valid character.
//   1 to 30 characters, no NUL, 10 at most. Duplicates after normalisation are COLLAPSED (first one kept, order kept), not refused.
// - Any invalid tag, a non-array `tags`, a non-string tag or an unknown `priority` is a 400 { error: "Bad request" } and nothing is written (no row change, no history entry).
// - PATCH: `priority` and `tags` are optional like `title`; `{ tags: [] }` clears the tags; a body with neither field of a ticket is still a 400.
// - The list is sorted high, normal, low, then newest first (id descending) inside a priority.
// - The history never keeps a tag: create_ticket and update_ticket keep args { ticketId }.

const ctxOf = async () => {
  const ctx = await withProject();
  return { ...ctx, cookie: ctx.alice.cookie };
};
const entries = (db: Awaited<ReturnType<typeof ctxOf>>["db"], action: string) =>
  db.select().from(history).where(eq(history.action, action));
const read = async (res: Response) =>
  ((await res.json()) as { ticket: ApiTicket }).ticket;

describe("055 A/B: create with priority and tags", () => {
  it("given a priority and tags, when the ticket is created, then the answer, GET one and the list give them back", async () => {
    const { app, cookie, projectId } = await ctxOf();

    const created = await makeTicket(app, cookie, projectId, {
      title: "Exporter",
      priority: "high",
      tags: ["export", "compta"],
    });

    expect(created).toMatchObject({
      priority: "high",
      tags: ["export", "compta"],
    });
    const one = await read(await getTicket(app, cookie, created.id));
    expect(one).toMatchObject({ priority: "high", tags: ["export", "compta"] });
    const list = (await (await listTickets(app, cookie, projectId)).json()) as {
      tickets: ApiTicket[];
    };
    expect(list.tickets[0]).toMatchObject({
      id: created.id,
      priority: "high",
      tags: ["export", "compta"],
    });
  });

  it("given neither priority nor tags, when the ticket is created, then it is normal and has no tag", async () => {
    const { app, cookie, projectId } = await ctxOf();

    const created = await makeTicket(app, cookie, projectId, { title: "Nu" });

    expect(created).toMatchObject({ priority: "normal", tags: [] });
    expect(await read(await getTicket(app, cookie, created.id))).toMatchObject({
      priority: "normal",
      tags: [],
    });
  });

  it("given tags with capitals, outer and inner spaces, when the ticket is created, then they are trimmed, inner spaces reduced to one and lowercased, in the order given", async () => {
    const { app, cookie, projectId } = await ctxOf();

    const created = await makeTicket(app, cookie, projectId, {
      title: "Normalisation",
      tags: ["  Export  ", "Compta   Mensuelle", "AUTH"],
    });

    expect(created.tags).toEqual(["export", "compta mensuelle", "auth"]);
  });

  it("given two tags that are the same after normalisation, when the ticket is created, then the duplicate is collapsed", async () => {
    const { app, cookie, projectId } = await ctxOf();

    const created = await makeTicket(app, cookie, projectId, {
      title: "Doublons",
      tags: ["Export", "export ", "auth"],
    });

    expect(created.tags).toEqual(["export", "auth"]);
  });

  it("given tags of 1 and 30 characters and ten tags, when the ticket is created, then it is accepted", async () => {
    const { app, cookie, projectId } = await ctxOf();
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);

    const created = await makeTicket(app, cookie, projectId, {
      title: "Limites",
      tags: ["a", "b".repeat(30)],
    });
    const full = await makeTicket(app, cookie, projectId, {
      title: "Dix",
      tags: ten,
    });

    expect(created.tags).toEqual(["a", "b".repeat(30)]);
    expect(full.tags).toEqual(ten);
  });

  it.each([
    ["an empty tag", [""]],
    ["a tag of spaces", ["   "]],
    ["a tag of 31 characters", ["x".repeat(31)]],
    ["a tag with a NUL character", ["a\0b"]],
    ["eleven tags", Array.from({ length: 11 }, (_, i) => `t${i}`)],
    ["a valid tag next to an invalid one", ["bon", ""]],
    ["a tag that is not a string", ["bon", 3]],
    ["tags that are not an array", "export"],
    ["tags that are null", null],
  ])(
    "given %s, when the ticket is created, then 400 and nothing is written, not even a history entry",
    async (_name, tags) => {
      const { app, db, cookie, projectId } = await ctxOf();

      const res = await postTicket(app, cookie, projectId, {
        title: "Refusé",
        tags,
      });

      expect(res.status).toBe(400);
      expect(await db.select().from(tickets)).toHaveLength(0);
      expect(await entries(db, "create_ticket")).toHaveLength(0);
    },
  );

  it.each(["urgent", "HIGH", "", 3, null])(
    "given the priority %j, when the ticket is created, then 400 and nothing is written",
    async (priority) => {
      const { app, db, cookie, projectId } = await ctxOf();

      const res = await postTicket(app, cookie, projectId, {
        title: "Refusé",
        priority,
      });

      expect(res.status).toBe(400);
      expect(await db.select().from(tickets)).toHaveLength(0);
      expect(await entries(db, "create_ticket")).toHaveLength(0);
    },
  );

  it("given an archived project, when a ticket with a priority and tags is created, then 409 project_archived and nothing is written", async () => {
    const { app, db, cookie, projectId } = await ctxOf();
    await db.execute(sql`update projects set archived_at = now()`);

    const res = await postTicket(app, cookie, projectId, {
      title: "Trop tard",
      priority: "high",
      tags: ["x"],
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await db.select().from(tickets)).toHaveLength(0);
  });
});

describe("055 A/B: edit the priority and the tags", () => {
  it("given a ticket, when PATCH sends a priority and tags, then both change, tags are normalised, and GET shows them", async () => {
    const { app, cookie, projectId } = await ctxOf();
    const { id } = await makeTicket(app, cookie, projectId, { title: "T" });

    const res = await patchTicket(app, cookie, id, {
      priority: "low",
      tags: [" Back  Office ", "API"],
    });

    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({
      priority: "low",
      tags: ["back office", "api"],
    });
    expect(await read(await getTicket(app, cookie, id))).toMatchObject({
      priority: "low",
      tags: ["back office", "api"],
    });
  });

  it("given a ticket with tags, when PATCH sends only a priority, then the tags and the title stay; and { tags: [] } clears the tags and keeps the priority", async () => {
    const { app, cookie, projectId } = await ctxOf();
    const { id } = await makeTicket(app, cookie, projectId, {
      title: "Garde",
      tags: ["a"],
      priority: "high",
    });

    await patchTicket(app, cookie, id, { priority: "low" });
    const after = await read(await getTicket(app, cookie, id));
    expect(after).toMatchObject({
      title: "Garde",
      priority: "low",
      tags: ["a"],
    });

    const cleared = await patchTicket(app, cookie, id, { tags: [] });
    expect(cleared.status).toBe(200);
    expect(await read(cleared)).toMatchObject({ priority: "low", tags: [] });
  });

  it("given a ticket, when PATCH sends an invalid tag with a valid title and priority, then 400 and nothing changes, with no update_ticket entry", async () => {
    const { app, db, cookie, projectId } = await ctxOf();
    const { id } = await makeTicket(app, cookie, projectId, {
      title: "Avant",
      tags: ["a"],
    });

    const res = await patchTicket(app, cookie, id, {
      title: "Après",
      priority: "high",
      tags: ["bon", "x".repeat(31)],
    });

    expect(res.status).toBe(400);
    expect(await read(await getTicket(app, cookie, id))).toMatchObject({
      title: "Avant",
      priority: "normal",
      tags: ["a"],
    });
    expect(await entries(db, "update_ticket")).toHaveLength(0);
  });

  it.each(["urgent", null])(
    "given a ticket, when PATCH sends the priority %j, then 400 and nothing changes",
    async (priority) => {
      const { app, db, cookie, projectId } = await ctxOf();
      const { id } = await makeTicket(app, cookie, projectId, {
        title: "Avant",
      });

      const res = await patchTicket(app, cookie, id, { priority });

      expect(res.status).toBe(400);
      expect((await read(await getTicket(app, cookie, id))).priority).toBe(
        "normal",
      );
      expect(await entries(db, "update_ticket")).toHaveLength(0);
    },
  );

  it("given an archived project, when PATCH sends a priority, then 409 project_archived and the ticket is unchanged", async () => {
    const { app, db, cookie, projectId } = await ctxOf();
    const { id } = await makeTicket(app, cookie, projectId, { title: "Figé" });
    await db.execute(sql`update projects set archived_at = now()`);

    const res = await patchTicket(app, cookie, id, {
      priority: "high",
      tags: ["x"],
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await read(await getTicket(app, cookie, id))).toMatchObject({
      priority: "normal",
      tags: [],
    });
  });
});

describe("055 A: the database refuses a priority outside the three", () => {
  it("given the tickets table, when a row is inserted with an unknown priority, then the CHECK refuses it, and the three known ones pass", async () => {
    const { db, projectId } = await ctxOf();
    for (const priority of ["low", "normal", "high"])
      await db.execute(
        sql`insert into tickets (project_id, title, priority) values (${projectId}, 'ok', ${priority})`,
      );

    const error = await db
      .execute(
        sql`insert into tickets (project_id, title, priority) values (${projectId}, 'ko', 'urgent')`,
      )
      .then(
        () => null,
        (e: unknown) => e,
      );

    const cause = (error as { cause?: unknown } | null)?.cause;
    expect(error, "the insert must be refused").not.toBeNull();
    expect(
      `${(error as Error | null)?.message ?? ""} ${(cause as Error | undefined)?.message ?? ""}`,
    ).toMatch(/check constraint/i);
  });
});

describe("055 B: the order of the list", () => {
  it("given tickets of every priority, when the list is read, then high comes first, then normal, then low, newest first inside each", async () => {
    const { app, cookie, projectId } = await ctxOf();
    const make = (title: string, priority: string) =>
      makeTicket(app, cookie, projectId, { title, priority });
    await make("basse-ancienne", "low");
    await make("haute-ancienne", "high");
    await make("normale-ancienne", "normal");
    await make("haute-récente", "high");
    await make("normale-récente", "normal");
    await make("basse-récente", "low");

    const res = await listTickets(app, cookie, projectId);

    const list = ((await res.json()) as { tickets: ApiTicket[] }).tickets;
    expect(list.map((t) => t.title)).toEqual([
      "haute-récente",
      "haute-ancienne",
      "normale-récente",
      "normale-ancienne",
      "basse-récente",
      "basse-ancienne",
    ]);
  });
});

describe("055 B: the history never keeps the tags", () => {
  it("given a creation and an edit with tags, when the history is read, then both entries keep args { ticketId } and no tag appears anywhere in it", async () => {
    const { app, db, cookie, projectId } = await ctxOf();
    const { id } = await makeTicket(app, cookie, projectId, {
      title: "Historique",
      tags: ["etiquette-secrete-1"],
      priority: "high",
    });
    await patchTicket(app, cookie, id, { tags: ["etiquette-secrete-2"] });

    const created = await entries(db, "create_ticket");
    const updated = await entries(db, "update_ticket");

    expect(created.map((e) => e.args)).toEqual([{ ticketId: id }]);
    expect(updated.map((e) => e.args)).toEqual([{ ticketId: id }]);
    expect(JSON.stringify(await db.select().from(history))).not.toContain(
      "etiquette-secrete",
    );
  });
});
