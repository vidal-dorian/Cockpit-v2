// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { running, runRoute } from "./test-run-controls.ts";

// Slice 7.5, criterion 6 (decision 037 G): stop and close tell the members' streams run:<id> and story:<id>.

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readUntil(
  res: Response,
  done: (text: string) => boolean,
  ms = 2000,
) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  try {
    while (!done(text)) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), left)),
      ]);
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

const has = (text: string, data: string) =>
  new RegExp(`event: change\\r?\\ndata: ${data}\\r?\\n`).test(text);

describe("criterion 6: SSE", () => {
  it.each(["stop", "close"] as const)(
    "given an open stream, when the member calls %s, then it receives change run:<id> and story:<id>",
    async (action) => {
      const s = await running();
      const res = await s.app.request("/api/events", {
        headers: { cookie: s.alice.cookie },
      });

      const done = await runRoute(s.app, s.alice.cookie, s.runId, action);
      expect(done.status).toBe(200);

      const text = await readUntil(
        res,
        (t) => has(t, `run:${s.runId}`) && has(t, `story:${s.id}`),
      );
      expect(has(text, `run:${s.runId}`), text).toBe(true);
      expect(has(text, `story:${s.id}`), text).toBe(true);
    },
  );
});
