import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  type ApiAttachment,
  attach,
  deleteAttachment,
  getAttachment,
  listAttachments,
  PNG,
  pdf,
  storedCount,
  storedRows,
  upload,
} from "./test-attachments.ts";
import {
  archiveProject,
  historyText,
  rows,
  userWithToken,
  withProject,
} from "./test-mcp.ts";
import { getTicket, listTickets, makeTicket } from "./test-tickets.ts";

// Slice 11.4, decision 058 A, C, D: reading, deleting and listing attachments, who may, what the history keeps.
//
// Pinned choices (the decision leaves them open):
// - GET /api/attachments/:id answers 200 with the stored bytes, `Content-Type` starting with the stored media type (a charset may follow),
//   `X-Content-Type-Options: nosniff`, a `Content-Security-Policy` holding the directive `sandbox` (the page-wide `frame-ancestors 'none'` of app.ts
//   may stay in the same header, but must not replace it), and `Content-Disposition`:
//   `attachment; filename*=UTF-8''<encodeURIComponent(name)>` for a PDF and a text, the same with `inline` for an image. Never a plain `filename=` carrying the raw name.
// - DELETE /api/attachments/:id answers 204 and deletes the row.
// - GET /api/projects/:id/tickets gives every ticket `attachmentsCount` (a number, 0 without attachment); the list of a ticket never has `content`.
// - Members only: no session is 401; a ticket or an attachment of a project the user is not in, or an id that does not exist or is not a number, is 404 { error: "Not found" }.
// - Archived project (014 D): POST and DELETE are 409 { error: "project_archived" } and change nothing; GET of the file and of the list still work.
// - History (010 D): `add_attachment` and `delete_attachment`, actor human, origin ui, result ok, args { ticketId, attachmentId } exactly,
//   project_id and ticket_id filled. The name of the file is in no column of the history, whatever the action.

const ctxOf = async () => {
  const ctx = await withProject();
  const ticket = await makeTicket(ctx.app, ctx.alice.cookie, ctx.projectId);
  return { ...ctx, cookie: ctx.alice.cookie, ticketId: ticket.id };
};
const NOT_FOUND = { error: "Not found" };
const SECRET_NAME = "salaire-de-marie-dupont.txt";

describe("058 C: GET the file", () => {
  it("given a PDF, when it is read, then the bytes come back with the stored type, an attachment disposition with an encoded filename*, nosniff and a sandbox policy", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const bytes = pdf("Bonjour");
    const { id } = await attach(app, cookie, ticketId, {
      name: 'relevé "x"; final.pdf',
      bytes,
    });

    const res = await getAttachment(app, cookie, id);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/pdf/);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('relevé "x"; final.pdf')}`,
    );
    expect(disposition).not.toContain("relevé");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(
      /(^|;\s*)sandbox\s*(;|$)/,
    );
  });

  it("given an image, when it is read, then it is inline, as image/png, with nosniff and the sandbox policy", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: "maquette.png",
      bytes: PNG,
    });

    const res = await getAttachment(app, cookie, id);

    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''maquette.png",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("given a text that looks like HTML, when it is read, then it is served as text/plain-like data, as an attachment, never as text/html", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: "page.txt",
      bytes: "<script>alert(1)</script>",
      type: "text/html",
    });

    const res = await getAttachment(app, cookie, id);

    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(await res.text()).toBe("<script>alert(1)</script>");
  });
});

describe("058 C: DELETE and the list", () => {
  it("given an attachment, when it is deleted, then 204, the row is gone and the file is not served any more", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: "a.png",
      bytes: PNG,
    });

    const res = await deleteAttachment(app, cookie, id);

    expect(res.status).toBe(204);
    expect(await storedCount(db)).toBe(0);
    expect((await getAttachment(app, cookie, id)).status).toBe(404);
  });

  it("given three attachments, when the list is read, then it gives id, name, mediaType, size and createdAt, oldest first, and no content", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const a = await attach(app, cookie, ticketId, {
      name: "a.png",
      bytes: PNG,
    });
    const b = await attach(app, cookie, ticketId, {
      name: "b.txt",
      bytes: "douze octets",
    });
    const c = await attach(app, cookie, ticketId, {
      name: "c.pdf",
      bytes: pdf("x"),
    });

    const res = await listAttachments(app, cookie, ticketId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { attachments: ApiAttachment[] };
    expect(body.attachments.map((x) => [x.id, x.name, x.size])).toEqual([
      [a.id, "a.png", PNG.length],
      [b.id, "b.txt", 12],
      [c.id, "c.pdf", pdf("x").length],
    ]);
    for (const item of body.attachments) {
      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "id",
        "mediaType",
        "name",
        "size",
      ]);
    }
    expect(JSON.stringify(body)).not.toMatch(/content|douze octets/);
  });

  it("given a ticket with two attachments and one without, when the tickets of the project are listed, then each has its attachmentsCount", async () => {
    const { app, cookie, projectId, ticketId } = await ctxOf();
    const bare = await makeTicket(app, cookie, projectId, { title: "Nu" });
    await attach(app, cookie, ticketId, { name: "a.png", bytes: PNG });
    await attach(app, cookie, ticketId, { name: "b.txt", bytes: "b" });

    const res = await listTickets(app, cookie, projectId);

    const { tickets } = (await res.json()) as {
      tickets: { id: number; attachmentsCount: number }[];
    };
    expect(
      Object.fromEntries(tickets.map((t) => [t.id, t.attachmentsCount])),
    ).toEqual({ [ticketId]: 2, [bare.id]: 0 });
  });

  it("given a ticket with attachments, when the ticket is deleted, then its attachments are deleted with it", async () => {
    const { app, db, cookie, projectId } = await ctxOf();
    const doomed = await makeTicket(app, cookie, projectId, {
      title: "Sans US",
    });
    await attach(app, cookie, doomed.id, { name: "a.png", bytes: PNG });
    await attach(app, cookie, doomed.id, { name: "b.txt", bytes: "b" });

    const res = await app.request(`/api/tickets/${doomed.id}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(res.status).toBe(204);
    expect(await storedCount(db)).toBe(0);
  });

  it("given an attachment, when its ticket row is deleted in the database, then the foreign key cascades", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();
    await attach(app, cookie, ticketId, { name: "a.png", bytes: PNG });

    await db.execute(sql`delete from tickets where id = ${ticketId}`);

    expect(await storedCount(db)).toBe(0);
  });
});

describe("058 C: members only", () => {
  it("given no session, when each route is called, then 401", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: "a.png",
      bytes: PNG,
    });

    expect(
      (await upload(app, undefined, ticketId, { name: "b.png", bytes: PNG }))
        .status,
    ).toBe(401);
    expect(
      (await app.request(`/api/tickets/${ticketId}/attachments`)).status,
    ).toBe(401);
    expect((await app.request(`/api/attachments/${id}`)).status).toBe(401);
    expect(
      (await app.request(`/api/attachments/${id}`, { method: "DELETE" }))
        .status,
    ).toBe(401);
  });

  it("given another user outside the project, when they add, list, read or delete, then 404 and nothing changes", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: "a.png",
      bytes: PNG,
    });
    const bob = await userWithToken(app, db, 2000);

    const add = await upload(app, bob.cookie, ticketId, {
      name: "b.png",
      bytes: PNG,
    });
    const list = await listAttachments(app, bob.cookie, ticketId);
    const read = await getAttachment(app, bob.cookie, id);
    const del = await deleteAttachment(app, bob.cookie, id);

    for (const res of [add, list, read, del]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(await storedCount(db)).toBe(1);
  });

  it("given ids that do not exist or are not numbers, when the routes are called, then 404", async () => {
    const { app, cookie } = await ctxOf();

    for (const res of [
      await upload(app, cookie, 99999, { name: "a.png", bytes: PNG }),
      await upload(app, cookie, "abc", { name: "a.png", bytes: PNG }),
      await getAttachment(app, cookie, 99999),
      await getAttachment(app, cookie, "abc"),
      await deleteAttachment(app, cookie, 99999),
      await listAttachments(app, cookie, 99999),
    ])
      expect(res.status).toBe(404);
  });
});

describe("058 C (014 D): an archived project", () => {
  it("given an archived project, when a file is added or deleted, then 409 project_archived and nothing changes; reading still works", async () => {
    const { app, db, cookie, projectId, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: "a.png",
      bytes: PNG,
    });
    await archiveProject(db, projectId);

    const add = await upload(app, cookie, ticketId, {
      name: "b.png",
      bytes: PNG,
    });
    const del = await deleteAttachment(app, cookie, id);

    for (const res of [add, del]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "project_archived" });
    }
    expect(await storedCount(db)).toBe(1);
    expect((await getAttachment(app, cookie, id)).status).toBe(200);
    expect((await listAttachments(app, cookie, ticketId)).status).toBe(200);
    expect((await getTicket(app, cookie, ticketId)).status).toBe(200);
  });
});

describe("058 D: the history", () => {
  it("given an upload and a deletion, when the history is read, then add_attachment and delete_attachment carry ids only and the columns project_id and ticket_id", async () => {
    const { app, db, cookie, projectId, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: SECRET_NAME,
      bytes: "texte",
    });
    await deleteAttachment(app, cookie, id);

    const added = await rows(db, sql`action = 'add_attachment'`);
    const deleted = await rows(db, sql`action = 'delete_attachment'`);

    for (const entry of [...added, ...deleted]) {
      expect(entry).toMatchObject({
        actor: "human",
        origin: "ui",
        result: "ok",
        project_id: projectId,
        ticket_id: ticketId,
        args: { ticketId, attachmentId: id },
      });
      expect(Object.keys(entry.args).sort()).toEqual([
        "attachmentId",
        "ticketId",
      ]);
    }
    expect(added).toHaveLength(1);
    expect(deleted).toHaveLength(1);
  });

  it("given uploads, refusals and deletions, when the whole history is read, then the name of a file is nowhere in it", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();
    const { id } = await attach(app, cookie, ticketId, {
      name: SECRET_NAME,
      bytes: "texte",
    });
    await upload(app, cookie, ticketId, {
      name: "refuse-de-marie-dupont.exe",
      bytes: Buffer.from([0, 1]),
    });
    await deleteAttachment(app, cookie, id);

    const text = await historyText(db);

    expect(text).not.toContain("marie");
    expect(text).not.toContain("dupont");
    expect(await storedRows(db)).toEqual([]);
  });
});
