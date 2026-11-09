import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routines, webhookDeliveries } from "./db/schema.ts";
import {
  countOf,
  fingerprints,
  signInAgain,
  stubSignIn,
  withLife,
} from "./test-data.ts";
import { send } from "./test-decisions.ts";
import { createAdminWithSession } from "./test-instance.ts";
import { withProject } from "./test-mcp.ts";
import { stubSharing } from "./test-members.ts";
import { ownMore, planOf } from "./test-plans.ts";

// Review of slice 13.5: the amended 078 C (runs on others' projects stay, anonymised), the leftovers of a deletion, and 078 E's accumulation.

afterEach(() => {
  vi.unstubAllGlobals();
});

const del = (app: Parameters<typeof send>[0], cookie: string, login: string) =>
  send(app, cookie, "DELETE", "/api/me", { login });

describe("078 C: what a deletion leaves to the others", () => {
  it("given a run of hers on Carol's project, when she deletes, then Carol keeps it with no launcher, its steps, questions and the criterion's result", async () => {
    const ctx = await withLife();

    expect((await del(ctx.app, ctx.alice.cookie, "user1000")).status).toBe(200);

    const run = (await ctx.db.execute(
      sql`select user_id from runs where id = ${ctx.carolRunId}`,
    )) as unknown as { rows: { user_id: number | null }[] };
    expect(run.rows).toEqual([{ user_id: null }]);
    expect(
      await countOf(ctx.db, "run_steps", `run_id = ${ctx.carolRunId}`),
    ).toBe(1);
    expect(
      await countOf(ctx.db, "questions", `run_id = ${ctx.carolRunId}`),
    ).toBe(1);
    expect(
      await countOf(
        ctx.db,
        "acceptance_criteria",
        `result_run_id = ${ctx.carolRunId}`,
      ),
    ).toBe(1);
  });

  it("given other members' routines and the repo's webhook deliveries, when she deletes, then the deleted projects leave the routines and the deliveries go", async () => {
    const ctx = await withLife();
    const [repo] = (
      (await ctx.db.execute(
        sql`select github_repo_id from projects where id = ${ctx.projectId}`,
      )) as unknown as { rows: { github_repo_id: number }[] }
    ).rows;
    await ctx.db.insert(webhookDeliveries).values([
      { id: "d1", event: "push", repoId: repo?.github_repo_id, payload: {} },
      { id: "d2", event: "push", repoId: 5, payload: {} },
    ]);
    await ctx.db.insert(routines).values({
      userId: ctx.carol.id,
      name: "Routine de Carol",
      instruction: "regarde",
      agents: [],
      projectIds: [ctx.projectId, ctx.otherId],
      frequency: "on_demand",
      timeZone: "UTC",
    });

    await del(ctx.app, ctx.alice.cookie, "user1000");

    const left = (await ctx.db.execute(
      sql`select project_ids from routines`,
    )) as unknown as { rows: { project_ids: number[] }[] };
    expect(left.rows).toEqual([{ project_ids: [ctx.otherId] }]);
    expect(await countOf(ctx.db, "webhook_deliveries")).toBe(1);
  });
});

describe("078 E: the kept count accumulates", () => {
  it("given a return and a second deletion, when the account owns more or fewer repos, then the kept count adds up and never drops", async () => {
    const ctx = await withProject();
    await ownMore(ctx.db, ctx.alice.id, 1);
    await del(ctx.app, ctx.alice.cookie, "user1000");
    expect((await fingerprints(ctx.db))[0]?.repos_used).toBe(2);
    stubSignIn(1000, "user1000");

    // Back with no repo: the 2 are still counted, and deleting again keeps 2.
    let cookie = await signInAgain(ctx.app);
    expect(await planOf(ctx.app, cookie)).toMatchObject({ repos: 2 });
    await del(ctx.app, cookie, "user1000");
    expect((await fingerprints(ctx.db))[0]?.repos_used).toBe(2);

    // Back with one repo: 2 + 1 are used, and the next deletion keeps 3.
    cookie = await signInAgain(ctx.app);
    const [{ id }] = (
      (await ctx.db.execute(
        sql`select id from users where github_id = 1000`,
      )) as unknown as { rows: { id: number }[] }
    ).rows as [{ id: number }];
    await ownMore(ctx.db, id, 1);
    expect(await planOf(ctx.app, cookie)).toMatchObject({ repos: 3 });
    await del(ctx.app, cookie, "user1000");
    expect(await fingerprints(ctx.db)).toHaveLength(1);
    expect((await fingerprints(ctx.db))[0]?.repos_used).toBe(3);
  });

  it("given an archived project, when she deletes, then it counts among the repos used", async () => {
    const ctx = await withProject();
    await ctx.db.execute(sql`update projects set archived_at = now()`);

    await del(ctx.app, ctx.alice.cookie, "user1000");

    expect((await fingerprints(ctx.db))[0]?.repos_used).toBe(1);
  });
});

describe("078 F: the login typed by the administrator", () => {
  it("given a login with a leading @, when it is erased, then it is read as the login; a malformed one is a 400", async () => {
    const ctx = await withProject();
    await del(ctx.app, ctx.alice.cookie, "user1000");
    stubSharing({ users: { user1000: 1000 } });
    const boss = await createAdminWithSession(ctx.db, 99);
    const erase = (login: string) =>
      send(ctx.app, boss.cookie, "POST", "/api/settings/fingerprints/erase", {
        login,
      });

    expect((await erase("../orgs")).status).toBe(400);
    expect((await erase("@user1000")).status).toBe(200);
    expect(await fingerprints(ctx.db)).toEqual([]);
  });
});
