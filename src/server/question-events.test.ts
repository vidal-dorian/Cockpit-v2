// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerRoute, asked, running, withQuestion } from "./test-questions.ts";

// Slice 7.4, criterion 6 (decision 036 G, 033 G): ask_user and the human answer tell the members' streams run:<id>.
// The run is started (and the question asked, for the answer) before the stream opens.

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
  it("given an open stream, when Claude calls ask_user, then it receives change run:<id>", async () => {
    const s = await running();
    const res = await s.app.request("/api/events", {
      headers: { cookie: s.alice.cookie },
    });

    await asked(s);

    const text = await readUntil(res, (t) => has(t, `run:${s.runId}`));
    expect(has(text, `run:${s.runId}`), text).toBe(true);
  });

  it("given an open stream, when the human answers, then it receives change run:<id>", async () => {
    const s = await withQuestion();
    const res = await s.app.request("/api/events", {
      headers: { cookie: s.alice.cookie },
    });

    const answered = await answerRoute(s.app, s.alice.cookie, s.questionId);
    expect(answered.status).toBe(200);

    const text = await readUntil(res, (t) => has(t, `run:${s.runId}`));
    expect(has(text, `run:${s.runId}`), text).toBe(true);
  });
});
