import { describe, expect, it } from "vitest";
import {
  attach,
  encryptedPdf,
  pdf,
  streamPdf,
  textOps,
} from "./test-attachments.ts";
import { callTool, withProject } from "./test-mcp.ts";
import { makeTicket } from "./test-tickets.ts";

// Slice 11.4, decision 058 H, review finding B1: reading a PDF must never crash or freeze the server, whatever the file.
//
// Pinned choices (the decision leaves them open):
// - The text of a PDF is extracted in a worker thread with a memory limit and a timeout (the tests cannot see the worker: they assert the outcome,
//   and that the next call right after still works, so the server is alive and not stuck).
// - A PDF that cannot be read (a « bomb » whose content stream inflates to hundreds of MB, a corrupt file, an encrypted one, a read that exceeds the timeout)
//   gives a NORMAL tool result (not isError) holding exactly « Ce PDF n'a pas pu être lu (trop lourd ou endommagé). », never the generic failure that invites a retry.
// - Extraction stops once 100 000 characters are collected: a PDF of thousands of pages gives the first 100 000 characters then « (tronqué) », without reading the later pages.
// - 10 000 pages (about 5 s to read 4 000, and reading all of them can exhaust memory) must answer in under 8 s (reading them all takes about 16 s; the margin is for a busy machine): only the first pages are read. A bomb answers within 20 s here (a real limit is much smaller), and the history keeps one ok entry for it as for any read.

const UNREADABLE = "Ce PDF n'a pas pu être lu (trop lourd ou endommagé).";

const ctxOf = async () => {
  const ctx = await withProject();
  const ticket = await makeTicket(ctx.app, ctx.alice.cookie, ctx.projectId);
  return { ...ctx, ticketId: ticket.id };
};
type Ctx = Awaited<ReturnType<typeof ctxOf>>;
const read = async (ctx: Ctx, name: string, bytes: Buffer) => {
  const { id } = await attach(ctx.app, ctx.alice.cookie, ctx.ticketId, {
    name,
    bytes,
  });
  const started = Date.now();
  const result = await callTool(ctx.app, ctx.alice.secret, "get_attachment", {
    attachment_id: id,
  });
  return { result, ms: Date.now() - started };
};
const stillWorks = async (ctx: Ctx) => {
  const { result } = await read(ctx, "apres.pdf", pdf("Bonjour le monde"));
  expect(result.isError).not.toBe(true);
  expect(result.content[0]?.text).toContain("Bonjour le monde");
};

describe("058 H (B1): a PDF that cannot be read", () => {
  it("given a bomb PDF (a small file whose content inflates to 300 MB), when get_attachment is called, then the fixed sentence comes back as a normal result in time, and the next call works", async () => {
    const ctx = await ctxOf();
    const bomb = streamPdf([textOps(10_000_000)]);
    expect(bomb.length, "a small file").toBeLessThan(2 * 1024 * 1024);

    const { result, ms } = await read(ctx, "bombe.pdf", bomb);

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: UNREADABLE }]);
    expect(ms).toBeLessThan(20_000);
    await stillWorks(ctx);
  }, 60_000);

  it("given a PDF of 10 000 pages, when get_attachment is called, then it stops at 100 000 characters with (tronqué), quickly, and the next call works", async () => {
    const ctx = await ctxOf();
    const page = Buffer.from(
      `BT /F1 12 Tf 72 720 Td (${"hello world ".repeat(200)}) Tj ET`,
    );
    const many = streamPdf(Array.from({ length: 10_000 }, () => page));

    const { result, ms } = await read(ctx, "gros.pdf", many);

    expect(result.isError).not.toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text.slice(0, 11)).toBe("hello world");
    expect(text.slice(100_000)).toMatch(/^\s*\(tronqué\)\s*$/);
    expect(ms, `took ${ms} ms`).toBeLessThan(8_000);
    await stillWorks(ctx);
  }, 60_000);

  it("given a corrupt PDF (%PDF- then garbage), when get_attachment is called, then the fixed sentence comes back as a normal result", async () => {
    const ctx = await ctxOf();

    const { result } = await read(
      ctx,
      "casse.pdf",
      Buffer.concat([
        Buffer.from("%PDF-1.7\n"),
        Buffer.from("garbage ".repeat(500)),
      ]),
    );

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: UNREADABLE }]);
    await stillWorks(ctx);
  });

  it("given an encrypted PDF, when get_attachment is called, then the fixed sentence comes back as a normal result", async () => {
    const ctx = await ctxOf();

    const { result } = await read(ctx, "chiffre.pdf", encryptedPdf());

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: UNREADABLE }]);
    await stillWorks(ctx);
  });
});
