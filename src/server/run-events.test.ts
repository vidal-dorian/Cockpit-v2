// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { withStory } from "./test-decisions.ts";
import { callTool, dataOf, seedProject, userWithToken } from "./test-mcp.ts";

// Slice 7.1 (decision 033 G): GET /api/events, the SSE stream of a session. Each event is named `change` and its
// data is the key of the object that changed (`run:12`, `story:42`).

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Reads the stream until `done(text)` or the timeout, then cancels it. */
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

describe("criterion 7: GET /api/events", () => {
  it("given no session, when /api/events is called, then 401", async () => {
    const s = await withStory("ready");

    expect((await s.app.request("/api/events")).status).toBe(401);
  });

  it("given a session, when /api/events is called, then it is a text/event-stream", async () => {
    const s = await withStory("ready");

    const res = await s.app.request("/api/events", {
      headers: { cookie: s.alice.cookie },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await res.body?.cancel();
  });

  it("given an open stream, when Claude calls start_run then report_step, then it receives change run:<id> and change story:<id>", async () => {
    const s = await withStory("ready");
    const res = await s.app.request("/api/events", {
      headers: { cookie: s.alice.cookie },
    });

    const { run_id } = dataOf<{ run_id: number }>(
      await callTool(s.app, s.alice.secret, "start_run", {
        story_id: s.id,
        branch: "us/42-login",
        model: "claude-x",
      }),
    );
    dataOf(
      await callTool(s.app, s.alice.secret, "report_step", {
        run_id,
        agent: "developer",
        event: "started",
      }),
    );
    const text = await readUntil(
      res,
      (t) => has(t, `run:${run_id}`) && has(t, `story:${s.id}`),
    );

    expect(has(text, `run:${run_id}`), text).toBe(true);
    expect(has(text, `story:${s.id}`), text).toBe(true);
  });

  it("given the stream of a user who is not a member of the project, when a run starts, then nothing is received", async () => {
    const s = await withStory("ready");
    const bob = await userWithToken(s.app, s.db, 2000);
    await seedProject(s.db, bob.id, { githubRepoId: 2, fullName: "bob/app" });
    const res = await s.app.request("/api/events", {
      headers: { cookie: bob.cookie },
    });

    dataOf(
      await callTool(s.app, s.alice.secret, "start_run", {
        story_id: s.id,
        branch: "us/42-login",
        model: "claude-x",
      }),
    );
    const text = await readUntil(res, (t) => /event: change/.test(t), 300);

    expect(text).not.toMatch(/event: change/);
  });
});
