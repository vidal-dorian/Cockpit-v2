import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { App, TestDb } from "./test-mcp.ts";

// Shared by the acceptance tests of slice 11.4 (decision 058): tiny files with real magic bytes, the multipart upload
// over app.request(), and raw SQL on `attachments` (so no test depends on the Drizzle export of the table).

export const MIB = 1024 * 1024;

const bytesOf = (base64: string) => Buffer.from(base64, "base64");

export const PNG = bytesOf(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
);
export const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
export const GIF = bytesOf("R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAIBAAA7");
// RIFF <size> WEBP VP8L <chunk size> <1x1 lossless payload>
export const WEBP = bytesOf("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==");

/** A one-page PDF with `text` on it (a blank page without). Offsets of the xref table are computed, so any reader opens it. */
export function pdf(text?: string) {
  const stream = text ? `BT /F1 18 Tf 20 100 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** `head` (the magic bytes) padded with zeros to exactly `size` bytes. */
export const padded = (head: Buffer, size: number) =>
  Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);

export type Upload = {
  name: string;
  bytes: Uint8Array | string;
  /** What the browser would announce; the server must ignore it. */
  type?: string;
};

export const formOf = ({ name, bytes, type }: Upload) => {
  const form = new FormData();
  const part = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  form.set("file", new File([new Uint8Array(part)], name, { type }));
  return form;
};

/** POST /api/tickets/:id/attachments, a multipart form with the field `file`. */
export const upload = (
  app: App,
  cookie: string | undefined,
  ticketId: number | string,
  file: Upload,
) =>
  app.request(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: formOf(file),
  });

export type ApiAttachment = {
  id: number;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
};

/** Uploads a file that must be accepted and returns what the route answers. */
export async function attach(
  app: App,
  cookie: string,
  ticketId: number,
  file: Upload,
) {
  const res = await upload(app, cookie, ticketId, file);
  expect(res.status, "the upload must be accepted").toBe(201);
  return ((await res.json()) as { attachment: ApiAttachment }).attachment;
}

export const getAttachment = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/attachments/${id}`, { headers: { cookie } });

export const deleteAttachment = (
  app: App,
  cookie: string,
  id: number | string,
) =>
  app.request(`/api/attachments/${id}`, {
    method: "DELETE",
    headers: { cookie },
  });

export const listAttachments = (
  app: App,
  cookie: string,
  ticketId: number | string,
) =>
  app.request(`/api/tickets/${ticketId}/attachments`, { headers: { cookie } });

/** What `attachments` holds, read with raw SQL (never `content`: its size is the point). */
export async function storedRows(db: TestDb) {
  const result = await db.execute(
    sql`select id, ticket_id, name, media_type, size, octet_length(content)::int as stored from attachments order by id`,
  );
  return (
    result as unknown as {
      rows: {
        id: number;
        ticket_id: number;
        name: string;
        media_type: string;
        size: number;
        stored: number;
      }[];
    }
  ).rows;
}

export const storedCount = async (db: TestDb) => (await storedRows(db)).length;
