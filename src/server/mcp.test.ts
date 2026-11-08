import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import {
  projectMembers,
  projects,
  sessions,
  tickets,
  users,
} from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { INSTALLATION_ID, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";
import { purgeRevokedTokens } from "./tokens.ts";

// Slice 4.2 (decisions 001, 004, 010, 015): the MCP server at POST /mcp, driven with raw JSON-RPC.
//
// Assumed exchange: the SDK transport runs STATELESS with JSON responses. Every test sends ONE request per POST,
// with `Content-Type: application/json`, `Accept: application/json, text/event-stream` and
// `Authorization: Bearer <secret>`, and gets ONE JSON-RPC response as `application/json` (no SSE, no session id).
// No `initialize` is sent before `tools/list` / `tools/call` (a stateless server keeps no session to initialize);
// one test checks that `initialize` itself is answered.
//
// Expected new column: `history.token_id` (integer, null, no FK). History is read with raw SQL (`select *`), so
// these tests do not depend on the Drizzle export of the column.
//
// Pinned choices where the criteria leave room:
// - success payloads (the text of the first content item is JSON):
//   list_projects  -> { projects: [{ id, full_name, default_branch }] }       (by id)
//   get_project    -> { project: { id, full_name, default_branch, ... }, claude_md, tickets: [{ id, title, step }] }
//   search         -> { results: [{ type, id, title, project_id, step? }] }   (step only on tickets)
//   get_ticket     -> { id, title, description_md, step, stories: [] }
//   create_ticket  -> { id, ... }
// - fixed refusal codes in history.detail.reason: not_found, project_archived, invalid_arguments, unknown_tool;
//   an error is always { reason: "error" } (decision 010 D, as `act` does).
// - history.args of a refused call: the ids that were asked for ({ projectId } / { ticketId }), {} when the
//   arguments did not fit the schema; never free text.
// - auth: no Authorization header -> 401 and NO history entry (nothing was presented, like decision 010 E's
//   request without state); a header that is not "Bearer <token>" or a token nobody has -> invalid_token.
// - get_project when the App lost access to the repo (root tree 404): still ok, with claude_md "" and
//   `claude_md_unreachable: true`; a GitHub failure (500) is an Error that says to retry.
// - protocol: GET and DELETE -> 405 with Allow: POST; a notification -> 202 without body; a body over
//   256 KiB -> 413; the /.well-known paths other than the three OAuth discovery ones (decision 021 A) -> 404 JSON (they must not get the page).
// - unknown tool: journaled under its own name when that is a short identifier (/^[a-z][a-z0-9_]{0,39}$/),
//   else under "unknown_tool".

afterEach(() => {
  vi.unstubAllGlobals();
});

type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;
type App = ReturnType<typeof createApp>;

/** The GitHub stub is always on: a tool that must not reach GitHub fails loudly if it does. */
async function setup(github: Partial<Parameters<typeof stubGitHub>[0]> = {}) {
  const fetchMock = stubGitHub({ account: null, ...github });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app, fetchMock };
}

/** A user with a live session and a real MCP token created through the 4.1 route. */
async function userWithToken(app: App, db: TestDb, githubId: number) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `user${githubId}` })
    .returning({ id: users.id });
  assert(user);
  const value = `cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: createHash("sha256").update(value).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const cookie = `cockpit_session=${value}`;
  const res = await app.request("/api/me/tokens", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Mon Claude" }),
  });
  expect(res.status, "creating a token must work for this test").toBe(201);
  const { token, secret } = (await res.json()) as {
    token: { id: number };
    secret: string;
  };
  return { id: user.id, cookie, secret, tokenId: token.id };
}

async function seedProject(
  db: TestDb,
  ownerId: number,
  values: { githubRepoId: number; fullName: string; archivedAt?: Date },
) {
  const [project] = await db
    .insert(projects)
    .values({
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
      ...values,
    })
    .returning({ id: projects.id });
  assert(project);
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: ownerId, role: "owner" });
  return project.id;
}

async function seedTicket(
  db: TestDb,
  projectId: number,
  title: string,
  descriptionMd = "",
) {
  const [ticket] = await db
    .insert(tickets)
    .values({ projectId, title, descriptionMd })
    .returning({ id: tickets.id });
  assert(ticket);
  return ticket.id;
}

/** Alice (and her token) with one project. */
async function withProject(
  github: Partial<Parameters<typeof stubGitHub>[0]> = {},
) {
  const ctx = await setup({ account: 1000, ...github });
  const alice = await userWithToken(ctx.app, ctx.db, 1000);
  const projectId = await seedProject(ctx.db, alice.id, {
    githubRepoId: 1,
    fullName: "user1000/app",
  });
  return { ...ctx, alice, projectId };
}

// --- JSON-RPC over HTTP ---

let nextId = 1;

/** One JSON-RPC request per POST. `authorization` undefined sends no header. */
function rpc(
  app: App,
  method: string,
  params: unknown,
  authorization?: string,
) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
}

type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

/** A tools/call that must come back as a JSON-RPC result (a refusal or an error is a result with isError, not a protocol error). */
async function callTool(app: App, secret: string, name: string, args: unknown) {
  const res = await rpc(
    app,
    "tools/call",
    { name, arguments: args },
    `Bearer ${secret}`,
  );
  expect(res.status, "POST /mcp with a valid token").toBe(200);
  const body = (await res.json()) as { result?: ToolResult; error?: unknown };
  expect(
    body.error,
    "a tool outcome is never a protocol error",
  ).toBeUndefined();
  assert(body.result, "a JSON-RPC result");
  return body.result;
}

const textOf = (result: ToolResult) => result.content[0]?.text ?? "";

/** The JSON of a successful tool call. */
function dataOf<T>(result: ToolResult): T {
  expect(result.isError, textOf(result)).not.toBe(true);
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(textOf(result)) as T;
}

function expectRefused(result: ToolResult) {
  expect(result.isError).toBe(true);
  expect(textOf(result)).toMatch(/^Refused: \S/);
  return textOf(result);
}

// --- history, read with raw SQL ---

type Row = {
  id: number;
  user_id: number | null;
  token_id: number | null;
  project_id: number | null;
  ticket_id: number | null;
  actor: string;
  origin: string;
  action: string;
  args: Record<string, unknown>;
  result: string;
  detail: Record<string, string> | null;
};

async function rows(db: TestDb, where = sql`true`) {
  const result = await db.execute(
    sql`select * from history where ${where} order by id`,
  );
  return (result as unknown as { rows: Row[] }).rows;
}

/** What Claude's calls left in the history. */
const mcpRows = (db: TestDb) => rows(db, sql`origin = 'mcp'`);

const shape = (r: Row) => ({
  user_id: r.user_id,
  token_id: r.token_id,
  project_id: r.project_id,
  ticket_id: r.ticket_id,
  actor: r.actor,
  origin: r.origin,
  action: r.action,
  args: r.args,
  result: r.result,
  detail: r.detail,
});

/** The whole history as text, for "this never appears anywhere". */
async function historyText(db: TestDb) {
  return JSON.stringify(await rows(db));
}

/** The one entry of a single call. */
async function onlyEntry(db: TestDb) {
  const found = await mcpRows(db);
  expect(found, "one history entry for one call").toHaveLength(1);
  return found[0] as Row;
}

const ticketsOf = (app: App, cookie: string, projectId: number) =>
  app.request(`/api/projects/${projectId}/tickets`, { headers: { cookie } });

// ---------------------------------------------------------------------------

describe("criterion 1: authentication of POST /mcp", () => {
  const unknownSecret = `ckp_${"x".repeat(43)}`;
  const cases: [string, string | undefined, string, string][] = [
    ["a Basic header", "Basic dXNlcjpwYXNz", "invalid_token", "dXNlcjpwYXNz"],
    [
      "a Bearer scheme spelled Token",
      `Token ckp_${"a".repeat(43)}`,
      "invalid_token",
      "a".repeat(43),
    ],
    [
      "a token nobody has",
      `Bearer ${unknownSecret}`,
      "invalid_token",
      "x".repeat(43),
    ],
  ];

  it("given no Authorization header, when tools/call create_ticket is posted, then 401 with WWW-Authenticate: Bearer, no ticket, and NO history entry at all", async () => {
    const { app, db, alice, projectId } = await withProject();
    const before = await rows(db);

    const res = await rpc(app, "tools/call", {
      name: "create_ticket",
      arguments: { project_id: projectId, title: "Ne doit pas exister" },
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer\b/);
    expect(await rows(db)).toEqual(before);
    const list = (await (
      await ticketsOf(app, alice.cookie, projectId)
    ).json()) as { tickets: unknown[] };
    expect(list.tickets).toEqual([]);
  });

  it.each(cases)(
    "given %s, when tools/call create_ticket is posted, then 401 with WWW-Authenticate: Bearer, no ticket, and one mcp_auth refused entry without user, token or secret",
    async (_name, authorization, reason, leak) => {
      const { app, db, alice, projectId } = await withProject();

      const res = await rpc(
        app,
        "tools/call",
        {
          name: "create_ticket",
          arguments: { project_id: projectId, title: "Ne doit pas exister" },
        },
        authorization,
      );

      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer\b/);
      const found = await rows(db, sql`action = 'mcp_auth'`);
      expect(found.map(shape)).toEqual([
        {
          user_id: null,
          token_id: null,
          project_id: null,
          ticket_id: null,
          actor: "claude",
          origin: "mcp",
          action: "mcp_auth",
          args: {},
          result: "refused",
          detail: { reason },
        },
      ]);
      // No tool ran: no ticket, and no other entry of Claude.
      expect(await mcpRows(db)).toHaveLength(1);
      const list = (await (
        await ticketsOf(app, alice.cookie, projectId)
      ).json()) as {
        tickets: unknown[];
      };
      expect(list.tickets).toEqual([]);
      const text = await historyText(db);
      if (leak) expect(text).not.toContain(leak);
    },
  );

  it("given a revoked token, when it calls a tool, then 401, one mcp_auth refused entry with reason revoked_token and the token id, no user, and the secret is nowhere in history", async () => {
    const { app, db, alice } = await withProject();
    const revoked = await app.request(
      `/api/me/tokens/${alice.tokenId}/revoke`,
      {
        method: "POST",
        headers: { cookie: alice.cookie },
      },
    );
    expect(revoked.status).toBe(204);

    const res = await rpc(
      app,
      "tools/call",
      { name: "list_projects", arguments: {} },
      `Bearer ${alice.secret}`,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer\b/);
    const found = await rows(db, sql`action = 'mcp_auth'`);
    expect(found.map(shape)).toEqual([
      {
        user_id: null,
        token_id: alice.tokenId,
        project_id: null,
        ticket_id: null,
        actor: "claude",
        origin: "mcp",
        action: "mcp_auth",
        args: {},
        result: "refused",
        detail: { reason: "revoked_token" },
      },
    ]);
    expect(await mcpRows(db)).toHaveLength(1);
    expect(await historyText(db)).not.toContain(alice.secret);
  });

  // Slice 4.3: revoked tokens are purged 3 months after their revocation.
  async function revokedDaysAgo(
    app: App,
    db: TestDb,
    alice: { cookie: string; tokenId: number },
    daysAgo: number,
  ) {
    const res = await app.request(`/api/me/tokens/${alice.tokenId}/revoke`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    expect(res.status).toBe(204);
    await db.execute(
      sql`update mcp_tokens set revoked_at = ${new Date(Date.now() - daysAgo * 86_400_000).toISOString()}::timestamptz where id = ${alice.tokenId}`,
    );
  }

  it("given a token revoked less than 3 months ago, when the purge runs, then it is still refused as revoked_token with its token id", async () => {
    const { app, db, alice } = await withProject();
    await revokedDaysAgo(app, db, alice, 80);

    expect(await purgeRevokedTokens(db)).toBe(0);
    const res = await rpc(
      app,
      "tools/call",
      { name: "list_projects", arguments: {} },
      `Bearer ${alice.secret}`,
    );

    expect(res.status).toBe(401);
    const found = await rows(db, sql`action = 'mcp_auth'`);
    expect(found.map((r) => [r.token_id, r.detail])).toEqual([
      [alice.tokenId, { reason: "revoked_token" }],
    ]);
  });

  it("given a token revoked more than 3 months ago and purged, when it calls a tool, then 401 and one mcp_auth refused entry with reason invalid_token, no token id and no secret", async () => {
    const { app, db, alice } = await withProject();
    await revokedDaysAgo(app, db, alice, 100);
    expect(await purgeRevokedTokens(db)).toBe(1);

    const res = await rpc(
      app,
      "tools/call",
      { name: "list_projects", arguments: {} },
      `Bearer ${alice.secret}`,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer\b/);
    const found = await rows(db, sql`action = 'mcp_auth'`);
    expect(found.map(shape)).toEqual([
      {
        user_id: null,
        token_id: null,
        project_id: null,
        ticket_id: null,
        actor: "claude",
        origin: "mcp",
        action: "mcp_auth",
        args: {},
        result: "refused",
        detail: { reason: "invalid_token" },
      },
    ]);
    expect(await mcpRows(db)).toHaveLength(1);
    expect(await historyText(db)).not.toContain(alice.secret);
  });

  it("given a purged token that made an MCP call before, when the purge ran, then its mcp history entries are untouched", async () => {
    const { app, db, alice } = await withProject();
    dataOf(await callTool(app, alice.secret, "list_projects", {}));
    const before = await mcpRows(db);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.token_id === alice.tokenId)).toBe(true);
    await revokedDaysAgo(app, db, alice, 100);

    await purgeRevokedTokens(db);

    expect(await mcpRows(db)).toEqual(before);
  });

  it("given a token whose user is blocked, when it calls a tool, then 401, one mcp_auth refused entry with reason blocked_user and the token id, no user, and the secret is nowhere in history", async () => {
    const { app, db, alice } = await withProject();
    await db
      .update(users)
      .set({ blockedAt: new Date() })
      .where(eq(users.id, alice.id));

    const res = await rpc(
      app,
      "tools/call",
      { name: "list_projects", arguments: {} },
      `Bearer ${alice.secret}`,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer\b/);
    const found = await rows(db, sql`action = 'mcp_auth'`);
    expect(found.map(shape)).toEqual([
      {
        user_id: null,
        token_id: alice.tokenId,
        project_id: null,
        ticket_id: null,
        actor: "claude",
        origin: "mcp",
        action: "mcp_auth",
        args: {},
        result: "refused",
        detail: { reason: "blocked_user" },
      },
    ]);
    expect(await mcpRows(db)).toHaveLength(1);
    expect(await historyText(db)).not.toContain(alice.secret);
  });

  it("given a revoked token and a blocked token, when each is refused, then last_used_at stays empty", async () => {
    const { app, db, alice } = await withProject();
    const bob = await userWithToken(app, db, 2000);
    await app.request(`/api/me/tokens/${alice.tokenId}/revoke`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    await db
      .update(users)
      .set({ blockedAt: new Date() })
      .where(eq(users.id, bob.id));

    for (const secret of [alice.secret, bob.secret]) {
      const res = await rpc(
        app,
        "tools/call",
        { name: "list_projects", arguments: {} },
        `Bearer ${secret}`,
      );
      expect(res.status).toBe(401);
    }

    // Read from the table: a revoked token is no longer listed.
    const result = await db.execute(
      sql`select id, last_used_at from mcp_tokens order by id`,
    );
    expect(
      (
        result as unknown as {
          rows: { id: number; last_used_at: unknown }[];
        }
      ).rows,
    ).toEqual([
      { id: alice.tokenId, last_used_at: null },
      { id: bob.tokenId, last_used_at: null },
    ]);
  });

  it("given a valid token never used, when it calls tools/list, then last_used_at is set to now", async () => {
    const { app, alice } = await withProject();
    const before = await app.request("/api/me/tokens", {
      headers: { cookie: alice.cookie },
    });
    expect(
      ((await before.json()) as { tokens: { lastUsedAt: unknown }[] }).tokens[0]
        ?.lastUsedAt,
    ).toBeNull();

    const res = await rpc(app, "tools/list", {}, `Bearer ${alice.secret}`);
    expect(res.status).toBe(200);

    const after = await app.request("/api/me/tokens", {
      headers: { cookie: alice.cookie },
    });
    const { tokens } = (await after.json()) as {
      tokens: { lastUsedAt: string | null }[];
    };
    const used = tokens[0]?.lastUsedAt;
    assert(used, "last_used_at is set");
    expect(Math.abs(Date.parse(used) - Date.now())).toBeLessThan(60_000);
  });

  it("given a valid token, when initialize is posted, then the server answers with its capabilities including tools", async () => {
    const { app, alice } = await withProject();

    const res = await rpc(
      app,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
      `Bearer ${alice.secret}`,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { capabilities?: { tools?: unknown } };
    };
    expect(body.result?.capabilities?.tools).toBeDefined();
  });
});

describe("criterion 2: tools/list", () => {
  it("given a valid token, when tools/list is posted, then exactly the 23 tools, each with an English description and an input schema naming its arguments", async () => {
    const { app, alice } = await withProject();

    const res = await rpc(app, "tools/list", {}, `Bearer ${alice.secret}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        tools: {
          name: string;
          description?: string;
          inputSchema?: {
            type?: string;
            properties?: Record<string, unknown>;
            required?: string[];
          };
        }[];
      };
    };
    const tools = body.result.tools;
    // Slice 4.3 (decision 017) adds create_user_stories, get_user_story and list_tickets_needing_us;
    // slice 4.4 (decision 018 E) adds update_user_story; slice 7.1 (decision 033) adds start_run, report_step, finish_run; slice 7.3 (decision 035) adds report_criterion and link_pull_request; slice 7.4 (decision 036) adds ask_user and get_answer; slice R1 (decision 043) adds submit_code_map; slice R2 (decision 047) adds create_takeover_stories; slice R5 (decision 051) adds submit_findings and list_findings; slice 11.4 (decision 058 H) adds get_attachment.
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_user",
      "create_takeover_stories",
      "create_ticket",
      "create_user_stories",
      "finish_launch",
      "finish_run",
      "get_answer",
      "get_attachment",
      "get_launch",
      "get_project",
      "get_ticket",
      "get_user_story",
      "link_pull_request",
      "list_findings",
      "list_projects",
      "list_tickets_needing_us",
      "report_criterion",
      "report_launch",
      "report_step",
      "search",
      "start_run",
      "submit_code_map",
      "submit_findings",
      "update_user_story",
    ]);
    for (const tool of tools) {
      expect(tool.description?.trim().length, tool.name).toBeGreaterThan(20);
      // English: no accented letter (the text is for Claude only, decision 004).
      expect(tool.description, tool.name).not.toMatch(/[À-ÿ]/);
      expect(tool.inputSchema?.type, tool.name).toBe("object");
    }
    const schema = (name: string) =>
      tools.find((t) => t.name === name)?.inputSchema;
    expect(Object.keys(schema("get_project")?.properties ?? {})).toEqual([
      "project_id",
    ]);
    expect(Object.keys(schema("get_ticket")?.properties ?? {})).toEqual([
      "ticket_id",
    ]);
    expect(Object.keys(schema("search")?.properties ?? {}).sort()).toEqual([
      "project_id",
      "query",
    ]);
    expect(
      Object.keys(schema("create_ticket")?.properties ?? {}).sort(),
    ).toEqual(["description_md", "project_id", "title"]);
    expect(schema("create_ticket")?.required?.sort()).toEqual([
      "project_id",
      "title",
    ]);
    expect(schema("search")?.required).toEqual(["query"]);
    expect(schema("get_project")?.required).toEqual(["project_id"]);
    expect(schema("get_ticket")?.required).toEqual(["ticket_id"]);
    expect(Object.keys(schema("list_projects")?.properties ?? {})).toEqual([]);
  });
});

describe("criterion 3: every tools/call writes one history entry", () => {
  it("given list_projects, when called, then one entry: claude / mcp, the owner, the token, args {}, ok, no detail", async () => {
    const { app, db, alice } = await withProject();

    dataOf(await callTool(app, alice.secret, "list_projects", {}));

    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: null,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "list_projects",
      args: {},
      result: "ok",
      detail: null,
    });
  });

  it("given get_project, when called, then one entry with project_id and args { projectId }", async () => {
    const { app, db, alice, projectId } = await withProject({
      files: { "CLAUDE.md": "# x" },
    });

    dataOf(
      await callTool(app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "get_project",
      args: { projectId },
      result: "ok",
      detail: null,
    });
  });

  it("given search, when called with a query, then one entry with args {} and the query is nowhere in history", async () => {
    const { app, db, alice } = await withProject();

    dataOf(
      await callTool(app, alice.secret, "search", {
        query: "mot-tres-secret-42",
      }),
    );

    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: null,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "search",
      args: {},
      result: "ok",
      detail: null,
    });
    expect(await historyText(db)).not.toContain("mot-tres-secret-42");
  });

  it("given get_ticket, when called, then one entry with project_id, ticket_id and args { ticketId }", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticketId = await seedTicket(db, projectId, "Une idée");

    dataOf(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: ticketId }),
    );

    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: ticketId,
      actor: "claude",
      origin: "mcp",
      action: "get_ticket",
      args: { ticketId },
      result: "ok",
      detail: null,
    });
  });

  it("given create_ticket, when called, then one entry with the new ticket and args { ticketId }, and the title and description are nowhere in history", async () => {
    const { app, db, alice, projectId } = await withProject();

    const created = dataOf<{ id: number }>(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: projectId,
        title: "Titre-confidentiel-77",
        description_md: "Description-confidentielle-88",
      }),
    );

    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: created.id,
      actor: "claude",
      origin: "mcp",
      action: "create_ticket",
      args: { ticketId: created.id },
      result: "ok",
      detail: null,
    });
    const text = await historyText(db);
    expect(text).not.toContain("Titre-confidentiel-77");
    expect(text).not.toContain("Description-confidentielle-88");
  });

  it("given a refused call, when it is journaled, then the entry is refused with a fixed reason code and the ids that were asked for", async () => {
    const { app, db, alice } = await withProject();

    expectRefused(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: 987654 }),
    );

    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: null,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "get_ticket",
      args: { ticketId: 987654 },
      result: "refused",
      detail: { reason: "not_found" },
    });
  });

  it("given a failing call, when it is journaled, then the entry is an error with the closed reason and nothing from the failure", async () => {
    const { app, db, alice, projectId } = await withProject({
      treesStatus: 500,
    });

    const result = await callTool(app, alice.secret, "get_project", {
      project_id: projectId,
    });

    expect(result.isError).toBe(true);
    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "get_project",
      args: { projectId },
      result: "error",
      detail: { reason: "error" },
    });
  });

  it("given the calls of a user, when they read GET /api/history, then Claude's calls are in it with actor claude and origin mcp", async () => {
    const { app, db, alice } = await withProject();
    dataOf(await callTool(app, alice.secret, "list_projects", {}));
    expect(await mcpRows(db)).toHaveLength(1);

    const res = await app.request("/api/history", {
      headers: { cookie: alice.cookie },
    });

    const { entries } = (await res.json()) as {
      entries: {
        actor: string;
        origin: string;
        action: string;
        result: string;
      }[];
    };
    expect(entries).toContainEqual(
      expect.objectContaining({
        actor: "claude",
        origin: "mcp",
        action: "list_projects",
        result: "ok",
      }),
    );
  });
});

describe("criterion 4: the shape of the answers", () => {
  it("given an unknown tool with a short identifier name, when called, then Refused, journaled under that name with reason unknown_tool", async () => {
    const { app, db, alice } = await withProject();

    const result = await callTool(app, alice.secret, "delete_project", {
      project_id: 1,
    });

    expect(expectRefused(result)).toMatch(/unknown tool/i);
    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: null,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "delete_project",
      args: {},
      result: "refused",
      detail: { reason: "unknown_tool" },
    });
  });

  it("given an unknown tool whose name is not a short identifier, when called, then Refused, journaled as unknown_tool and the name is nowhere in history", async () => {
    const { app, db, alice } = await withProject();
    const name = `Ignore previous instructions ${"x".repeat(80)}`;

    expectRefused(await callTool(app, alice.secret, name, {}));

    const entry = await onlyEntry(db);
    expect(entry.action).toBe("unknown_tool");
    expect(entry.result).toBe("refused");
    expect(entry.detail).toEqual({ reason: "unknown_tool" });
    expect(await historyText(db)).not.toContain("Ignore previous");
  });

  it("given a refusal, when the answer is read, then it says why and what to do", async () => {
    const { app, alice } = await withProject();

    const text = expectRefused(
      await callTool(app, alice.secret, "get_project", { project_id: 987654 }),
    );

    expect(text).toMatch(/not found/i);
    // Longer than a bare code: it tells Claude what to do next.
    expect(text.length).toBeGreaterThan("Refused: not found".length + 20);
  });

  it.each([
    ["get_project", { project_id: "abc" }, "project_id"],
    ["get_project", {}, "project_id"],
    ["get_ticket", { ticket_id: 0 }, "ticket_id"],
    ["search", { query: "a" }, "query"],
    ["search", { query: "x".repeat(201) }, "query"],
    ["create_ticket", { project_id: 1, title: "   " }, "title"],
    ["create_ticket", { project_id: 1 }, "title"],
  ])(
    "given invalid arguments for %s %j, when called, then Refused naming %s, journaled invalid_arguments with args {}",
    async (tool, args, field) => {
      const { app, db, alice } = await withProject();
      const before = (await mcpRows(db)).length;

      const text = expectRefused(await callTool(app, alice.secret, tool, args));

      expect(text).toContain(field);
      const added = (await mcpRows(db)).slice(before);
      expect(added.map(shape)).toEqual([
        {
          user_id: alice.id,
          token_id: alice.tokenId,
          project_id: null,
          ticket_id: null,
          actor: "claude",
          origin: "mcp",
          action: tool,
          args: {},
          result: "refused",
          detail: { reason: "invalid_arguments" },
        },
      ]);
    },
  );

  it("given a failure that can be retried, when called, then Error: and it says to retry", async () => {
    const { app, alice, projectId } = await withProject({ treesStatus: 500 });

    const result = await callTool(app, alice.secret, "get_project", {
      project_id: projectId,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Error: \S/);
    expect(textOf(result)).toMatch(/retry|try again/i);
  });
});

describe("criterion 5: list_projects", () => {
  it("given a user with two active projects and an archived one, and another user with a project, when list_projects is called, then only the two active projects of the caller come back", async () => {
    const { app, db, alice, fetchMock } = await withProject();
    const second = await seedProject(db, alice.id, {
      githubRepoId: 2,
      fullName: "user1000/site",
    });
    await seedProject(db, alice.id, {
      githubRepoId: 3,
      fullName: "user1000/old",
      archivedAt: new Date(),
    });
    const bob = await userWithToken(app, db, 2000);
    await seedProject(db, bob.id, {
      githubRepoId: 4,
      fullName: "user2000/secret",
    });
    const first = (
      await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.githubRepoId, 1))
    )[0]?.id;

    const data = dataOf<{ projects: unknown[] }>(
      await callTool(app, alice.secret, "list_projects", {}),
    );

    expect(data.projects).toEqual([
      { id: first, full_name: "user1000/app", default_branch: "main" },
      { id: second, full_name: "user1000/site", default_branch: "main" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("given a user without any project, when list_projects is called, then an empty list, not a refusal", async () => {
    const { app, db } = await setup();
    const carol = await userWithToken(app, db, 3000);

    const data = dataOf<{ projects: unknown[] }>(
      await callTool(app, carol.secret, "list_projects", {}),
    );

    expect(data.projects).toEqual([]);
  });
});

describe("criterion 6: get_project", () => {
  it("given a project with a CLAUDE.md and tickets, when get_project is called, then the project, the CLAUDE.md text read from GitHub, and its tickets { id, title, step }", async () => {
    const claudeMd = "# Règles\n\nToujours écrire les tests d'abord.\n";
    const { app, db, alice, projectId } = await withProject({
      files: { "CLAUDE.md": claudeMd, "README.md": "hello" },
    });
    const t1 = await seedTicket(db, projectId, "Premier");
    const t2 = await seedTicket(db, projectId, "Second", "avec description");

    const data = dataOf<{
      project: Record<string, unknown>;
      claude_md: string;
      tickets: unknown[];
    }>(
      await callTool(app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    expect(data.project).toMatchObject({
      id: projectId,
      full_name: "user1000/app",
      default_branch: "main",
    });
    expect(data.claude_md).toBe(claudeMd);
    expect(
      [...data.tickets].sort(
        (a, b) => (a as { id: number }).id - (b as { id: number }).id,
      ),
    ).toEqual([
      { id: t1, title: "Premier", step: "new" },
      { id: t2, title: "Second", step: "new" },
    ]);
  });

  it("given a repo without CLAUDE.md, when get_project is called, then claude_md is an empty string", async () => {
    const { app, alice, projectId } = await withProject({
      files: { "README.md": "hello" },
    });

    const data = dataOf<{ claude_md: unknown; tickets: unknown[] }>(
      await callTool(app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    expect(data.claude_md).toBe("");
    expect(data.tickets).toEqual([]);
  });

  it("given an archived project, when get_project is called, then it is still readable", async () => {
    const { app, db, alice, projectId } = await withProject({
      files: { "CLAUDE.md": "# archivé" },
    });
    await db
      .update(projects)
      .set({ archivedAt: new Date() })
      .where(eq(projects.id, projectId));

    const data = dataOf<{ claude_md: string }>(
      await callTool(app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    expect(data.claude_md).toBe("# archivé");
  });

  it("given another user's project and a project that does not exist, when get_project is called on each, then both get the same Refused not found, and GitHub is not called", async () => {
    const { app, db, alice, fetchMock } = await withProject();
    const bob = await userWithToken(app, db, 2000);
    const bobsProject = await seedProject(db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });

    const other = expectRefused(
      await callTool(app, alice.secret, "get_project", {
        project_id: bobsProject,
      }),
    );
    const missing = expectRefused(
      await callTool(app, alice.secret, "get_project", {
        project_id: 987654,
      }),
    );

    expect(other).toMatch(/not found/i);
    expect(other.replace(String(bobsProject), "N")).toBe(
      missing.replace("987654", "N"),
    );
    expect(other).not.toContain("user2000");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("given GitHub fails, when get_project is called, then Error: and it says to retry", async () => {
    const { app, alice, projectId } = await withProject({ treesStatus: 500 });

    const result = await callTool(app, alice.secret, "get_project", {
      project_id: projectId,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Error: .*(retry|try again)/is);
  });
});

describe("get_project when GitHub does not answer as usual", () => {
  it("given the App can no longer reach the repo (root tree 404), when get_project is called, then ok with the project, its tickets, claude_md empty and claude_md_unreachable true, not an Error", async () => {
    const { app, db, alice, projectId } = await withProject({
      files: { "CLAUDE.md": "# jamais lu" },
      treesStatus: 404,
    });
    const t1 = await seedTicket(db, projectId, "Premier");

    const data = dataOf<{
      project: Record<string, unknown>;
      claude_md: string;
      claude_md_unreachable?: boolean;
      tickets: unknown[];
    }>(
      await callTool(app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    expect(data.project).toMatchObject({ id: projectId });
    expect(data.claude_md).toBe("");
    expect(data.claude_md_unreachable).toBe(true);
    expect(data.tickets).toEqual([{ id: t1, title: "Premier", step: "new" }]);
    expect(shape(await onlyEntry(db))).toMatchObject({
      action: "get_project",
      result: "ok",
      detail: null,
    });
  });

  it("given a repo that is reachable, when get_project is called, then claude_md_unreachable is not true", async () => {
    const { app, alice, projectId } = await withProject({
      files: { "README.md": "hello" },
    });

    const data = dataOf<{ claude_md_unreachable?: boolean }>(
      await callTool(app, alice.secret, "get_project", {
        project_id: projectId,
      }),
    );

    expect(data.claude_md_unreachable ?? false).toBe(false);
  });

  it("given GitHub fails with 500, when get_project is called, then exactly one get_project error entry and Error: with retry advice", async () => {
    const { app, db, alice, projectId } = await withProject({
      treesStatus: 500,
    });

    const result = await callTool(app, alice.secret, "get_project", {
      project_id: projectId,
    });

    expect(textOf(result)).toMatch(/^Error: .*(retry|try again)/is);
    const entries = await rows(db, sql`action = 'get_project'`);
    expect(entries.map((e) => [e.result, e.detail])).toEqual([
      ["error", { reason: "error" }],
    ]);
  });

  it("given a GitHub read in progress, when another request comes in, then it is served without waiting for GitHub (no database transaction is held during the read)", async () => {
    const { app, alice, projectId } = await withProject({ account: 1000 });
    const stub = globalThis.fetch;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedGitHub = () => {};
    const reached = new Promise<void>((resolve) => {
      reachedGitHub = resolve;
    });
    // The repo read hangs until the test lets it fail; every other GitHub call goes to the usual stub.
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.includes("/git/trees/")) return stub(input, init);
        reachedGitHub();
        await gate;
        return Response.json({ message: "boom" }, { status: 500 });
      },
    );

    const slow = callTool(app, alice.secret, "get_project", {
      project_id: projectId,
    });
    // `slow` rejecting first (no /mcp route yet) fails the test instead of hanging it.
    await Promise.race([reached, slow]);
    const parallel = callTool(app, alice.secret, "list_projects", {});
    const first = await Promise.race([
      parallel.then(() => "served" as const),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 5_000),
      ),
    ]);
    release();
    await parallel;
    const result = await slow;

    expect(first, "a request while GitHub is being read").toBe("served");
    expect(textOf(result)).toMatch(/^Error: /);
  });
});

describe("protocol details of /mcp", () => {
  const post = (app: App, secret: string, body: string) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${secret}`,
      },
      body,
    });

  it.each(["GET", "DELETE"])(
    "given a valid token, when %s /mcp is requested, then 405 with Allow: POST",
    async (method) => {
      const { app, alice } = await withProject();

      const res = await app.request("/mcp", {
        method,
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${alice.secret}`,
        },
      });

      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    },
  );

  it("given a notification (no id), when it is posted with a valid token, then 202 with no body", async () => {
    const { app, alice } = await withProject();

    const res = await post(
      app,
      alice.secret,
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );

    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("given a body over 256 KiB, when it is posted with a valid token, then 413", async () => {
    const { app, alice } = await withProject();

    const res = await post(
      app,
      alice.secret,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search",
          arguments: { query: "x".repeat(256 * 1024 + 1) },
        },
      }),
    );

    expect(res.status).toBe(413);
  });

  // Decision 021 A: the three OAuth discovery paths are served now (oauth.test.ts); every other path stays a 404.
  it.each(["/.well-known/openid-configuration", "/.well-known/nope"])(
    "given the other /.well-known path %s, when it is requested, then 404 as JSON, not the page",
    async (path) => {
      const { app } = await setup();

      const res = await app.request(path);

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
    },
  );
});

describe("criterion 7: search", () => {
  /** Alice: an active project, an archived one; Bob: a project. Tickets in each. */
  async function searchWorld() {
    const ctx = await withProject();
    const { app, db, alice } = ctx;
    const p1 = await seedProject(db, alice.id, {
      githubRepoId: 11,
      fullName: "alice/Gestion-Projet",
    });
    const p2 = await seedProject(db, alice.id, {
      githubRepoId: 12,
      fullName: "alice/gestion-archive",
      archivedAt: new Date(),
    });
    const bob = await userWithToken(app, db, 2000);
    const p3 = await seedProject(db, bob.id, {
      githubRepoId: 13,
      fullName: "bob/gestion-projet-bob",
    });
    const t1 = await seedTicket(db, p1, "Ajouter la connexion GitHub");
    const t2 = await seedTicket(db, p1, "Connexion par mot de passe");
    await seedTicket(db, p2, "Connexion archivée");
    await seedTicket(db, p3, "Connexion de Bob");
    return { ...ctx, p1, p2, p3, t1, t2, bob };
  }
  const search = async (
    ctx: { app: App; alice: { secret: string } },
    args: unknown,
  ) =>
    dataOf<{ results: Record<string, unknown>[] }>(
      await callTool(ctx.app, ctx.alice.secret, "search", args),
    ).results;

  it("given the query 'GESTION projet', when search is called, then the project whose name holds both words matches whatever the case, as { type: 'project', id, title, project_id }", async () => {
    const ctx = await searchWorld();

    expect(await search(ctx, { query: "GESTION projet" })).toEqual([
      {
        type: "project",
        id: ctx.p1,
        title: "alice/Gestion-Projet",
        project_id: ctx.p1,
      },
    ]);
  });

  it("given the query 'connexion github', when search is called, then only the ticket holding every word comes back, as { type: 'ticket', id, title, project_id, step }", async () => {
    const ctx = await searchWorld();

    expect(await search(ctx, { query: "connexion github" })).toEqual([
      {
        type: "ticket",
        id: ctx.t1,
        title: "Ajouter la connexion GitHub",
        project_id: ctx.p1,
        step: "new",
      },
    ]);
  });

  it("given the query 'CONNEXION', when search is called, then the tickets of the caller's active projects only: not Bob's, not the archived project's", async () => {
    const ctx = await searchWorld();

    const results = await search(ctx, { query: "CONNEXION" });

    expect(results.map((r) => r.id).sort()).toEqual([ctx.t1, ctx.t2].sort());
    expect(results.every((r) => r.project_id === ctx.p1)).toBe(true);
  });

  it("given words that only another user's or an archived project's items hold, when search is called, then no result and no refusal", async () => {
    const ctx = await searchWorld();

    for (const query of ["bob", "archivée", "gestion-archive"])
      expect(await search(ctx, { query }), query).toEqual([]);
  });

  it("given a project_id, when search is called, then only items of that project come back", async () => {
    const ctx = await searchWorld();
    // Another active project of Alice holding the same word.
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 14,
      fullName: "alice/autre",
    });
    await seedTicket(ctx.db, other, "Connexion ailleurs");

    const results = await search(ctx, {
      query: "connexion",
      project_id: ctx.p1,
    });

    expect(results.map((r) => r.id).sort()).toEqual([ctx.t1, ctx.t2].sort());
    expect(results.every((r) => r.project_id === ctx.p1)).toBe(true);
  });

  it("given another user's project_id, when search is called, then Refused not found", async () => {
    const ctx = await searchWorld();

    const result = await callTool(ctx.app, ctx.alice.secret, "search", {
      query: "connexion",
      project_id: ctx.p3,
    });

    expect(expectRefused(result)).toMatch(/not found/i);
  });

  it("given 25 matching tickets, when search is called, then at most 20 results", async () => {
    const ctx = await searchWorld();
    for (let i = 0; i < 25; i++)
      await seedTicket(ctx.db, ctx.p1, `aiguille numero ${i}`);

    expect(await search(ctx, { query: "aiguille" })).toHaveLength(20);
  });

  it.each(["%%", "__"])(
    "given the query %s made of LIKE wildcards, when search is called, then it matches literally: nothing",
    async (query) => {
      const ctx = await searchWorld();

      expect(await search(ctx, { query })).toEqual([]);
    },
  );

  it("given a query of 2 and one of 200 characters, when search is called, then both are accepted", async () => {
    const ctx = await searchWorld();

    expect(await search(ctx, { query: "xy" })).toEqual([]);
    expect(await search(ctx, { query: "x".repeat(200) })).toEqual([]);
  });
});

describe("criterion 8: get_ticket", () => {
  it("given a ticket, when get_ticket is called, then its title, description_md, step and an empty stories list", async () => {
    const { app, db, alice, projectId } = await withProject();
    const id = await seedTicket(
      db,
      projectId,
      "Une idée",
      "## Détails\n\ntexte",
    );

    const data = dataOf<Record<string, unknown>>(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: id }),
    );

    expect(data).toMatchObject({
      id,
      title: "Une idée",
      description_md: "## Détails\n\ntexte",
      step: "new",
      stories: [],
    });
  });

  it("given a ticket of an archived project, when get_ticket is called, then it is still readable", async () => {
    const { app, db, alice, projectId } = await withProject();
    const id = await seedTicket(db, projectId, "Ancienne idée");
    await db
      .update(projects)
      .set({ archivedAt: new Date() })
      .where(eq(projects.id, projectId));

    const data = dataOf<{ title: string }>(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: id }),
    );

    expect(data.title).toBe("Ancienne idée");
  });

  it("given another user's ticket and a ticket that does not exist, when get_ticket is called on each, then both get the same Refused not found and nothing of the ticket leaks", async () => {
    const { app, db, alice } = await withProject();
    const bob = await userWithToken(app, db, 2000);
    const bobsProject = await seedProject(db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });
    const bobsTicket = await seedTicket(db, bobsProject, "Idée-privée-de-Bob");

    const other = expectRefused(
      await callTool(app, alice.secret, "get_ticket", {
        ticket_id: bobsTicket,
      }),
    );
    const missing = expectRefused(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: 987654 }),
    );

    expect(other).toMatch(/not found/i);
    expect(other.replace(String(bobsTicket), "N")).toBe(
      missing.replace("987654", "N"),
    );
    expect(other).not.toContain("Idée-privée");
  });
});

describe("criterion 9: create_ticket", () => {
  it("given a title and a description, when create_ticket is called, then the ticket exists at step new with the title trimmed and the description as typed, its id is returned, and the UI list shows it", async () => {
    const { app, alice, projectId } = await withProject();

    const created = dataOf<{ id: number }>(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: projectId,
        title: "  Noter cette idée  ",
        description_md: "  Un peu de *markdown*\n",
      }),
    );

    expect(Number.isInteger(created.id)).toBe(true);
    const res = await ticketsOf(app, alice.cookie, projectId);
    const { tickets: listed } = (await res.json()) as {
      tickets: {
        id: number;
        title: string;
        descriptionMd: string;
        step: string;
      }[];
    };
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        title: "Noter cette idée",
        descriptionMd: "  Un peu de *markdown*\n",
        step: "new",
      }),
    ]);
  });

  it("given no description, when create_ticket is called, then the description is empty", async () => {
    const { app, alice, projectId } = await withProject();

    dataOf(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: projectId,
        title: "Juste un titre",
      }),
    );

    const { tickets: listed } = (await (
      await ticketsOf(app, alice.cookie, projectId)
    ).json()) as { tickets: { descriptionMd: string }[] };
    expect(listed.map((t) => t.descriptionMd)).toEqual([""]);
  });

  it("given the limits of the UI, when a title of 200 and a description of 50,000 characters are sent, then the ticket is created", async () => {
    const { app, alice, projectId } = await withProject();

    dataOf(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: projectId,
        title: "t".repeat(200),
        description_md: "d".repeat(50_000),
      }),
    );

    const { tickets: listed } = (await (
      await ticketsOf(app, alice.cookie, projectId)
    ).json()) as { tickets: unknown[] };
    expect(listed).toHaveLength(1);
  });

  it.each([
    ["a blank title", "title", { title: "   " }],
    ["a title over 200 characters", "title", { title: "t".repeat(201) }],
    ["a title with a NUL character", "title", { title: "a\0b" }],
    [
      "a description over 50,000 characters",
      "description_md",
      { title: "ok", description_md: "d".repeat(50_001) },
    ],
    [
      "a description with a NUL character",
      "description_md",
      { title: "ok", description_md: "a\0b" },
    ],
  ])(
    "given %s, when create_ticket is called, then Refused naming %s, no ticket and no free text in history",
    async (_name, field, args) => {
      const { app, db, alice, projectId } = await withProject();

      const text = expectRefused(
        await callTool(app, alice.secret, "create_ticket", {
          project_id: projectId,
          ...args,
        }),
      );

      expect(text).toContain(field);
      const { tickets: listed } = (await (
        await ticketsOf(app, alice.cookie, projectId)
      ).json()) as { tickets: unknown[] };
      expect(listed).toEqual([]);
      const entry = await onlyEntry(db);
      expect(entry).toMatchObject({
        action: "create_ticket",
        result: "refused",
        args: {},
        detail: { reason: "invalid_arguments" },
      });
    },
  );

  it("given an archived project, when create_ticket is called, then Refused project archived, no ticket, journaled project_archived with args { projectId }", async () => {
    const { app, db, alice, projectId } = await withProject();
    await db
      .update(projects)
      .set({ archivedAt: new Date() })
      .where(eq(projects.id, projectId));

    const text = expectRefused(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: projectId,
        title: "Trop tard",
      }),
    );

    expect(text).toMatch(/archived/i);
    expect(await db.select().from(tickets)).toEqual([]);
    expect(shape(await onlyEntry(db))).toEqual({
      user_id: alice.id,
      token_id: alice.tokenId,
      project_id: projectId,
      ticket_id: null,
      actor: "claude",
      origin: "mcp",
      action: "create_ticket",
      args: { projectId },
      result: "refused",
      detail: { reason: "project_archived" },
    });
    expect(await historyText(db)).not.toContain("Trop tard");
  });

  it("given another user's project, when create_ticket is called, then Refused not found and no ticket", async () => {
    const { app, db, alice } = await withProject();
    const bob = await userWithToken(app, db, 2000);
    const bobsProject = await seedProject(db, bob.id, {
      githubRepoId: 9,
      fullName: "user2000/private",
    });

    const text = expectRefused(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: bobsProject,
        title: "Intrusion",
      }),
    );

    expect(text).toMatch(/not found/i);
    expect(await db.select().from(tickets)).toEqual([]);
    expect(await historyText(db)).not.toContain("Intrusion");
  });
});
