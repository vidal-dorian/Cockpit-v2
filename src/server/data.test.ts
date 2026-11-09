import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { history } from "./db/schema.ts";
import {
  countOf,
  fingerprintOf,
  fingerprints,
  type Life,
  signInAgain,
  stubSignIn,
  withLife,
} from "./test-data.ts";
import { send } from "./test-decisions.ts";
import { createAdminWithSession } from "./test-instance.ts";
import { rows, userWithToken, withProject } from "./test-mcp.ts";
import { stubSharing } from "./test-members.ts";
import { get, ownMore, planOf } from "./test-plans.ts";

// Slice 13.5 (decision 078 A to G, the contract is in test-data.ts). Alice is user1000; see `withLife` for what she holds.

afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = "/api/me";
const del = (ctx: Life, login: unknown = "user1000") =>
  send(ctx.app, ctx.alice.cookie, "DELETE", ME, { login });
const mine = (ctx: Life) => `user_id = ${ctx.alice.id}`;

describe("078 A: the lines of the Données page", () => {
  it("given Alice's data, when GET /api/me/data is read, then it gives the counts read from the database and the shared projects she owns with their members", async () => {
    const ctx = await withLife();
    const journal = (await rows(ctx.db, sql.raw(mine(ctx)))).length;

    const res = await get(ctx.app, ctx.alice.cookie, `${ME}/data`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: null,
      login: "user1000",
      isAdmin: false,
      projects: 3,
      tickets: 2,
      stories: 2,
      runs: 2,
      questions: 1,
      journal,
      tokens: 1,
      shared: [
        { id: ctx.projectId, fullName: "user1000/app", members: ["user2000"] },
      ],
    });
    expect(journal).toBeGreaterThanOrEqual(3);
  });

  it("given no session, when GET /api/me/data is read, then it answers 401", async () => {
    const ctx = await withProject();

    expect((await ctx.app.request(`${ME}/data`)).status).toBe(401);
  });
});

describe("078 B: the export", () => {
  it("given Alice's data, when she exports, then the file holds her account, her projects with tickets, stories, criteria, runs, steps and questions, her own entries, her tokens and her settings", async () => {
    const ctx = await withLife();

    const res = await get(ctx.app, ctx.alice.cookie, `${ME}/export`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="cockpit-user1000-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const body = await res.json();
    expect(body.account).toMatchObject({ login: "user1000" });
    const names = body.projects.map((p: { fullName: string }) => p.fullName);
    expect(names.sort()).toEqual([
      "owner1000/old0",
      "user1000/app",
      "user3000/other",
    ]);
    const app = body.projects.find(
      (p: { fullName: string }) => p.fullName === "user1000/app",
    );
    expect(app.role).toBe("owner");
    expect(app.tickets[0].title).toBe("Le ticket d'Alice");
    expect(app.tickets[0].stories[0].iWant).toBe("écrire un export");
    expect(app.tickets[0].stories[0].criteria[0].thenText).toBe(
      "le critère d'Alice",
    );
    expect(app.runs).toHaveLength(2);
    const run = app.runs.find((r: { id: number }) => r.id === ctx.runId);
    expect(run.steps[0].agent).toBe("developer");
    expect(run.questions[0].question).toBe("Quel nom pour le bouton ?");
    const actions = body.history.map((e: { action: string }) => e.action);
    expect(actions).toContain("alice_in_her_project");
    expect(actions).not.toContain("bob_in_alices");
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0].name).toBe("Mon Claude");
    expect(body.settings.theme).toBe("dark");
  });

  it("given secrets in the database, when she exports, then no hash, secret or encrypted value appears, under any key", async () => {
    const ctx = await withLife();
    const [stored] = (
      (await ctx.db.execute(
        sql`select token_hash from mcp_tokens where user_id = ${ctx.alice.id}`,
      )) as unknown as { rows: { token_hash: string }[] }
    ).rows;

    const res = await get(ctx.app, ctx.alice.cookie, `${ME}/export`);
    expect(res.status).toBe(200);
    const text = await res.text();

    const keys = [...text.matchAll(/"([^"]+)":/g)].map((m) => m[1] as string);
    expect(keys.filter((k) => /hash|secret|encrypted|key/i.test(k))).toEqual(
      [],
    );
    for (const secret of [
      ctx.alice.secret,
      stored?.token_hash,
      "P256DH-VALUE",
      "PUSH-AUTH-VALUE",
      "pro-code-hash",
      "inv-by-alice",
      "inv-for-alice",
    ])
      expect(text).not.toContain(secret);
    expect(text).not.toContain("v1:"); // the instance secrets are AES values
  });

  it("given an export, when it is made, then export_data is journaled for her without arguments", async () => {
    const ctx = await withLife();

    await get(ctx.app, ctx.alice.cookie, `${ME}/export`);

    const entries = (await rows(ctx.db)).filter(
      (r) => r.action === "export_data",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: ctx.alice.id,
      result: "ok",
      args: {},
    });
  });

  it("given no session, when the export is requested, then it answers 401", async () => {
    const ctx = await withProject();

    expect((await ctx.app.request(`${ME}/export`)).status).toBe(401);
  });
});

describe("078 C: deleting the account", () => {
  it("given a wrong or missing login, when she deletes, then it answers 400 and nothing is deleted", async () => {
    const ctx = await withLife();

    for (const login of ["user1001", "USER1000", undefined]) {
      const res = await del(ctx, login);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "login_mismatch" });
    }
    expect(await countOf(ctx.db, "users", `id = ${ctx.alice.id}`)).toBe(1);
    expect(await countOf(ctx.db, "projects")).toBe(3);
  });

  it("given no session, when DELETE /api/me is sent, then it answers 401 and nothing is deleted", async () => {
    const ctx = await withLife();

    const res = await ctx.app.request(ME, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "user1000" }),
    });

    expect(res.status).toBe(401);
    expect(await countOf(ctx.db, "users", `id = ${ctx.alice.id}`)).toBe(1);
  });

  it("given the right login, when she deletes, then her projects and all they hold are gone for every member, and Carol's project keeps all but her", async () => {
    const ctx = await withLife();

    const res = await del(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const { db } = ctx;
    expect(await countOf(db, "users", `id = ${ctx.alice.id}`)).toBe(0);
    expect(await countOf(db, "users", `id = ${ctx.bob.id}`)).toBe(1);
    // Only Carol's project, with its ticket, story and criterion and its owner, is left.
    for (const [table, left] of [
      ["projects", 1],
      ["project_members", 1],
      ["tickets", 1],
      ["user_stories", 1],
      ["acceptance_criteria", 1],
      ["runs", 0],
      ["run_steps", 0],
      ["questions", 0],
    ] as const)
      expect(await countOf(db, table), table).toBe(left);
  });

  it("given the right login, when she deletes, then her queue and night in Carol's project, tokens, sessions, push subscriptions, routines and invitations are gone and the others' stay", async () => {
    const ctx = await withLife();

    await del(ctx);

    const { db } = ctx;
    for (const table of [
      "queue_items",
      "nights",
      "night_items",
      "push_subscriptions",
      "routines",
      "project_invitations",
    ])
      expect(await countOf(db, table), table).toBe(0);
    // Bob's and Carol's tokens and sessions are untouched.
    expect(await countOf(db, "mcp_tokens")).toBe(2);
    expect(await countOf(db, "sessions")).toBe(2);
    expect(await countOf(db, "mcp_tokens", `user_id = ${ctx.alice.id}`)).toBe(
      0,
    );
  });

  it("given a Pro code of hers, when she deletes, then the code stays used but linked to nobody", async () => {
    const ctx = await withLife();

    await del(ctx);

    const [code] = (
      (await ctx.db.execute(
        sql`select user_id, used_at from pro_codes where id = ${ctx.code}`,
      )) as unknown as { rows: { user_id: number | null; used_at: Date }[] }
    ).rows;
    expect(code?.user_id).toBeNull();
    expect(code?.used_at).not.toBeNull();
  });

  it("given the right login, when she deletes, then her session is closed and nothing is called on GitHub", async () => {
    const ctx = await withLife();
    vi.mocked(globalThis.fetch).mockClear();

    const res = await del(ctx);

    expect(res.headers.getSetCookie().join(";")).toMatch(
      /cockpit_session=;|cockpit_session=[^;]*;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i,
    );
    expect((await get(ctx.app, ctx.alice.cookie, `${ME}/data`)).status).toBe(
      401,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("given a shared project she owns, when the window asks, then it lists that project and its members' logins only", async () => {
    const ctx = await withLife();

    const body = await (
      await get(ctx.app, ctx.alice.cookie, `${ME}/data`)
    ).json();

    expect(body.shared).toEqual([
      { id: ctx.projectId, fullName: "user1000/app", members: ["user2000"] },
    ]);
  });
});

describe("078 D: the journal", () => {
  const base = { actor: "human", origin: "ui", result: "ok" } as const;

  it("given entries of a person and of a project, when the reserved function runs, then they are gone, one anonymous account_deleted remains, and a direct UPDATE, DELETE or TRUNCATE is still refused", async () => {
    const ctx = await withProject();
    const { db } = ctx;
    await db.insert(history).values([
      { ...base, userId: 11, action: "hers" },
      { ...base, userId: 12, projectId: 21, action: "in_her_project" },
      { ...base, userId: 12, projectId: 22, action: "someone_else" },
      { ...base, userId: null, projectId: null, action: "unrelated" },
    ]);

    await db.execute(sql`select erase_account_history(11, array[21])`);

    const left = (await rows(db)).map((r) => r.action).sort();
    expect(left).toEqual(["account_deleted", "someone_else", "unrelated"]);
    const [gone] = await rows(db, sql`action = 'account_deleted'`);
    expect(gone).toMatchObject({
      user_id: null,
      project_id: null,
      actor: "system",
      origin: "system",
      result: "ok",
      args: {},
    });
    for (const statement of [
      sql`update history set action = 'edited'`,
      sql`delete from history`,
      sql`truncate table history`,
    ])
      await expect(db.execute(statement)).rejects.toThrow();
    expect(await rows(db)).toHaveLength(3);
  });

  it("given the route, when she deletes, then none of her entries nor those of her projects remain, Bob's elsewhere stay, and one anonymous account_deleted is left", async () => {
    const ctx = await withLife();

    await del(ctx);

    const all = await rows(ctx.db);
    expect(all.filter((r) => r.user_id === ctx.alice.id)).toEqual([]);
    expect(
      all.filter((r) => [ctx.projectId, ctx.oldId].includes(r.project_id ?? 0)),
    ).toEqual([]);
    expect(all.map((r) => r.action)).toContain("bob_in_carols");
    const gone = all.filter((r) => r.action === "account_deleted");
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ user_id: null, args: {} });
  });
});

describe("078 E: the fingerprint", () => {
  const repo = {
    id: 500,
    full_name: "user1000/new",
    default_branch: "main",
    private: false,
    is_template: false,
  };

  it("given 3 repos owned, when she deletes, then only the HMAC of her GitHub id and the 3 are kept", async () => {
    const ctx = await withProject();
    await ownMore(ctx.db, ctx.alice.id, 2);

    const res = await send(ctx.app, ctx.alice.cookie, "DELETE", ME, {
      login: "user1000",
    });

    expect(res.status).toBe(200);
    expect(await fingerprints(ctx.db)).toEqual([
      { fingerprint: fingerprintOf(1000), repos_used: 3 },
    ]);
  });

  it("given 3 repos used before a deletion, when the same GitHub account signs in again and imports a repo, then the quota counts the 3 and the import is refused", async () => {
    const ctx = await withProject({ repositories: [repo] });
    await ownMore(ctx.db, ctx.alice.id, 2);
    const deleted = await send(ctx.app, ctx.alice.cookie, "DELETE", ME, {
      login: "user1000",
    });
    expect(deleted.status).toBe(200);
    stubSignIn(1000, "user1000");

    const cookie = await signInAgain(ctx.app);

    expect(cookie).toContain("cockpit_session=");
    expect(await planOf(ctx.app, cookie)).toMatchObject({
      plan: "free",
      repos: 3,
      limit: 3,
    });
    const res = await send(ctx.app, cookie, "POST", "/api/projects", {
      githubRepoId: 500,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "plan" });
  });

  it("given a Free account that owned 1 repo, when it returns, then it may import 2 more", async () => {
    const ctx = await withProject({ repositories: [repo] });
    const deleted = await send(ctx.app, ctx.alice.cookie, "DELETE", ME, {
      login: "user1000",
    });
    expect(deleted.status).toBe(200);
    stubSignIn(1000, "user1000");

    const cookie = await signInAgain(ctx.app);

    expect(await planOf(ctx.app, cookie)).toMatchObject({ repos: 1 });
    expect(
      (
        await send(ctx.app, cookie, "POST", "/api/projects", {
          githubRepoId: 500,
        })
      ).status,
    ).toBe(201);
  });
});

describe("078 F: erasing a fingerprint", () => {
  const kept = async () => {
    const ctx = await withProject();
    await ownMore(ctx.db, ctx.alice.id, 2);
    await send(ctx.app, ctx.alice.cookie, "DELETE", ME, { login: "user1000" });
    stubSharing({ users: { user1000: 1000 } });
    const boss = await createAdminWithSession(ctx.db, 99);
    return { ...ctx, boss };
  };
  const erase = (ctx: Awaited<ReturnType<typeof kept>>, login: string) =>
    send(ctx.app, ctx.boss.cookie, "POST", "/api/settings/fingerprints/erase", {
      login,
    });

  it("given a kept fingerprint, when the administrator erases it by login, then it is gone, and fingerprint_erased is journaled without the login", async () => {
    const ctx = await kept();

    const plain = await userWithToken(ctx.app, ctx.db, 2000);
    const refused = await send(
      ctx.app,
      plain.cookie,
      "POST",
      "/api/settings/fingerprints/erase",
      { login: "user1000" },
    );
    expect(refused.status).toBe(403);
    expect(await fingerprints(ctx.db)).toHaveLength(1);

    const res = await erase(ctx, "user1000");

    expect(res.status).toBe(200);
    expect(await fingerprints(ctx.db)).toEqual([]);
    const entries = (await rows(ctx.db)).filter(
      (r) => r.action === "fingerprint_erased",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: ctx.boss.id,
      result: "ok",
      args: {},
    });
    expect(JSON.stringify(entries[0])).not.toContain("user1000");
  });

  it("given no fingerprint for the account, when the administrator erases it, then 404 no_fingerprint", async () => {
    const ctx = await kept();
    await ctx.db.execute(sql`delete from account_fingerprints`);

    const res = await erase(ctx, "user1000");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_fingerprint" });
  });

  it("given a login GitHub does not know, when the administrator erases it, then 404 unknown_login", async () => {
    const ctx = await kept();

    const res = await erase(ctx, "nobody");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_login" });
    expect(await fingerprints(ctx.db)).toHaveLength(1);
  });
});

describe("078 G: the administrator", () => {
  it("given an instance administrator, when she deletes her account, then 403 admin and nothing is deleted; the page data says isAdmin", async () => {
    const ctx = await withProject();
    const boss = await createAdminWithSession(ctx.db, 99);

    const res = await send(ctx.app, boss.cookie, "DELETE", ME, {
      login: "admin99",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "admin" });
    expect(await countOf(ctx.db, "users", `id = ${boss.id}`)).toBe(1);
    expect(
      (await (await get(ctx.app, boss.cookie, `${ME}/data`)).json()).isAdmin,
    ).toBe(true);
  });
});
