import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ready, submit } from "./test-code-map.ts";
import { send } from "./test-decisions.ts";
import { finding, submitFindings } from "./test-findings.ts";
import { callTool, expectRefused, rows, withProject } from "./test-mcp.ts";
import { memberWith } from "./test-members.ts";
import {
  admin,
  get,
  inDays,
  makePro,
  ownMore,
  planOf,
  revoke,
  travel,
} from "./test-plans.ts";
import { takeover } from "./test-takeover.ts";

// Slice 13.2 (decision 077 A to E, the contract is in test-plans.ts): who is Pro, the quota of 3 repos, the 4th repo refused,
// the read-only state after Pro, and the plan on the MCP tools. Alice (login user1000) is a Free account unless a test says otherwise.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const repo = (id: number, fullName: string, is_template = false) => ({
  id,
  full_name: fullName,
  default_branch: "main",
  private: false,
  is_template,
});

const importRepo = (
  ctx: Awaited<ReturnType<typeof withProject>>,
  githubRepoId: number,
) => send(ctx.app, ctx.alice.cookie, "POST", "/api/projects", { githubRepoId });

const refusedFor = async (ctx: Awaited<ReturnType<typeof withProject>>) =>
  (await rows(ctx.db, sql`result = 'refused'`)).filter(
    (r) => r.detail?.reason === "plan",
  );

const projectsOf = async (
  ctx: Awaited<ReturnType<typeof withProject>>,
  cookie: string,
) =>
  (
    (await (await get(ctx.app, cookie, "/api/projects")).json()) as {
      projects: {
        id: number;
        role: string;
        lockedBy: string | null;
        ownerPlan: string;
      }[];
    }
  ).projects;

describe("077 A: who is Pro", () => {
  it("given a plain account with one project, when its plan is read, then it is Free with 1 repo out of 3", async () => {
    const ctx = await withProject();

    expect(await planOf(ctx.app, ctx.alice.cookie)).toEqual({
      plan: "free",
      via: null,
      until: null,
      repos: 1,
      limit: 3,
    });
  });

  it("given an administrator, when the plan is read, then it is Pro by the administration, without limit", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);

    expect(await planOf(ctx.app, boss.cookie)).toMatchObject({
      plan: "pro",
      via: "admin",
      limit: null,
    });
  });

  it("given a code entered with no end, when the plan is read, then it is Pro by a code with no end", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);

    await makePro(ctx.app, boss.cookie, ctx.alice.cookie);

    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      plan: "pro",
      via: "code",
      until: null,
      limit: null,
    });
  });

  it("given a code that ends in 10 days, when 11 days pass, then the very next read says Free, with no task in between", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const until = inDays(10);
    await makePro(ctx.app, boss.cookie, ctx.alice.cookie, until);
    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      plan: "pro",
      until,
    });

    await travel(ctx.db, 11);

    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      plan: "free",
      via: null,
      limit: 3,
    });
  });

  it("given a Pro account whose code is revoked, when the plan is read, then it is Free", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const id = await makePro(ctx.app, boss.cookie, ctx.alice.cookie);

    await revoke(ctx.app, boss.cookie, id);

    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      plan: "free",
    });
  });
});

describe("077 B: the Free quota is 3 repos owned, archived included", () => {
  it("given an owned project archived and two active ones, and a project shared by someone else, when the plan is read, then 3 repos are used and the shared one is not counted", async () => {
    const ctx = await withProject();
    const [old] = await ownMore(ctx.db, ctx.alice.id, 2);
    await ctx.db.execute(
      sql`update projects set archived_at = now() where id = ${old}`,
    );
    const bob = await memberWith(ctx, 2001, "can_launch");
    const [theirs] = await ownMore(ctx.db, bob.id, 1);
    await ctx.db.execute(
      sql`insert into project_members (project_id, user_id, role) values (${theirs}, ${ctx.alice.id}, 'read_only')`,
    );

    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      repos: 3,
      limit: 3,
    });
  });
});

describe("077 C: the 4th repo", () => {
  it("given a Free account with 3 repos, when it imports a 4th, then 403 plan, one refused entry, and no project is added", async () => {
    const ctx = await withProject({ repositories: [repo(4, "user1000/four")] });
    await ownMore(ctx.db, ctx.alice.id, 2);

    const res = await importRepo(ctx, 4);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "plan" });
    const refused = await refusedFor(ctx);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      action: "import_project",
      user_id: ctx.alice.id,
    });
    expect(
      (await planOf(ctx.app, ctx.alice.cookie)).repos,
      "nothing was created",
    ).toBe(3);
  });

  it("given a Free account with 2 repos and a project shared by someone else, when it imports one, then it works: the 3rd is allowed", async () => {
    const ctx = await withProject({ repositories: [repo(4, "user1000/four")] });
    await ownMore(ctx.db, ctx.alice.id, 1);
    const bob = await memberWith(ctx, 2001, "can_launch");
    const [theirs] = await ownMore(ctx.db, bob.id, 1);
    await ctx.db.execute(
      sql`insert into project_members (project_id, user_id, role) values (${theirs}, ${ctx.alice.id}, 'read_only')`,
    );

    expect((await planOf(ctx.app, ctx.alice.cookie)).repos).toBe(2);
    const res = await importRepo(ctx, 4);

    expect(res.status).toBe(201);
  });

  it("given a Pro account with 3 repos, when it imports a 4th, then it works", async () => {
    const ctx = await withProject({ repositories: [repo(4, "user1000/four")] });
    await ownMore(ctx.db, ctx.alice.id, 2);
    await makePro(ctx.app, (await admin(ctx.db)).cookie, ctx.alice.cookie);

    expect((await importRepo(ctx, 4)).status).toBe(201);
  });

  it("given a Free account with 3 repos, when it creates one from a template, then 403 plan before the GitHub authorization: nothing is kept, one refused entry", async () => {
    const ctx = await withProject({
      repositories: [repo(5, "user1000/modele", true)],
    });
    await ownMore(ctx.db, ctx.alice.id, 2);
    const inner = globalThis.fetch;
    // The name lookup of the creation: free.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        return url.pathname === "/repos/user1000/nouveau"
          ? Response.json({ message: "Not Found" }, { status: 404 })
          : inner(input, init);
      }),
    );

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      "/api/projects/from-template",
      {
        template: "user1000/modele",
        owner: "user1000",
        name: "nouveau",
        private: true,
      },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "plan" });
    const kept = await ctx.db.execute(
      sql`select count(*)::int as n from template_requests`,
    );
    expect((kept as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(0);
    expect(await refusedFor(ctx)).toHaveLength(1);
  });
});

describe("077 E: Pro lost, the projects beyond the 3 oldest are read-only", () => {
  it("given a Pro owner of 4 projects whose code is revoked, when a gesture is tried, then only the 3 oldest still write, the 4th is read-only for its members too (403 plan, journaled, MCP too), reads stay open and Pro again unlocks", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const [first, ...others] = await ownMore(ctx.db, ctx.alice.id, 3);
    await ctx.db.execute(
      sql`update projects set archived_at = now() where id = ${first}`,
    );
    const bob = await memberWith(ctx, 2001, "can_launch");
    const codeId = await makePro(ctx.app, boss.cookie, ctx.alice.cookie);
    const ticket = (cookie: string, projectId: number) =>
      send(ctx.app, cookie, "POST", `/api/projects/${projectId}/tickets`, {
        title: "Une idée",
      });
    expect((await ticket(ctx.alice.cookie, ctx.projectId)).status).toBe(201);

    await revoke(ctx.app, boss.cookie, codeId);

    // `ctx.projectId` is the newest import: the 4th.
    const refused = await ticket(ctx.alice.cookie, ctx.projectId);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "plan" });
    expect(await refusedFor(ctx)).toMatchObject([
      { user_id: ctx.alice.id, project_id: ctx.projectId },
    ]);
    expect((await ticket(ctx.alice.cookie, others[0] as number)).status).toBe(
      201,
    );
    const asBob = await ticket(bob.cookie, ctx.projectId);
    expect(asBob.status).toBe(403);
    expect(await asBob.json()).toEqual({ error: "plan" });
    const listed = await projectsOf(ctx, ctx.alice.cookie);
    expect(listed.find((p) => p.id === ctx.projectId)).toMatchObject({
      role: "read_only",
      lockedBy: "user1000",
      ownerPlan: "free",
    });
    expect(listed.find((p) => p.id === first)).toMatchObject({
      role: "owner",
      lockedBy: null,
    });
    expect(
      (await projectsOf(ctx, bob.cookie)).find((p) => p.id === ctx.projectId),
    ).toMatchObject({ role: "read_only", lockedBy: "user1000" });
    expect(
      (await get(ctx.app, bob.cookie, `/api/projects/${ctx.projectId}/tickets`))
        .status,
      "a read stays open",
    ).toBe(200);
    expectRefused(
      await callTool(ctx.app, ctx.alice.secret, "create_ticket", {
        project_id: ctx.projectId,
        title: "Par Claude",
      }),
    );
    expect(
      (await refusedFor(ctx)).filter((r) => r.origin === "mcp"),
    ).toHaveLength(1);

    await makePro(ctx.app, boss.cookie, ctx.alice.cookie);

    expect((await ticket(ctx.alice.cookie, ctx.projectId)).status).toBe(201);
    expect(
      (await projectsOf(ctx, bob.cookie)).find((p) => p.id === ctx.projectId),
    ).toMatchObject({ role: "can_launch", lockedBy: null });
  });
});

describe("077 D: the takeover tools follow the plan of the owner", () => {
  it("given a Free owner, when Claude calls submit_code_map, submit_findings and create_takeover_stories, then each answers Refused plan, journaled with the project, nothing is written and list_findings still reads", async () => {
    const ctx = await ready();

    const answers = [
      await submit(ctx),
      await submitFindings(ctx, [finding(1)]),
      await takeover(ctx),
    ];

    for (const answer of answers)
      expect(expectRefused(answer)).toMatch(/plan/i);
    const refused = (await rows(ctx.db, sql`origin = 'mcp'`)).filter(
      (r) => r.result === "refused" && r.detail?.reason === "plan",
    );
    expect(refused.map((r) => r.action)).toEqual([
      "submit_code_map",
      "submit_findings",
      "create_takeover_stories",
    ]);
    for (const entry of refused) expect(entry.project_id).toBe(ctx.projectId);
    const read = await callTool(ctx.app, ctx.alice.secret, "list_findings", {
      project_id: ctx.projectId,
    });
    expect(read.isError, "a read stays open").not.toBe(true);
    for (const table of ["code_maps", "findings", "tickets"]) {
      const result = await ctx.db.execute(
        sql.raw(`select count(*)::int as n from ${table}`),
      );
      expect(
        (result as unknown as { rows: { n: number }[] }).rows[0]?.n,
        table,
      ).toBe(0);
    }
  });

  it("given a Pro owner, when Claude calls submit_code_map, then the map is accepted", async () => {
    const ctx = await ready();
    await makePro(ctx.app, (await admin(ctx.db)).cookie, ctx.alice.cookie);

    const result = await submit(ctx);

    expect(result.isError, result.content[0]?.text).not.toBe(true);
  });
});
