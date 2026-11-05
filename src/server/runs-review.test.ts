import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validate, withStory } from "./test-decisions.ts";
import { callTool, dataOf, expectRefused, rows } from "./test-mcp.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const startArgs = (id: number, over: Record<string, unknown> = {}) => ({
  story_id: id,
  branch: "us/42-login",
  model: "claude-x",
  ...over,
});

describe("review of slice 7.1", () => {
  it("given a NUL character in model, when start_run is called, then it is refused invalid_arguments", async () => {
    const s = await withStory("ready");

    expectRefused(
      await callTool(
        s.app,
        s.alice.secret,
        "start_run",
        startArgs(s.id, { model: "a\u0000b" }),
      ),
    );

    const [entry] = await rows(s.db, sql`origin = 'mcp'`);
    expect(entry?.detail).toMatchObject({ reason: "invalid_arguments" });
  });

  it("given a published story, when a run starts then finishes, then its issue follows the status", async () => {
    const s = await withStory("to_validate");
    expect((await validate(s.app, s.alice.cookie, s.id)).status).toBe(200);
    const labels = () => s.fetchMock.issues(REPO)[0]?.labels;
    expect(labels()).toEqual(["cockpit: prête"]);

    const { run_id } = dataOf<{ run_id: number }>(
      await callTool(s.app, s.alice.secret, "start_run", startArgs(s.id)),
    );
    expect(labels()).toEqual(["cockpit: en cours"]);

    dataOf(
      await callTool(s.app, s.alice.secret, "finish_run", {
        run_id,
        outcome: "failed",
        summary: "x",
      }),
    );
    expect(labels()).toEqual(["cockpit: prête"]);
  });
});
