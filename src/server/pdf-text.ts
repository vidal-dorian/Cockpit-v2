import { fork } from "node:child_process";
import { readFile } from "node:fs/promises";

const TIMEOUT_MS = 8_000;
const RSS_BUDGET = 384 * 1024 * 1024;
const POLL_MS = 50;

/** One extraction at a time: how many run now, and the most there ever were (the tests read it). */
export const pdfStats = { active: 0, maxActive: 0 };

/** Resident memory of a process, or 0 where /proc does not exist. shortcut: Linux only, elsewhere only the timeout and --max-old-space-size bound the child; upgrade if Cockpit runs off Linux. */
async function rssOf(pid: number) {
  try {
    // VmRSS is in kB whatever the page size (a Pi 5 kernel uses 16 KiB pages: statm would read a quarter).
    const kb = /^VmRSS:\s+(\d+) kB$/m.exec(
      await readFile(`/proc/${pid}/status`, "utf8"),
    )?.[1];
    return Number(kb ?? 0) * 1024;
  } catch {
    return 0;
  }
}

function extract(bytes: Uint8Array, limit: number) {
  return new Promise<string | undefined>((resolve) => {
    pdfStats.maxActive = Math.max(pdfStats.maxActive, ++pdfStats.active);
    // Own execArgv: nothing of the test runner is inherited. A copy goes over IPC (structured clone).
    const child = fork(new URL("./pdf-worker.ts", import.meta.url), {
      execArgv: ["--max-old-space-size=256"],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let over = false;
    const done = (text?: string) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      clearInterval(poll);
      // Whatever the outcome the child dies, so the OS takes its memory back.
      child.kill("SIGKILL");
      pdfStats.active--;
      resolve(text);
    };
    const timer = setTimeout(done, TIMEOUT_MS);
    const poll = setInterval(async () => {
      if (child.pid && (await rssOf(child.pid)) > RSS_BUDGET) done();
    }, POLL_MS);
    child.once("message", (m: { text?: string }) => done(m.text));
    child.once("error", () => done());
    child.once("exit", () => done());
    child.send({ data: new Uint8Array(bytes), limit });
  });
}

let queue: Promise<unknown> = Promise.resolve();

/** The text of a PDF (more than `limit` characters when it has that many), or undefined when it cannot be read: corrupt, encrypted, too heavy or too slow. Done in a child process killed above a memory budget or a delay, so a hostile file cannot take the server down. */
export function pdfText(bytes: Uint8Array, limit: number) {
  const run = queue.then(() => extract(bytes, limit));
  // A failed run never blocks the ones behind it.
  queue = run.catch(() => {});
  return run;
}
