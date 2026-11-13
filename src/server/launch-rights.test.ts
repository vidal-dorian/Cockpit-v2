import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoutine,
  DUE,
  launches,
  NOW,
  pass,
  queued,
  readQueue,
  ready,
} from "./test-launcher.ts";
import { rows } from "./test-mcp.ts";
import { ownMore } from "./test-plans.ts";

// Security audit: the unattended launches (queue, night, routines, CI relaunch, answer) check the role and the plan lock as the buttons do (decisions 076 A, 077 E).

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unattended launches and the rights of their launcher", () => {
  it("given a queued story in a project the Free plan of its owner locks, when the pass runs, then nothing is fired, the story leaves the queue and a plan refusal is journaled", async () => {
    const ctx = await ready();
    await queued(ctx, 1);
    await ownMore(ctx.db, ctx.alice.id, 3);

    await pass(ctx, NOW);

    expect(ctx.calls).toHaveLength(0);
    expect(await launches(ctx)).toHaveLength(0);
    expect((await readQueue(ctx)).items).toEqual([]);
    expect(
      await rows(
        ctx.db,
        sql`action = 'launch_story' and result = 'refused' and detail->>'reason' = 'plan'`,
      ),
    ).toHaveLength(1);
  });

  it("given a queued story whose launcher is now below « peut lancer », when the pass runs, then nothing is fired and a role refusal is journaled", async () => {
    const ctx = await ready();
    await queued(ctx, 1);
    await ctx.db.execute(
      sql`update project_members set role = 'can_validate' where user_id = ${ctx.alice.id} and project_id = ${ctx.projectId}`,
    );

    await pass(ctx, NOW);

    expect(ctx.calls).toHaveLength(0);
    expect(
      await rows(
        ctx.db,
        sql`action = 'launch_story' and result = 'refused' and detail->>'reason' = 'role'`,
      ),
    ).toHaveLength(1);
  });

  it("given a routine on a project the Free plan of its owner now locks, when it is due, then it is not fired", async () => {
    const ctx = await ready();
    expect((await createRoutine(ctx)).status).toBe(201);
    await ownMore(ctx.db, ctx.alice.id, 3);

    await pass(ctx, DUE);

    expect(ctx.calls).toHaveLength(0);
    expect(
      await rows(
        ctx.db,
        sql`action = 'fire_routine' and result = 'refused' and detail->>'reason' = 'plan'`,
      ),
    ).toHaveLength(1);
  });
});
