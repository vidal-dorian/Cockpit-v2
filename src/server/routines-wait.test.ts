import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import {
  DUE,
  pass,
  ready,
  routineCall,
  routineOf,
  sqlRows,
} from "./test-launcher.ts";
import { callTool, dataOf } from "./test-mcp.ts";

// Slice 14.2 review: a routine met by a running passage keeps its turn; a launch that cannot find its repository fails the passage.

afterEach(() => {
  vi.unstubAllGlobals();
});

it("given a passage running, when a second routine of the user is due, then its next run is not moved", async () => {
  const ctx = await ready();
  await routineOf(ctx);
  const second = await routineOf(ctx, { name: "Deuxième" });

  await pass(ctx, DUE);

  const [row] = await sqlRows<{ next_run_at: string }>(
    ctx,
    sql`select next_run_at from routines where id = ${second}`,
  );
  expect(new Date(row?.next_run_at ?? "").toISOString()).toBe(
    "2026-11-08T12:00:00.000Z",
  );
});

it("given a routine launch, when Claude reports repository_not_in_task, then the passage is failed with that summary", async () => {
  const ctx = await ready();
  const id = await routineOf(ctx);
  const { launchId } = (await (
    await routineCall(ctx, "POST", id, "/run")
  ).json()) as { launchId: number };

  dataOf(
    await callTool(ctx.app, ctx.alice.secret, "report_launch", {
      launch_id: launchId,
      reason: "repository_not_in_task",
    }),
  );

  const [row] = await sqlRows<{ outcome: string; summary: string }>(
    ctx,
    sql`select outcome, summary from cloud_launches`,
  );
  expect(row).toEqual({
    outcome: "failed",
    summary: "repository_not_in_task",
  });
});
