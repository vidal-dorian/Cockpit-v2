import { describe, expect, it } from "vitest";
import { attach, JPEG, PNG, pdf } from "./test-attachments.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  onlyEntry,
  seedProject,
  seedTicket,
  userWithToken,
  withProject,
} from "./test-mcp.ts";
import { makeTicket } from "./test-tickets.ts";

// Slice 11.4, decision 061 H: what Claude sees of the attachments.
//
// Pinned choices (the decision leaves them open):
// - `get_ticket` adds `attachments: [{ id, name, media_type, size }]` (exactly those four keys, oldest first, [] without), `list_tickets_needing_us` adds `attachments_count` to each ticket (a number).
// - `get_attachment({ attachment_id })` answers, as the MCP content of the result (not JSON wrapped in a text):
//   an image  -> content [{ type: "image", data: <base64 of the bytes>, mimeType: <stored media type> }];
//   a text    -> content [{ type: "text", text: <the file's text, as is> }];
//   a PDF     -> content [{ type: "text", text: <the text extracted from its pages> }] (the page of the test holds the line « Bonjour le monde »);
//   a PDF without text -> content [{ type: "text", text: "Ce PDF ne contient pas de texte lisible (probablement scanné)." }].
// - A rendered text (a text file or a PDF's) of more than 100 000 characters is cut at 100 000, followed only by « (tronqué) »; exactly 100 000 characters is not cut.
//   The description of the tool warns Claude of it (mentions the 100,000 characters and the truncation, in English).
// - Another user's attachment, an unknown id and arguments that do not fit are refused ("Refused: ..."), without any content of the file in the answer.
//   An archived project's attachment is read normally.
// - The call leaves ONE history entry: origin mcp, actor claude, action get_attachment, args exactly { attachmentId }, project_id and ticket_id of the attachment's ticket, result ok.
// - tools/list shows 24 tools (23 before this slice, with the launcher's): get_attachment has an input schema requiring `attachment_id`.

const ctxOf = async () => {
  const ctx = await withProject();
  const ticket = await makeTicket(ctx.app, ctx.alice.cookie, ctx.projectId);
  return { ...ctx, cookie: ctx.alice.cookie, ticketId: ticket.id };
};
type Ctx = Awaited<ReturnType<typeof ctxOf>>;
type Content = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};
const read = async (
  ctx: Ctx,
  attachmentId: number,
  secret = ctx.alice.secret,
) => {
  const result = await callTool(ctx.app, secret, "get_attachment", {
    attachment_id: attachmentId,
  });
  return { result, content: result.content as Content[] };
};
const SCANNED =
  "Ce PDF ne contient pas de texte lisible (probablement scanné).";

describe("061 H: get_ticket and list_tickets_needing_us", () => {
  it("given a ticket with two attachments, when get_ticket is called, then attachments lists id, name, media_type and size", async () => {
    const ctx = await ctxOf();
    const a = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "maquette.png",
      bytes: PNG,
    });
    const b = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "notes.csv",
      bytes: "a,b\n",
    });

    const ticket = dataOf<{ attachments: unknown[] }>(
      await callTool(ctx.app, ctx.alice.secret, "get_ticket", {
        ticket_id: ctx.ticketId,
      }),
    );

    expect(ticket.attachments).toEqual([
      {
        id: a.id,
        name: "maquette.png",
        media_type: "image/png",
        size: PNG.length,
      },
      { id: b.id, name: "notes.csv", media_type: "text/csv", size: 4 },
    ]);
  });

  it("given a ticket without attachment, when get_ticket is called, then attachments is an empty list", async () => {
    const ctx = await ctxOf();

    const ticket = dataOf<{ attachments: unknown[] }>(
      await callTool(ctx.app, ctx.alice.secret, "get_ticket", {
        ticket_id: ctx.ticketId,
      }),
    );

    expect(ticket.attachments).toEqual([]);
  });

  it("given a ticket of an archived project, when get_ticket is called, then its attachments are listed", async () => {
    const ctx = await ctxOf();
    await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "a.png",
      bytes: PNG,
    });
    await archiveProject(ctx.db, ctx.projectId);

    const ticket = dataOf<{ attachments: unknown[] }>(
      await callTool(ctx.app, ctx.alice.secret, "get_ticket", {
        ticket_id: ctx.ticketId,
      }),
    );

    expect(ticket.attachments).toHaveLength(1);
  });

  it("given a ticket needing stories with two attachments and another with none, when list_tickets_needing_us is called, then each has its attachments_count", async () => {
    const ctx = await ctxOf();
    const bare = await makeTicket(ctx.app, ctx.cookie, ctx.projectId, {
      title: "Nu",
    });
    await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "a.png",
      bytes: PNG,
    });
    await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "b.txt",
      bytes: "b",
    });

    const { tickets } = dataOf<{
      tickets: { id: number; attachments_count: number }[];
    }>(
      await callTool(ctx.app, ctx.alice.secret, "list_tickets_needing_us", {}),
    );

    expect(
      Object.fromEntries(tickets.map((t) => [t.id, t.attachments_count])),
    ).toEqual({ [ctx.ticketId]: 2, [bare.id]: 0 });
  });
});

describe("061 H: get_attachment", () => {
  it("given an image, when get_attachment is called, then the result is an MCP image with the base64 bytes and the media type", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "photo.jpg",
      bytes: JPEG,
    });

    const { result, content } = await read(ctx, id);

    expect(result.isError).not.toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: "image",
      data: JPEG.toString("base64"),
      mimeType: "image/jpeg",
    });
  });

  it("given a text file, when get_attachment is called, then the result is its text as is", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "exemple.csv",
      bytes: "nom,âge\nMarie,31\n",
    });

    const { result, content } = await read(ctx, id);

    expect(result.isError).not.toBe(true);
    expect(content).toEqual([{ type: "text", text: "nom,âge\nMarie,31\n" }]);
  });

  it("given a PDF with a line of text, when get_attachment is called, then the result is the text extracted from its pages", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "retours.pdf",
      bytes: pdf("Bonjour le monde"),
    });

    const { result, content } = await read(ctx, id);

    expect(result.isError).not.toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Bonjour le monde");
  });

  it("given a PDF without text, when get_attachment is called, then it says the PDF has no readable text (probably scanned)", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "scan.pdf",
      bytes: pdf(),
    });

    const { result, content } = await read(ctx, id);

    expect(result.isError).not.toBe(true);
    expect(content).toEqual([{ type: "text", text: SCANNED }]);
  });

  it("given a text of 150 000 characters, when get_attachment is called, then the first 100 000 come back followed by (tronqué)", async () => {
    const ctx = await ctxOf();
    const text = `${"a".repeat(100_000)}${"b".repeat(50_000)}`;
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "long.txt",
      bytes: text,
    });

    const { content } = await read(ctx, id);

    const got = content[0]?.text ?? "";
    expect(got.startsWith("a".repeat(100_000))).toBe(true);
    expect(got).not.toContain("b");
    expect(got.slice(100_000)).toMatch(/^\s*\(tronqué\)\s*$/);
  });

  it("given a text of exactly 100 000 characters, when get_attachment is called, then it is not cut", async () => {
    const ctx = await ctxOf();
    const text = "é".repeat(100_000);
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "pile.txt",
      bytes: text,
    });

    const { content } = await read(ctx, id);

    expect(content[0]?.text).toBe(text);
  });

  it("given an attachment of an archived project, when get_attachment is called, then it is read", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "a.txt",
      bytes: "lisible",
    });
    await archiveProject(ctx.db, ctx.projectId);

    const { content } = await read(ctx, id);

    expect(content).toEqual([{ type: "text", text: "lisible" }]);
  });

  it("given an attachment of another user's project, when get_attachment is called, then it is refused and nothing of the file comes back", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "secret.txt",
      bytes: "mot de passe: hunter2",
    });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const bobProject = await seedProject(ctx.db, bob.id, {
      githubRepoId: 2,
      fullName: "user2000/app",
    });
    await seedTicket(ctx.db, bobProject, "Le ticket de Bob");

    const { result } = await read(ctx, id, bob.secret);

    expect(expectRefused(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("given an id that does not exist, when get_attachment is called, then it is refused", async () => {
    const ctx = await ctxOf();

    expectRefused((await read(ctx, 99999)).result);
  });

  it("given arguments that do not fit, when get_attachment is called, then it is refused", async () => {
    const ctx = await ctxOf();

    for (const args of [{}, { attachment_id: "x" }, { attachment_id: 0 }])
      expectRefused(
        await callTool(ctx.app, ctx.alice.secret, "get_attachment", args),
      );
  });

  it("given a read, when the history is read, then one entry get_attachment carries only { attachmentId } with the project and the ticket", async () => {
    const ctx = await ctxOf();
    const { id } = await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "notes.txt",
      bytes: "notes",
    });

    await read(ctx, id);

    const entry = await onlyEntry(ctx.db);
    expect(entry).toMatchObject({
      origin: "mcp",
      actor: "claude",
      action: "get_attachment",
      result: "ok",
      project_id: ctx.projectId,
      ticket_id: ctx.ticketId,
      args: { attachmentId: id },
    });
    expect(Object.keys(entry.args)).toEqual(["attachmentId"]);
    expect(JSON.stringify(entry)).not.toContain("notes.txt");
  });

  it("given a refused read, when the history is read, then the refusal is journaled once and holds no file name", async () => {
    const ctx = await ctxOf();
    await attach(ctx.app, ctx.cookie, ctx.ticketId, {
      name: "x.txt",
      bytes: "x",
    });

    await read(ctx, 99999);

    const entries = await mcpRows(ctx.db);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "get_attachment",
      result: "refused",
    });
  });
});

describe("061 H: tools/list", () => {
  it("given a token, when tools/list is posted, then get_attachment is there, requires attachment_id and its description warns about the 100,000 characters cut", async () => {
    const { app, alice } = await withProject();

    const tools = await listedTools(app, alice.secret);

    expect(tools).toHaveLength(24);
    const tool = tools.find((t) => t.name === "get_attachment");
    expect(tool?.inputSchema?.required).toEqual(["attachment_id"]);
    expect(tool?.description).toMatch(/100[, ]?000/);
    expect(tool?.description).toMatch(/truncat/i);
  });
});
