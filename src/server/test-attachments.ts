import { deflateSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { App, TestDb } from "./test-mcp.ts";

// Shared by the acceptance tests of slice 11.4 (decision 061): tiny files with real magic bytes, the multipart upload
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

/** What a browser sends for a form: the serialised bytes, the content type with its boundary and the Content-Length (app.request() sets none by itself). */
export async function multipart(form: FormData) {
  const response = new Response(form);
  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    headers: {
      "content-type": response.headers.get("content-type") ?? "",
      "content-length": String(body.length),
    },
  };
}

/** POST /api/tickets/:id/attachments, a multipart form with the field `file`. */
export async function upload(
  app: App,
  cookie: string | undefined,
  ticketId: number | string,
  file: Upload,
) {
  const { body, headers } = await multipart(formOf(file));
  return app.request(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    body,
  });
}

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

/** A PDF whose pages each have `content` as their content stream (Flate-compressed when `compress`): a few KB can inflate to hundreds of MB. */
export function streamPdf(pages: Buffer[], compress = true, extraTrailer = "") {
  const objs: (string | Buffer)[] = [];
  const kids: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let n = 4;
  for (const content of pages) {
    const data = compress ? deflateSync(content) : content;
    const c = n++;
    const p = n++;
    objs[c] = Buffer.concat([
      Buffer.from(
        `<< /Length ${data.length}${compress ? " /Filter /FlateDecode" : ""} >>\nstream\n`,
      ),
      data,
      Buffer.from("\nendstream"),
    ]);
    objs[p] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${c} 0 R >>`;
    kids.push(`${p} 0 R`);
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let off = (parts[0] as Buffer).length;
  for (let i = 1; i < n; i++) {
    offsets[i] = off;
    const b = Buffer.concat([
      Buffer.from(`${i} 0 obj\n`),
      Buffer.from(objs[i] as string | Buffer),
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(b);
    off += b.length;
  }
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++)
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  parts.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${n} /Root 1 0 R ${extraTrailer} >>\nstartxref\n${off}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

/** A page of text-showing operators, `repeat` times: 33 bytes of content for each. */
export const textOps = (repeat: number) =>
  Buffer.alloc(repeat * 33, "BT /F1 12 Tf 72 720 Td (x) Tj ET\n");

/** A PDF that declares the standard security handler: a reader needs a password it does not have. */
export const encryptedPdf = () =>
  streamPdf(
    [Buffer.from("BT /F1 12 Tf 72 720 Td (secret) Tj ET")],
    false,
    `/ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] /Encrypt << /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`,
  );
