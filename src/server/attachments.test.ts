import { describe, expect, it } from "vitest";
import {
  type ApiAttachment,
  attach,
  GIF,
  JPEG,
  listAttachments,
  PNG,
  pdf,
  storedRows,
  upload,
  WEBP,
} from "./test-attachments.ts";
import { withProject } from "./test-mcp.ts";
import { makeTicket } from "./test-tickets.ts";

// Slice 11.4, decision 058 A, B, C (J for the name): adding an attachment to a ticket.
//
// Pinned choices (the decision leaves them open):
// - Table `attachments` (id, ticket_id, name, media_type, size, content bytea, created_at); read here with raw SQL.
// - POST /api/tickets/:id/attachments takes a multipart form with ONE field `file`; answer 201
//   { attachment: { id, name, mediaType, size, createdAt } } (`size` in bytes, `name` as stored). A body without a `file` part is 400 { error: "Bad request" }.
// - GET /api/tickets/:id/attachments answers { attachments: [{ id, name, mediaType, size, createdAt }] }, oldest first, never `content`.
// - A refused file is 400 { error: <code> } with the code in unsupported_type | too_large | too_many | invalid_name, and nothing is stored.
// - Stored media types: image/png, image/jpeg, image/webp, image/gif, application/pdf; for a text, by the extension of the name:
//   .txt text/plain, .md text/markdown, .csv text/csv, .json application/json. The extension only chooses among those four: it is never what makes a file an image or a PDF.
// - The type is read from the CONTENT: PNG 89 50 4E 47, JPEG FF D8 FF, GIF "GIF87a"/"GIF89a", WebP "RIFF" ... "WEBP", PDF "%PDF-". What the browser announces (the part's content type) is ignored.
//   Whatever is not one of those is a text: it needs one of the four extensions, valid UTF-8 and no NUL, else unsupported_type.
//   So a PNG named « x.txt » is a PNG (image/png), an HTML page named « x.png » is unsupported_type, and an SVG (« x.svg » or whatever) is unsupported_type.
// - The name is sanitised before it is stored: `/`, `\` and control characters (U+0000 to U+001F and U+007F) removed, then cut at its first 200 characters;
//   nothing left is invalid_name.

const ctxOf = async () => {
  const ctx = await withProject();
  const ticket = await makeTicket(ctx.app, ctx.alice.cookie, ctx.projectId);
  return { ...ctx, cookie: ctx.alice.cookie, ticketId: ticket.id };
};
const refused = async (res: Response, code: string) => {
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: code });
};

describe("058 B: the accepted types", () => {
  it.each([
    ["a PNG", "plan.png", PNG, "image/png"],
    ["a JPEG", "photo.jpg", JPEG, "image/jpeg"],
    ["a WebP", "image.webp", WEBP, "image/webp"],
    ["a GIF", "anim.gif", GIF, "image/gif"],
    ["a PDF", "retours.pdf", pdf("Bonjour"), "application/pdf"],
    ["a .txt", "notes.txt", Buffer.from("Des notes é\n"), "text/plain"],
    ["a .md", "lisez-moi.md", Buffer.from("# Titre\n"), "text/markdown"],
    ["a .csv", "exemple.csv", Buffer.from("a,b\n1,2\n"), "text/csv"],
    ["a .json", "data.json", Buffer.from('{"a":1}'), "application/json"],
  ])(
    "given %s, when it is uploaded, then it is stored with its recognised type and size, and the list shows it",
    async (_what, name, bytes, mediaType) => {
      const { app, db, cookie, ticketId } = await ctxOf();

      const res = await upload(app, cookie, ticketId, { name, bytes });

      expect(res.status).toBe(201);
      const { attachment } = (await res.json()) as {
        attachment: ApiAttachment;
      };
      expect(attachment).toMatchObject({ name, mediaType, size: bytes.length });
      expect(typeof attachment.id).toBe("number");
      const [row] = await storedRows(db);
      expect(row).toMatchObject({
        ticket_id: ticketId,
        name,
        media_type: mediaType,
        size: bytes.length,
        stored: bytes.length,
      });
      const listed = (await (
        await listAttachments(app, cookie, ticketId)
      ).json()) as { attachments: ApiAttachment[] };
      expect(listed.attachments.map((a) => a.id)).toEqual([attachment.id]);
    },
  );

  it("given a PNG named .txt and announced as text/plain, when it is uploaded, then the content wins: it is stored as image/png", async () => {
    const { app, cookie, ticketId } = await ctxOf();

    const attachment = await attach(app, cookie, ticketId, {
      name: "faux.txt",
      bytes: PNG,
      type: "text/plain",
    });

    expect(attachment.mediaType).toBe("image/png");
  });

  it("given a text named .txt and announced as image/png, when it is uploaded, then it is stored as text/plain", async () => {
    const { app, cookie, ticketId } = await ctxOf();

    const attachment = await attach(app, cookie, ticketId, {
      name: "vrai.txt",
      bytes: "juste du texte",
      type: "image/png",
    });

    expect(attachment.mediaType).toBe("text/plain");
  });

  it("given an HTML page named .png and announced as image/png, when it is uploaded, then 400 unsupported_type and nothing is stored", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();

    const res = await upload(app, cookie, ticketId, {
      name: "page.png",
      bytes: "<html><script>alert(1)</script></html>",
      type: "image/png",
    });

    await refused(res, "unsupported_type");
    expect(await storedRows(db)).toEqual([]);
  });

  it.each([
    ["an SVG", "logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ["an SVG named .png", "logo.png", "<svg onload=alert(1)></svg>"],
    ["an HTML file", "page.html", "<h1>Bonjour</h1>"],
    ["a plain text with another extension", "run.sh", "echo bonjour\n"],
    ["a text without extension", "LISEZMOI", "bonjour\n"],
    ["a binary file", "outil.exe", Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
  ])(
    "given %s, when it is uploaded, then 400 unsupported_type",
    async (_what, name, bytes) => {
      const { app, cookie, ticketId } = await ctxOf();

      await refused(
        await upload(app, cookie, ticketId, { name, bytes }),
        "unsupported_type",
      );
    },
  );

  it.each([
    ["invalid UTF-8", Buffer.from([0x61, 0xff, 0xfe, 0x62])],
    ["a NUL character", Buffer.from("avant\0après")],
  ])(
    "given a .txt with %s, when it is uploaded, then 400 unsupported_type and nothing is stored",
    async (_what, bytes) => {
      const { app, db, cookie, ticketId } = await ctxOf();

      await refused(
        await upload(app, cookie, ticketId, { name: "notes.txt", bytes }),
        "unsupported_type",
      );
      expect(await storedRows(db)).toEqual([]);
    },
  );

  it("given a body that is not a form with a file, when it is posted, then 400 Bad request", async () => {
    const { app, cookie, ticketId } = await ctxOf();

    const res = await app.request(`/api/tickets/${ticketId}/attachments`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ file: "x" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });
});

describe("058 J: the name", () => {
  it("given a name with slashes, backslashes and control characters, when it is uploaded, then they are removed from the stored name", async () => {
    const { app, db, cookie, ticketId } = await ctxOf();

    const attachment = await attach(app, cookie, ticketId, {
      name: "../évil\\dir/a\u0007b\tc.txt",
      bytes: "texte",
    });

    expect(attachment.name).toBe("..évildirabc.txt");
    expect((await storedRows(db))[0]?.name).toBe("..évildirabc.txt");
  });

  it("given a name with C1 controls and bidi controls, when it is uploaded, then they are removed (a right-to-left override could disguise the extension)", async () => {
    const { app, cookie, ticketId } = await ctxOf();

    const attachment = await attach(app, cookie, ticketId, {
      name: "a\u0085b\u009fc\u202ed\u202ae\u2066f\u2069g\u200eh\u200fi.txt",
      bytes: "texte",
    });

    expect(attachment.name).toBe("abcdefghi.txt");
  });

  it("given a name of 250 characters, when it is uploaded, then it is cut at its first 200 characters", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const name = `${"n".repeat(246)}.txt`;

    const attachment = await attach(app, cookie, ticketId, {
      name,
      bytes: "texte",
    });

    expect(attachment.name).toBe(name.slice(0, 200));
    expect(attachment.name).toHaveLength(200);
    // 200 characters cut the extension off: the type came from the name BEFORE the cut.
    expect(attachment.mediaType).toBe("text/plain");
  });

  it("given a name of 200 characters, when it is uploaded, then it is kept whole", async () => {
    const { app, cookie, ticketId } = await ctxOf();
    const name = `${"n".repeat(196)}.txt`;

    expect(
      (await attach(app, cookie, ticketId, { name, bytes: "t" })).name,
    ).toBe(name);
  });

  it.each([["/"], ["\\\\"], ["\u0001\u0002"]])(
    "given the name %j that is empty once sanitised, when it is uploaded, then 400 invalid_name and nothing is stored",
    async (name) => {
      const { app, db, cookie, ticketId } = await ctxOf();

      await refused(
        await upload(app, cookie, ticketId, { name, bytes: PNG }),
        "invalid_name",
      );
      expect(await storedRows(db)).toEqual([]);
    },
  );
});
