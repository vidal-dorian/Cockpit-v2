import { Worker } from "node:worker_threads";

const TIMEOUT_MS = 8_000;

/** The text of a PDF (at least `limit` characters when it has that many), or undefined when it cannot be read: corrupt, encrypted, too heavy or too slow. The work is done in a worker with a memory limit and a timeout, so a hostile file cannot take the server down. */
export function pdfText(bytes: Uint8Array, limit: number) {
  return new Promise<string | undefined>((resolve) => {
    // A copy: the worker gets its own buffer, and a Buffer may share a pool.
    const data = new Uint8Array(bytes);
    const worker = new Worker(new URL("./pdf-worker.ts", import.meta.url), {
      workerData: { data, limit },
      transferList: [data.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const done = (text?: string) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(text);
    };
    const timer = setTimeout(done, TIMEOUT_MS);
    worker.once("message", (m: { text?: string }) => done(m.text));
    worker.once("error", () => done());
    worker.once("exit", () => done());
  });
}
