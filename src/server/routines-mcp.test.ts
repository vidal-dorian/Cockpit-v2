// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRANCH,
  type Ctx,
  launch,
  ready,
  routineCall,
  routineOf,
  sqlRows,
} from "./test-launcher.ts";
import {
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  rows,
  userWithToken,
} from "./test-mcp.ts";

// Slice 14.2 (decision 055 C, D, E, H): what Claude reads of a routine launch, how it finishes it, what it cannot do.
//
// Pinned where the decision leaves room:
// - get_launch of a routine answers { launch_id, kind: "routine", projects: [{ id, full_name, default_branch }], instructions };
//   a story launch answers kind "story" besides its 14.1 fields.
// - finish_launch answers { launch_id, outcome }; a refusal is journaled with detail { reason: <code> }.
// - mcp.test.ts lists the exact tools of the server: the developer must add finish_launch to it (not edited here).

afterEach(() => {
  vi.unstubAllGlobals();
});

const tool = (ctx: Ctx, name: string, args: unknown) =>
  callTool(ctx.app, ctx.alice.secret, name, args);

async function routineLaunch() {
  const ctx = await ready();
  const routineId = await routineOf(ctx);
  const res = await routineCall(ctx, "POST", routineId, "/run");
  expect(res.status, "running the routine for this test").toBe(201);
  const { launchId } = (await res.json()) as { launchId: number };
  return { ...ctx, routineId, launchId };
}
const finish = (
  ctx: Ctx,
  launchId: number,
  over: Record<string, unknown> = {},
) =>
  tool(ctx, "finish_launch", {
    launch_id: launchId,
    outcome: "succeeded",
    summary: "Fait",
    ...over,
  });
const lastReason = async (ctx: Ctx) =>
  (await mcpRows(ctx.db)).at(-1)?.detail?.reason;

describe("criterion 4: get_launch of a routine", () => {
  it("given a routine launch, when its owner calls get_launch, then it is kind routine with its projects and instructions naming the routine, the repositories, the instruction, the agents and finish_launch", async () => {
    const s = await routineLaunch();

    const data = dataOf<{
      kind: string;
      projects: unknown;
      instructions: string;
    }>(await tool(s, "get_launch", { launch_id: s.launchId }));

    expect(data.kind).toBe("routine");
    expect(data.projects).toEqual([
      { id: s.projectId, full_name: "user1000/app", default_branch: "main" },
    ]);
    for (const part of [
      "Nettoyage",
      "user1000/app",
      "Ranger les imports",
      "bug-hunter",
      "finish_launch",
    ])
      expect(data.instructions).toContain(part);
  });

  it("given a story launch, when get_launch is called, then it still answers as in 14.1, with kind story", async () => {
    const s = await ready();
    const { launchId } = (await (await launch(s)).json()) as {
      launchId: number;
    };

    const data = dataOf<Record<string, unknown>>(
      await tool(s, "get_launch", { launch_id: launchId }),
    );

    expect(data).toMatchObject({
      kind: "story",
      story_id: s.storyId,
      branch: BRANCH,
      project: { full_name: "user1000/app" },
    });
  });
});

describe("criterion 5: finish_launch", () => {
  it("given a routine launch, when its owner finishes it, then finished_at and outcome are set and the entry is claude / mcp with args { launchId, outcome }; a second call is refused launch_finished", async () => {
    const s = await routineLaunch();

    dataOf(await finish(s, s.launchId, { outcome: "failed" }));

    const [row] = await sqlRows<{
      finished_at: Date | null;
      outcome: string | null;
    }>(s, sql`select finished_at, outcome from cloud_launches`);
    expect(row?.finished_at).not.toBeNull();
    expect(row?.outcome).toBe("failed");
    const [entry] = await rows(s.db, sql`action = 'finish_launch'`);
    expect(entry).toMatchObject({
      user_id: s.alice.id,
      actor: "claude",
      origin: "mcp",
      args: { launchId: s.launchId, outcome: "failed" },
      result: "ok",
    });
    expectRefused(await finish(s, s.launchId));
    expect(await lastReason(s)).toBe("launch_finished");
  });

  it("given the launch of another user, when finish_launch is called, then it is refused not_found and the launch stays open", async () => {
    const s = await routineLaunch();
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(s.app, bob.secret, "finish_launch", {
        launch_id: s.launchId,
        outcome: "succeeded",
        summary: "x",
      }),
    );

    expect(await lastReason(s)).toBe("not_found");
    const [row] = await sqlRows<{ finished_at: Date | null }>(
      s,
      sql`select finished_at from cloud_launches`,
    );
    expect(row?.finished_at).toBeNull();
  });

  it("given a story launch, when finish_launch is called, then it is refused not_a_routine", async () => {
    const s = await ready();
    const { launchId } = (await (await launch(s)).json()) as {
      launchId: number;
    };

    expectRefused(await finish(s, launchId));

    expect(await lastReason(s)).toBe("not_a_routine");
  });

  it("given a bad outcome or a summary over 2000 characters, when finish_launch is called, then it is refused and the launch stays open", async () => {
    const s = await routineLaunch();

    expectRefused(await finish(s, s.launchId, { outcome: "maybe" }));
    expectRefused(await finish(s, s.launchId, { summary: "x".repeat(2001) }));

    const [row] = await sqlRows<{ finished_at: Date | null }>(
      s,
      sql`select finished_at from cloud_launches`,
    );
    expect(row?.finished_at).toBeNull();
  });
});

describe("criterion 6: the rights of the routines", () => {
  it("given the rights table (routines: the human only), when tools/list is read, then finish_launch is listed and no tool creates, changes, pauses or fires a routine", async () => {
    const s = await ready();

    const names = (await listedTools(s.app, s.alice.secret)).map((t) => t.name);

    expect(names).toContain("finish_launch");
    expect(names.filter((n) => /routine/i.test(n))).toEqual([]);
    for (const name of ["save_routine", "pause_routine", "fire_routine"])
      expect(expectRefused(await tool(s, name, {})), name).toMatch(
        /unknown tool/i,
      );
  });
});
