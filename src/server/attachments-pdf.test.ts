import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as pdfModule from "./pdf-text.ts";
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

// Review, round 2 (an ArrayBuffer bomb): a worker thread's `maxOldGenerationSizeMb` does not bound ArrayBuffer memory, and a terminated worker does not give it back.
// - So the extraction runs in a CHILD PROCESS (child_process.fork), killed when its own RSS passes a budget or at the timeout. The test process must not grow:
//   its peak RSS (sampled every 25 ms during the call) stays less than 200 MB above its RSS before the call, for a PDF that inflates to 2 GB.
// - One extraction at a time. Observable through `pdfStats` exported by src/server/pdf-text.ts: { active: number, maxActive: number }, `active` counted while an extraction runs
//   (up on start, down when it ends, whatever the outcome), `maxActive` its high-water mark. The test resets both to 0, fires two get_attachment at once, and expects maxActive to be exactly 1.

// Typed loosely: the export does not exist before the fix, and typecheck must stay green.
const stats = () =>
  (
    pdfModule as unknown as {
      pdfStats: { active: number; maxActive: number };
    }
  ).pdfStats;

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

describe("058 H (round 2): a PDF must not grow the server's memory", () => {
  it("given a PDF whose content stream inflates to 2 GB of spaces (256 MB referenced 8 times), when get_attachment is called, then the fixed sentence comes back, this process's RSS grows by less than 200 MB, and the next call works", async () => {
    const ctx = await ctxOf();
    const inflated = deflateSync(Buffer.alloc(256 * 1024 * 1024, 0x20), {
      level: 9,
    });
    const content = `<< /Length ${inflated.length} /Filter /FlateDecode >>\nstream\n`;
    const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
    const offsets: number[] = [];
    const objs: (string | Buffer)[] = [
      "",
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents [${"4 0 R ".repeat(8)}] >>`,
      Buffer.concat([
        Buffer.from(content),
        inflated,
        Buffer.from("\nendstream"),
      ]),
    ];
    let at = (parts[0] as Buffer).length;
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = at;
      const b = Buffer.concat([
        Buffer.from(`${i} 0 obj\n`),
        Buffer.from(objs[i] as string | Buffer),
        Buffer.from("\nendobj\n"),
      ]);
      parts.push(b);
      at += b.length;
    }
    let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++)
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    parts.push(
      Buffer.from(
        `${xref}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`,
      ),
    );
    const file = Buffer.concat(parts);
    expect(file.length, "a small file").toBeLessThan(2 * 1024 * 1024);
    const { id } = await attach(ctx.app, ctx.alice.cookie, ctx.ticketId, {
      name: "memoire.pdf",
      bytes: file,
    });
    const before = process.memoryUsage().rss;
    let peak = before;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 25);

    const result = await callTool(ctx.app, ctx.alice.secret, "get_attachment", {
      attachment_id: id,
    }).finally(() => clearInterval(sampler));
    peak = Math.max(peak, process.memoryUsage().rss);

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: UNREADABLE }]);
    expect(
      (peak - before) / 1024 / 1024,
      "MB of RSS gained by this process during the call",
    ).toBeLessThan(200);
    await stillWorks(ctx);
  }, 90_000);

  it("given two get_attachment calls on PDFs at the same time, when they run, then both answer and never two extractions were active at once", async () => {
    const ctx = await ctxOf();
    expect(stats(), "pdf-text.ts exports pdfStats").toBeDefined();
    const ids = [
      await attach(ctx.app, ctx.alice.cookie, ctx.ticketId, {
        name: "un.pdf",
        bytes: pdf("Premier texte"),
      }),
      await attach(ctx.app, ctx.alice.cookie, ctx.ticketId, {
        name: "deux.pdf",
        bytes: pdf("Second texte"),
      }),
    ];
    stats().active = 0;
    stats().maxActive = 0;

    const results = await Promise.all(
      ids.map(({ id }) =>
        callTool(ctx.app, ctx.alice.secret, "get_attachment", {
          attachment_id: id,
        }),
      ),
    );

    expect(results[0]?.content[0]?.text).toContain("Premier texte");
    expect(results[1]?.content[0]?.text).toContain("Second texte");
    expect(stats().maxActive).toBe(1);
    expect(stats().active).toBe(0);
  });
});
