import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Row, rows, setup, userWithToken } from "./test-mcp.ts";
import { admin, makePro, planOf, revoke } from "./test-plans.ts";

// Decision 074 (story B): the agent teams of a user, stored in Cockpit, through `app.request()`.
//
// Pinned where the story leaves it open:
// - GET /api/agent-teams -> 200 { teams: [{ id, name, text }] } (the caller's, sorted by name).
// - PUT /api/agent-teams/:name { text } -> 200 { id, name, text }, creating or replacing; 400 for a name outside AGENT_NAME / over MAX_TEAM_NAME,
//   a text `parseTeam` refuses, a text over 1 MiB or a body without text. History save_agent_team, args { teamId } only.
// - DELETE /api/agent-teams/:name -> 200 for the owner (history delete_agent_team, args { teamId }), 404 otherwise. 401 without a session.

afterEach(() => {
  vi.unstubAllGlobals();
});

const teamText = (...agents: string[]) =>
  `---\nsteps:\n${agents.map((a) => `  - agent: ${a}\n    does: "something secret"`).join("\n")}\n---\nBody kept.\n`;
const TEAM = teamText("test-writer", "developer", "reviewer");
const LEGER = teamText("developer");

async function ready() {
  const ctx = await setup();
  const alice = await userWithToken(ctx.app, ctx.db, 1000);
  const bob = await userWithToken(ctx.app, ctx.db, 1001);
  const send = (
    who: { cookie: string } | null,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    ctx.app.request(`/api/agent-teams${path}`, {
      method,
      headers: {
        ...(who ? { cookie: who.cookie } : {}),
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const put = (who: { cookie: string }, name: string, text: unknown) =>
    send(who, "PUT", `/${name}`, { text });
  const list = async (who: { cookie: string }) =>
    (
      (await (await send(who, "GET", "")).json()) as {
        teams: { id: number; name: string; text: string }[];
      }
    ).teams;
  const history = (action: string) =>
    rows(ctx.db, sql`action = ${action}`) as Promise<Row[]>;
  return { ...ctx, alice, bob, send, put, list, history };
}

describe("decision 074 B: the routes of the agent teams", () => {
  it("given no session, when the routes are called, then they answer 401", async () => {
    const ctx = await ready();

    expect((await ctx.send(null, "GET", "")).status).toBe(401);
    expect(
      (await ctx.send(null, "PUT", "/leger", { text: LEGER })).status,
    ).toBe(401);
    expect((await ctx.send(null, "DELETE", "/leger")).status).toBe(401);
  });

  it("given no team, when the list is read, then it is empty", async () => {
    const ctx = await ready();

    const res = await ctx.send(ctx.alice, "GET", "");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teams: [] });
  });

  it("given a valid name and text, when PUT is sent, then the team is created and answered with its id, name and text", async () => {
    const ctx = await ready();

    const res = await ctx.put(ctx.alice, "leger", LEGER);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: expect.any(Number),
      name: "leger",
      text: LEGER,
    });
    expect(await ctx.list(ctx.alice)).toEqual([
      { id: expect.any(Number), name: "leger", text: LEGER },
    ]);
  });

  it("given two teams created in reverse order, when the list is read, then it is sorted by name", async () => {
    const ctx = await ready();
    await ctx.put(ctx.alice, "zeta", LEGER);
    await ctx.put(ctx.alice, "alpha", TEAM);

    expect((await ctx.list(ctx.alice)).map((t) => t.name)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("given an existing team, when PUT is sent again for the name, then it is replaced, not duplicated, and keeps its id", async () => {
    const ctx = await ready();
    const first = (await (await ctx.put(ctx.alice, "leger", LEGER)).json()) as {
      id: number;
    };

    const res = await ctx.put(ctx.alice, "leger", TEAM);

    expect(res.status).toBe(200);
    expect(await ctx.list(ctx.alice)).toEqual([
      { id: first.id, name: "leger", text: TEAM },
    ]);
  });

  it("given a saved team, when it is saved, then the history has save_agent_team with only the team id as argument", async () => {
    const ctx = await ready();
    const saved = (await (await ctx.put(ctx.alice, "leger", LEGER)).json()) as {
      id: number;
    };

    expect(await ctx.history("save_agent_team")).toMatchObject([
      {
        actor: "human",
        origin: "ui",
        result: "ok",
        args: { teamId: saved.id },
      },
    ]);
    expect(JSON.stringify(await rows(ctx.db))).not.toContain("secret");
  });

  it.each([
    ["an invalid name", "Bad_Name", LEGER],
    ["a name starting with a dash", "-leger", LEGER],
    ["a name that is too long", "a".repeat(239), LEGER],
    ["a text parseTeam refuses", "leger", "not a team"],
    ["a text over 1 MiB", "leger", `${LEGER}${"x".repeat(1024 * 1024)}`],
  ])(
    "given %s, when PUT is sent, then it answers 400 and nothing is stored or logged",
    async (_label, name, text) => {
      const ctx = await ready();

      const res = await ctx.put(ctx.alice, name, text);

      expect(res.status).toBe(400);
      expect(await ctx.list(ctx.alice)).toEqual([]);
      expect(await ctx.history("save_agent_team")).toEqual([]);
    },
  );

  it("given a body without text, when PUT is sent, then it answers 400", async () => {
    const ctx = await ready();

    const res = await ctx.send(ctx.alice, "PUT", "/leger", {});

    expect(res.status).toBe(400);
  });

  it("given a team, when DELETE is sent, then it is removed and the history has delete_agent_team with the team id", async () => {
    const ctx = await ready();
    const saved = (await (await ctx.put(ctx.alice, "leger", LEGER)).json()) as {
      id: number;
    };

    const res = await ctx.send(ctx.alice, "DELETE", "/leger");

    expect(res.status).toBe(200);
    expect(await ctx.list(ctx.alice)).toEqual([]);
    expect(await ctx.history("delete_agent_team")).toMatchObject([
      {
        actor: "human",
        origin: "ui",
        result: "ok",
        args: { teamId: saved.id },
      },
    ]);
  });

  it("given no such team, when DELETE is sent, then it answers 404 and logs nothing", async () => {
    const ctx = await ready();

    const res = await ctx.send(ctx.alice, "DELETE", "/nope");

    expect(res.status).toBe(404);
    expect(await ctx.history("delete_agent_team")).toEqual([]);
  });

  it("given a team of Alice, when Bob lists, saves the same name or deletes it, then he never sees nor touches hers", async () => {
    const ctx = await ready();
    await ctx.put(ctx.alice, "leger", LEGER);

    expect(await ctx.list(ctx.bob)).toEqual([]);
    expect((await ctx.send(ctx.bob, "DELETE", "/leger")).status).toBe(404);
    expect((await ctx.put(ctx.bob, "leger", TEAM)).status).toBe(200);

    expect(await ctx.list(ctx.alice)).toMatchObject([
      { name: "leger", text: LEGER },
    ]);
    expect(await ctx.list(ctx.bob)).toMatchObject([
      { name: "leger", text: TEAM },
    ]);
  });
});

// Decision 082: a Free account has 2 agent teams at once; Pro and the administrator have no limit.
describe("decision 082: the limit of 2 teams for a Free account", () => {
  const PLAN = { error: "plan" };
  const names = async (ctx: Awaited<ReturnType<typeof ready>>) =>
    (await ctx.list(ctx.alice)).map((t) => t.name);

  async function withTeams(n: number) {
    const ctx = await ready();
    for (let i = 0; i < n; i++)
      expect((await ctx.put(ctx.alice, `team${i}`, LEGER)).status).toBe(200);
    return ctx;
  }

  it("given a Free account with 2 teams, when PUT is sent for a new name, then 403 plan, no team created and the history says refused", async () => {
    const ctx = await withTeams(2);

    const res = await ctx.put(ctx.alice, "third", LEGER);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(PLAN);
    expect(await names(ctx)).toEqual(["team0", "team1"]);
    expect(await ctx.history("save_agent_team")).toMatchObject([
      { result: "ok" },
      { result: "ok" },
      { result: "refused" },
    ]);
  });

  it("given a Free account with 2 teams, when PUT is sent for an existing name with a new text, then 200 and the text is replaced", async () => {
    const ctx = await withTeams(2);

    const res = await ctx.put(ctx.alice, "team1", TEAM);

    expect(res.status).toBe(200);
    expect(
      (await ctx.list(ctx.alice)).find((t) => t.name === "team1")?.text,
    ).toBe(TEAM);
  });

  it("given a Free account with 1 team, when PUT is sent for a new name, then 200 (the 2nd team)", async () => {
    const ctx = await withTeams(1);

    expect((await ctx.put(ctx.alice, "second", LEGER)).status).toBe(200);
    expect(await names(ctx)).toHaveLength(2);
  });

  it("given a Pro account by a code with 2 teams, when PUT is sent for a new name, then 200", async () => {
    const ctx = await withTeams(2);
    const boss = await admin(ctx.db);
    await makePro(ctx.app, boss.cookie, ctx.alice.cookie);

    expect((await ctx.put(ctx.alice, "third", LEGER)).status).toBe(200);
    expect(await names(ctx)).toHaveLength(3);
  });

  it("given an instance administrator with 2 teams, when PUT is sent for a new name, then 200", async () => {
    const ctx = await ready();
    const boss = await admin(ctx.db);
    for (const name of ["a", "b", "c"])
      expect((await ctx.put(boss, name, LEGER)).status).toBe(200);
  });

  it("given a Free account with 2 teams, when one is deleted and a new name is PUT, then 200", async () => {
    const ctx = await withTeams(2);
    expect((await ctx.send(ctx.alice, "DELETE", "/team0")).status).toBe(200);

    expect((await ctx.put(ctx.alice, "third", LEGER)).status).toBe(200);
  });

  it("given a Free account with 3 teams made while Pro and the code revoked, when it replaces, deletes then creates, then 200, 200 and 403 plan", async () => {
    const ctx = await ready();
    const boss = await admin(ctx.db);
    const codeId = await makePro(ctx.app, boss.cookie, ctx.alice.cookie);
    for (const name of ["a", "b", "c"])
      expect((await ctx.put(ctx.alice, name, LEGER)).status).toBe(200);
    expect((await revoke(ctx.app, boss.cookie, codeId)).status).toBe(200);
    expect((await planOf(ctx.app, ctx.alice.cookie)).plan).toBe("free");

    expect((await ctx.put(ctx.alice, "a", TEAM)).status).toBe(200);
    expect((await ctx.send(ctx.alice, "DELETE", "/c")).status).toBe(200);
    const res = await ctx.put(ctx.alice, "d", LEGER);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(PLAN);
    expect(await names(ctx)).toEqual(["a", "b"]);
  });

  it("given a Free and a Pro account, when GET /api/me/plan is read, then teamLimit is 2 and null", async () => {
    const ctx = await ready();
    expect((await planOf(ctx.app, ctx.alice.cookie)).teamLimit).toBe(2);
    const boss = await admin(ctx.db);
    await makePro(ctx.app, boss.cookie, ctx.bob.cookie);

    expect((await planOf(ctx.app, ctx.bob.cookie)).teamLimit).toBeNull();
  });
});
