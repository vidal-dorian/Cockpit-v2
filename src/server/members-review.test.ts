import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMembers, queueItems } from "./db/schema.ts";
import { send, withStory } from "./test-decisions.ts";
import { diverge, entriesOf, publishedStory } from "./test-issue-edit.ts";
import {
  callTool,
  dataOf,
  mcpRows,
  seedProject,
  setup,
  userWithToken,
} from "./test-mcp.ts";
import { invite, memberWith, stubSharing } from "./test-members.ts";

// Slice 13.1, the review of decision 076 (B, F, A amended): lowering a role empties the queue, a launched run reports to its
// end, the owner is who a GitHub delivery belongs to, and an archived project takes no invitation.

afterEach(() => {
  vi.unstubAllGlobals();
});

const patch = (
  s: Awaited<ReturnType<typeof withStory>>,
  userId: number,
  role: string,
) =>
  send(
    s.app,
    s.alice.cookie,
    "PATCH",
    `/api/projects/${s.projectId}/members/${userId}`,
    { role },
  );

describe("076 F: lowering a role below can_launch empties the queue of that project", () => {
  it.each([
    ["read_only", 0],
    ["can_validate", 0],
    ["can_launch", 1],
  ])(
    "given a queued story, when the role becomes %s, then %i item stays",
    async (role, left) => {
      const s = await withStory("ready");
      const bob = await memberWith(s, 2000, "can_launch");
      await s.db
        .insert(queueItems)
        .values({ userId: bob.id, storyId: s.base, position: 1 });

      expect((await patch(s, bob.id, role)).status).toBe(200);

      expect(await s.db.select().from(queueItems)).toHaveLength(left);
    },
  );
});

describe("076 B: a launched run reports to its end", () => {
  it.each(["removed", "read_only"])(
    "given Bob who started a run, when he is %s, then report_step and finish_run still work",
    async (change) => {
      const s = await withStory("ready");
      const bob = await memberWith(s, 2000, "can_launch");
      const started = dataOf<{ run_id: number }>(
        await callTool(s.app, bob.secret, "start_run", {
          story_id: s.base,
          branch: "us/1-x",
          model: "claude-x",
        }),
      );
      if (change === "removed")
        await send(
          s.app,
          s.alice.cookie,
          "DELETE",
          `/api/projects/${s.projectId}/members/${bob.id}`,
        );
      else await patch(s, bob.id, "read_only");

      const step = await callTool(s.app, bob.secret, "report_step", {
        run_id: started.run_id,
        agent: "developer",
        event: "started",
      });
      const done = await callTool(s.app, bob.secret, "finish_run", {
        run_id: started.run_id,
        outcome: "failed",
        summary: "stopped",
      });

      expect([step.isError, done.isError]).toEqual([undefined, undefined]);
      expect(
        (await mcpRows(s.db)).filter((r) => r.result === "refused"),
      ).toEqual([]);
    },
  );
});

describe("076 H: a delivery belongs to the owner", () => {
  it("given a guest whose row comes first, when GitHub delivers an event, then its entry is the owner's", async () => {
    // The guest has the lower user id and, below, the first row: a join without a role filter meets him first.
    const ctx = await setup({ account: 1000 });
    const guest = await userWithToken(ctx.app, ctx.db, 2000);
    const alice = await userWithToken(ctx.app, ctx.db, 1000);
    const projectId = await seedProject(ctx.db, alice.id, {
      githubRepoId: 1,
      fullName: "user1000/app",
    });
    await ctx.db
      .insert(projectMembers)
      .values({ projectId, userId: guest.id, role: "read_only" });
    // The owner's row is written again after the guest's: it comes last in the table, whatever the plan.
    await ctx.db.execute(sql`delete from project_members where role = 'owner'`);
    await ctx.db
      .insert(projectMembers)
      .values({ projectId, userId: alice.id, role: "owner" });
    const s = { ...ctx, alice };
    const body = JSON.stringify({
      action: "opened",
      repository: { id: 1 },
      installation: { id: 1 },
    });

    await s.app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`,
        "x-github-delivery": "d-1",
        "x-github-event": "issues",
      },
      body,
    });

    const found = await s.db.execute(
      sql`select user_id from history where action = 'receive_webhook'`,
    );
    expect(
      (found as unknown as { rows: { user_id: number }[] }).rows.map(
        (r) => r.user_id,
      ),
    ).toEqual([s.alice.id]);
  });
});

describe("076 H: an issue edited on GitHub belongs to the owner", () => {
  it("given a guest whose row comes first, when an issue is edited, then the entry of the divergence is the owner's", async () => {
    const s = await publishedStory();
    const guest = await userWithToken(s.app, s.db, 2000);
    await s.db
      .insert(projectMembers)
      .values({ projectId: s.projectId, userId: guest.id, role: "read_only" });
    await s.db.execute(sql`delete from project_members where role = 'owner'`);
    await s.db
      .insert(projectMembers)
      .values({ projectId: s.projectId, userId: s.alice.id, role: "owner" });

    await diverge(s, { title: "Un autre titre" });

    expect(
      (await entriesOf(s.db, "issue_diverged")).map((e) => e.user_id),
    ).toEqual([s.alice.id]);
  });
});

describe("076 A: a role only offers what it may launch", () => {
  it("given a read_only member with the shared project ticked, when he reads the night, then nothing is ready for him", async () => {
    const s = await withStory("ready");
    const bob = await memberWith(s, 2000, "read_only");
    await s.db.execute(
      sql`update project_members set in_launcher = true where user_id = ${bob.id}`,
    );

    const res = await send(s.app, bob.cookie, "GET", "/api/nights/current");

    expect(
      ((await res.json()) as { ready: unknown[]; toValidate: unknown[] }).ready,
    ).toEqual([]);
  });
});

describe("076 A, S6: workflow help is the owner's, an archived project takes no invitation", () => {
  it("given a can_launch member, when he asks Claude about a workflow, then 403 role", async () => {
    const s = await withStory("ready");
    const bob = await memberWith(s, 2000, "can_launch");

    const res = await send(
      s.app,
      bob.cookie,
      "POST",
      `/api/projects/${s.projectId}/workflows/ask`,
      { path: ".github/workflows/ci.yml" },
    );

    expect([res.status, await res.json()]).toEqual([403, { error: "role" }]);
  });

  it("given an archived project, when the owner invites, then 409 project_archived", async () => {
    const s = await withStory("ready");
    stubSharing({ users: { paul: 4000 } });
    await s.db.execute(sql`update projects set archived_at = now()`);

    const res = await invite(s, s.alice.cookie, s.projectId, {
      login: "paul",
      role: "read_only",
    });

    expect([res.status, await res.json()]).toEqual([
      409,
      { error: "project_archived" },
    ]);
  });
});
