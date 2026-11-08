import { describe, expect, it } from "vitest";
import {
  MIB,
  PNG,
  padded,
  pdf,
  storedCount,
  storedRows,
  upload,
} from "./test-attachments.ts";
import { withProject } from "./test-mcp.ts";
import { makeTicket, postTicket } from "./test-tickets.ts";

// Slice 11.4, decision 058 A, B, C: the limits. A « Mo » is a mebibyte here (5 * 1024 * 1024 and 20 * 1024 * 1024 bytes).
//
// Pinned choices (the decision leaves them open):
// - An image of 5 MiB is accepted, one byte more is 400 too_large. A PDF or a text of 20 MiB is accepted, one byte more is 400 too_large.
//   An image over 5 MiB is refused even though it is under 20 MiB.
// - A file just over its limit still fits the body limit of the route (20 MiB plus the envelope of the form), so it reaches the check and is a 400 too_large, not a 413.
//   A body far over the limit (25 MiB of file) is stopped by the route's body limit: 413. The JSON routes keep their 256 KiB (413 above).
// - The 21st attachment of a ticket is 400 too_many; deleting one makes room again. The count is checked in the transaction with the ticket row locked,
//   so two uploads racing for the 20th place give one 201 and one 400 too_many.

const ctxOf = async () => {
  const ctx = await withProject();
  const ticket = await makeTicket(ctx.app, ctx.alice.cookie, ctx.projectId);
  return { ...ctx, cookie: ctx.alice.cookie, ticketId: ticket.id };
};
type Ctx = Awaited<ReturnType<typeof ctxOf>>;
const note = (ctx: Ctx, n: number) =>
  upload(ctx.app, ctx.cookie, ctx.ticketId, {
    name: `note-${n}.txt`,
    bytes: `note ${n}`,
  });

describe("058 B: the sizes", () => {
  it("given an image of exactly 5 MiB, when it is uploaded, then it is accepted", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "grande.png",
      bytes: padded(PNG, 5 * MIB),
    });

    expect(res.status).toBe(201);
    expect((await storedRows(db))[0]).toMatchObject({
      size: 5 * MIB,
      stored: 5 * MIB,
    });
  });

  it("given an image of 5 MiB and one byte, when it is uploaded, then 400 too_large and nothing is stored", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "trop-grande.png",
      bytes: padded(PNG, 5 * MIB + 1),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(await storedCount(db)).toBe(0);
  });

  it("given a PDF of 5 MiB and one byte, when it is uploaded, then it is accepted: the 5 MiB limit is the images'", async () => {
    const { app, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "gros.pdf",
      bytes: padded(pdf("Bonjour"), 5 * MIB + 1),
    });

    expect(res.status).toBe(201);
  });

  it("given a PDF of 20 MiB and one byte, when it is uploaded, then 400 too_large (not 413)", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "énorme.pdf",
      bytes: padded(pdf("Bonjour"), 20 * MIB + 1),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(await storedCount(db)).toBe(0);
  });

  it("given a text of 20 MiB and one byte, when it is uploaded, then 400 too_large", async () => {
    const { app, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "énorme.txt",
      bytes: "a".repeat(20 * MIB + 1),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_large" });
  });
});

describe("058 C: the body limit of the route", () => {
  it("given a text of exactly 20 MiB, when it is uploaded, then it is accepted whole, while a JSON route still refuses a body over 256 KiB", async () => {
    const { app, db, cookie, projectId, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "journal.txt",
      bytes: "a".repeat(20 * MIB),
    });

    expect(res.status, "the route has a body limit of its own").toBe(201);
    expect((await storedRows(db))[0]).toMatchObject({
      size: 20 * MIB,
      stored: 20 * MIB,
    });
    const json = await postTicket(app, cookie, projectId, {
      title: "Gros",
      descriptionMd: "a".repeat(300 * 1024),
    });
    expect(json.status).toBe(413);
  });

  it("given a body of 25 MiB, when it is uploaded, then 413 and nothing is stored", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "démesure.txt",
      bytes: "a".repeat(25 * MIB),
    });

    expect(res.status).toBe(413);
    expect(await storedCount(db)).toBe(0);
  });
});

describe("058 A: at most 20 attachments per ticket", () => {
  it("given a ticket with 20 attachments, when a 21st is uploaded, then 400 too_many and the 20 stay", async () => {
    const ctx = await ctxOf();
    for (let n = 1; n <= 20; n++)
      expect((await note(ctx, n)).status, `attachment ${n}`).toBe(201);

    const res = await note(ctx, 21);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_many" });
    expect(await storedCount(ctx.db)).toBe(20);
  });

  it("given a ticket with 20 attachments, when one is deleted, then a new one is accepted", async () => {
    const ctx = await ctxOf();
    for (let n = 1; n <= 20; n++) await note(ctx, n);
    const [first] = await storedRows(ctx.db);

    const gone = await ctx.app.request(`/api/attachments/${first?.id}`, {
      method: "DELETE",
      headers: { cookie: ctx.cookie },
    });
    expect(gone.status).toBe(204);

    expect((await note(ctx, 21)).status).toBe(201);
  });

  it("given two tickets, when one has 20 attachments, then the other still accepts its own", async () => {
    const ctx = await ctxOf();
    const other = await makeTicket(ctx.app, ctx.cookie, ctx.projectId);
    for (let n = 1; n <= 20; n++) await note(ctx, n);

    const res = await upload(ctx.app, ctx.cookie, other.id, {
      name: "a.txt",
      bytes: "a",
    });

    expect(res.status).toBe(201);
  });

  it("given a ticket with 19 attachments, when two uploads arrive at the same time, then exactly one is accepted, the other is too_many, and the ticket holds 20", async () => {
    const ctx = await ctxOf();
    for (let n = 1; n <= 19; n++) await note(ctx, n);

    const results = await Promise.all([note(ctx, 20), note(ctx, 21)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const refused = results.find((r) => r.status === 400);
    expect(await refused?.json()).toEqual({ error: "too_many" });
    expect(await storedCount(ctx.db)).toBe(20);
  });
});
