import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { attachments, tickets } from "./db/schema.ts";
import { isDatabaseId, type Role } from "./projects.ts";
import { assertActive, memberTicket, refusal } from "./tickets.ts";

// Decision 061: files attached to a ticket, kept in PostgreSQL.
const MIB = 1024 * 1024;
// 3.75 MiB: 5 MB once base64-encoded for Claude (decision 061 B).
export const MAX_IMAGE = 3_932_160;
export const MAX_FILE = 20 * MIB;
export const MAX_PER_TICKET = 20;

const unauthorized = { error: "Unauthorized" };
const notFound = { error: "Not found" };

const MAGIC: [string, number[], number?][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [...Buffer.from("GIF8")]],
  ["application/pdf", [...Buffer.from("%PDF-")]],
];
const TEXT_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

/** The type of a file by its content (never by what the browser says); a text is told by the extension of its name. Undefined when not accepted. */
export function detectType(bytes: Buffer, name: string) {
  const starts = (head: number[]) => head.every((b, i) => bytes[i] === b);
  const magic = MAGIC.find(([, head]) => starts(head))?.[0];
  if (magic === "image/gif" && ![0x37, 0x39].includes(bytes[4] ?? 0))
    return undefined;
  if (magic) return magic;
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return TEXT_TYPES[name.split(".").at(-1)?.toLowerCase() ?? ""];
}

/** No path separator, no control character (C0, C1, and the bidi ones that can disguise an extension). */
export const cleanName = (name: string) =>
  name.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
    /[/\\\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );

/** A fixed code when the file is refused. */
export function check(bytes: Buffer, name: string) {
  if (!name) return "invalid_name";
  const mediaType = detectType(bytes, name);
  if (!mediaType) return "unsupported_type";
  if (bytes.length > (mediaType.startsWith("image/") ? MAX_IMAGE : MAX_FILE))
    return "too_large";
  if (mediaType.startsWith("image/") || mediaType === "application/pdf")
    return undefined;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "unsupported_type";
  }
  return bytes.includes(0) ? "unsupported_type" : undefined;
}

const columns = {
  id: attachments.id,
  name: attachments.name,
  mediaType: attachments.mediaType,
  size: attachments.size,
  createdAt: attachments.createdAt,
};

/** An attachment (without its content) of a ticket the user may reach. */
export async function memberAttachment(
  db: Db,
  userId: number,
  id: number,
  min?: Role,
) {
  if (!isDatabaseId(id)) return undefined;
  const [row] = await db
    .select({ ...columns, ticketId: attachments.ticketId })
    .from(attachments)
    .where(eq(attachments.id, id));
  const found = row && (await memberTicket(db, userId, row.ticketId, min));
  return found && { attachment: row, ...found };
}

/** Behind the gate of `projectRoutes`, which also covers /api/tickets/* and /api/attachments/*. */
export function attachmentRoutes(db: Db) {
  const entryOf = (userId: number, action: string): Entry => ({
    userId,
    actor: "human",
    origin: "ui",
    action,
    args: {},
  });

  return new Hono()
    .get("/api/tickets/:id/attachments", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberTicket(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json(notFound, 404);
      return c.json({
        attachments: await db
          .select(columns)
          .from(attachments)
          .where(eq(attachments.ticketId, found.ticket.id))
          .orderBy(asc(attachments.id)),
      });
    })
    .post("/api/tickets/:id/attachments", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberTicket(
        db,
        user.userId,
        Number(c.req.param("id")),
        "can_validate",
      );
      if (!found) return c.json(notFound, 404);
      const form = await c.req.formData().catch(() => new FormData());
      const file = form.get("file");
      if (!(file instanceof File)) return c.json({ error: "Bad request" }, 400);

      const name = cleanName(file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      const problem = check(bytes, name);
      if (problem) return c.json({ error: problem }, 400);

      const { ticket, project } = found;
      const entry: Entry = {
        ...entryOf(user.userId, "add_attachment"),
        projectId: project.id,
        ticketId: ticket.id,
        args: { ticketId: ticket.id },
      };
      try {
        const row = await act(db, entry, async (tx) => {
          await assertActive(tx, project.id);
          // The ticket row is locked: two uploads racing for the last place are counted one after the other.
          const [locked] = await tx
            .select({ id: tickets.id })
            .from(tickets)
            .where(eq(tickets.id, ticket.id))
            .for("update");
          if (!locked) throw new Refused("not_found");
          const [{ n = 0 } = {}] = await tx
            .select({ n: count() })
            .from(attachments)
            .where(eq(attachments.ticketId, ticket.id));
          if (n >= MAX_PER_TICKET) throw new Refused("too_many");
          const [inserted] = await tx
            .insert(attachments)
            .values({
              ticketId: ticket.id,
              // The name is cut after the type is known: the extension may be what is cut off.
              // Never ends on half an emoji, which would be stored as U+FFFD.
              name: name.slice(
                0,
                /[\uD800-\uDBFF]/.test(name.charAt(199)) ? 199 : 200,
              ),
              mediaType: detectType(bytes, name) ?? "",
              size: bytes.length,
              content: bytes,
            })
            .returning(columns);
          if (!inserted) throw new Error("attachment not created");
          entry.args = { ticketId: ticket.id, attachmentId: inserted.id };
          return inserted;
        });
        return c.json({ attachment: row }, 201);
      } catch (error) {
        if (error instanceof Refused && error.message === "too_many")
          return c.json({ error: "too_many" }, 400);
        return refusal(c, error);
      }
    })
    .get("/api/attachments/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberAttachment(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json(notFound, 404);
      const { name, mediaType } = found.attachment;
      const [row] = await db
        .select({ content: attachments.content })
        .from(attachments)
        .where(eq(attachments.id, found.attachment.id));
      if (!row) return c.json(notFound, 404);
      const inline = mediaType.startsWith("image/");
      return c.body(new Uint8Array(row.content), 200, {
        "Content-Type": mediaType.startsWith("text/")
          ? `${mediaType}; charset=utf-8`
          : mediaType,
        // Only `filename*`: the name is free text and never goes raw into a header.
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        // app.ts adds frame-ancestors to it.
        "Content-Security-Policy": "sandbox",
      });
    })
    .delete("/api/attachments/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await memberAttachment(
        db,
        user.userId,
        Number(c.req.param("id")),
        "can_validate",
      );
      if (!found) return c.json(notFound, 404);
      const entry: Entry = {
        ...entryOf(user.userId, "delete_attachment"),
        projectId: found.project.id,
        ticketId: found.ticket.id,
        args: { ticketId: found.ticket.id, attachmentId: found.attachment.id },
      };
      try {
        await act(db, entry, async (tx) => {
          await assertActive(tx, found.project.id);
          await tx
            .delete(attachments)
            .where(eq(attachments.id, found.attachment.id));
        });
        return c.body(null, 204);
      } catch (error) {
        return refusal(c, error);
      }
    });
}
