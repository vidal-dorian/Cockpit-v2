// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRANCH,
  criterionIds,
  link,
  REPO,
  report,
  running,
} from "./test-criteria.ts";
import { dataOf } from "./test-mcp.ts";

// Slice 7.3, criterion 7 (decision 035 F, 033 G): the two new tools tell the members' streams. The run is started
// before the stream opens, since start_run publishes the same keys.

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

const opened = async () => {
  const s = await running();
  const res = await s.app.request("/api/events", {
    headers: { cookie: s.alice.cookie },
  });
  return { s, res };
};
const expectKeys = async (res: Response, runId: number, storyId: number) => {
  const text = await readUntil(
    res,
    (t) => has(t, `run:${runId}`) && has(t, `story:${storyId}`),
  );
  expect(has(text, `run:${runId}`), text).toBe(true);
  expect(has(text, `story:${storyId}`), text).toBe(true);
};

describe("criterion 7: SSE", () => {
  it("given an open stream, when Claude calls report_criterion, then it receives change run:<id> and change story:<id>", async () => {
    const { s, res } = await opened();
    const [first] = await criterionIds(s.db, s.id);

    dataOf(
      await report(s, {
        run_id: s.runId,
        criterion_id: first,
        result: "passed",
        evidence: "preuve",
      }),
    );

    await expectKeys(res, s.runId, s.id);
  });

  it("given an open stream, when Claude calls link_pull_request, then it receives change run:<id> and change story:<id>", async () => {
    const { s, res } = await opened();
    s.fetchMock.addPull(REPO, 12, BRANCH);

    dataOf(await link(s, { run_id: s.runId, pr_number: 12 }));

    await expectKeys(res, s.runId, s.id);
  });
});
