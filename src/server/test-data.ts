// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the criteria (decision 004)
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { vi } from "vitest";
import {
  history,
  nightItems,
  nights,
  proCodes,
  projectInvitations,
  projectMembers,
  pushSubscriptions,
  questions,
  queueItems,
  routines,
  runSteps,
  runs,
} from "./db/schema.ts";
import { TEST_KEY } from "./test-instance.ts";
import {
  type App,
  seedProject,
  seedStory,
  seedTicket,
  type TestDb,
  userWithToken,
  withProject,
} from "./test-mcp.ts";
import { memberWith } from "./test-members.ts";
import { ownMore } from "./test-plans.ts";

// Shared by the acceptance tests of slice 13.5 (decision 078). Pinned where the decision leaves room (the developer follows these):
//
// GET    /api/me/data (session; 401 without) -> 200 { name, login, isAdmin, projects, tickets, stories, runs, questions, journal, tokens, shared }
//          `projects` = the projects the person is a member of (owner included); `tickets`, `stories`, `runs`, `questions` = what those projects hold (every
//          member's runs included); `journal` = the entries with her user_id; `tokens` = her MCP tokens; `shared` = the projects she OWNS that have other
//          members, for the confirmation window: [{ id, fullName, members: ["<login>", ...] }] (the other members' logins, sorted; unshared projects absent).
// GET    /api/me/export (session; 401 without) -> 200 JSON, `content-disposition: attachment; filename="cockpit-<login>-<YYYY-MM-DD>.json"`:
//          { account: { login, name }, projects: [{ id, fullName, role, tickets: [{ id, title, stories: [{ id, iWant, criteria: [{ thenText }] }] }],
//          runs: [{ id, steps: [{ agent }], questions: [{ question }] }] }] (the projects she is a member of), history: [{ action }] (her own entries only),
//          tokens: [{ name, createdAt, lastUsedAt, revokedAt }], settings: { theme, ... } }. No key containing "hash", "secret", "encrypted" or "key"
//          anywhere, no secret value. Journaled `export_data` (ok, her user_id, empty args).
// DELETE /api/me  { login } (session; 401 without) -> 200 { ok: true } and the session cookie cleared (the old cookie is a 401 afterwards).
//          400 { error: "login_mismatch" } when `login` is not her GitHub login exactly (or missing): nothing is deleted. 403 { error: "admin" } for an instance
//          administrator (G). Everything of 078 C is deleted in one transaction; nothing is sent to GitHub.
// POST   /api/settings/fingerprints/erase  { login } (administrator; 403 others, 401 without) -> 200 { ok: true }; the account id is read at GitHub
//          (GET /users/{login}; 404 { error: "unknown_login" } when GitHub does not know it), 404 { error: "no_fingerprint" } when none is kept;
//          journaled `fingerprint_erased` by the administrator, args {} (no login).
// Database (migration): table `account_fingerprints` (fingerprint text primary key, repos_used integer not null) and the function
//          `erase_account_history(p_user_id integer, p_project_ids integer[])`: deletes the entries with user_id = p_user_id or project_id in p_project_ids, then
//          inserts one entry { user_id null, project_id null, actor 'system', origin 'system', action 'account_deleted', args {}, result 'ok' }. It is the only way.
// Fingerprint (E): hex of HMAC-SHA256(key = HMAC-SHA256(instance key, "account-fingerprint"), message = the decimal GitHub id); `repos_used` = the projects the account
//          owned (archived included) + the `repos_used` of the fingerprint already kept; a row exists only after a deletion. GET /api/me/plan `repos` then counts it
//          too, and the quota of 077 refuses the import (403 { error: "plan" }) for a Free account whose owned + kept repos reach 3.

export const SIGNIN_TOKEN = "gho_signin_token";
export const TOKEN_URL = "https://github.com/login/oauth/access_token";

export const fingerprintOf = (githubId: number) =>
  createHmac(
    "sha256",
    createHmac("sha256", TEST_KEY).update("account-fingerprint").digest(),
  )
    .update(String(githubId))
    .digest("hex");

/** Raw count, so no test depends on a Drizzle export. */
export const countOf = async (db: TestDb, table: string, where = "true") =>
  Number(
    (
      (await db.execute(
        sql.raw(`select count(*) as n from ${table} where ${where}`),
      )) as unknown as { rows: { n: string }[] }
    ).rows[0]?.n,
  );

/** The kept fingerprints, raw. */
export const fingerprints = async (db: TestDb) =>
  (
    (await db.execute(sql`select * from account_fingerprints`)) as unknown as {
      rows: { fingerprint: string; repos_used: number }[];
    }
  ).rows;

/** Layers GitHub's OAuth answers on the stub already in place: whoever signs in is `githubId`/`login`. */
export function stubSignIn(githubId: number, login: string) {
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw);
      if (url.origin + url.pathname === TOKEN_URL)
        return Response.json({ access_token: SIGNIN_TOKEN });
      if (raw === "https://api.github.com/user")
        return Response.json({ id: githubId, login, name: login });
      return inner(input, init);
    }),
  );
}

/** Signs in through the real callback; returns the new session's Cookie header. */
export async function signInAgain(app: App) {
  const login = await app.request("/api/auth/login");
  const state = new URL(login.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  const stateCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const res = await app.request(`/api/auth/callback?code=c&state=${state}`, {
    headers: { cookie: stateCookie },
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter(
      (pair) => pair.startsWith("cockpit_session=") && !pair.endsWith("="),
    )
    .join("; ");
}

/**
 * Alice (user1000) owns `user1000/app` (shared with Bob, user2000, who has a run on it) and `owner1000/old0` (not shared), and is a member of Carol's
 * `user3000/other` (a story queued and in her night there, an invitation for her). She has a token, a push subscription, a routine and a Pro code,
 * and every project holds a ticket, a story with a criterion, a run with a step and a question.
 */
export async function withLife() {
  const ctx = await withProject();
  const { db, app, alice, projectId } = ctx;
  const bob = await memberWith({ app, db, projectId }, 2000, "can_validate");
  const carol = await userWithToken(app, db, 3000);
  const [oldId] = await ownMore(db, alice.id, 1);
  const otherId = await seedProject(db, carol.id, {
    githubRepoId: 5,
    fullName: "user3000/other",
  });
  await db
    .insert(projectMembers)
    .values({ projectId: otherId, userId: alice.id, role: "can_launch" });

  const ticketId = await seedTicket(db, projectId, "Le ticket d'Alice");
  const storyId = await seedStory(db, ticketId, {
    iWant: "écrire un export",
    criteria: [{ given: "g", when: "w", then: "le critère d'Alice" }],
  });
  const [run] = await db
    .insert(runs)
    .values({
      storyId,
      userId: alice.id,
      status: "succeeded",
      modelActual: "opus",
    })
    .returning({ id: runs.id });
  const [bobRun] = await db
    .insert(runs)
    .values({ storyId, userId: bob.id, status: "failed", modelActual: "opus" })
    .returning({ id: runs.id });
  if (!run || !bobRun) throw new Error("run insert returned no row");
  await db
    .insert(runSteps)
    .values({ runId: run.id, agent: "developer", status: "succeeded" });
  await db.insert(questions).values({
    runId: run.id,
    question: "Quel nom pour le bouton ?",
    answer: "Valider",
  });

  const otherTicket = await seedTicket(db, otherId, "Le ticket de Carol");
  const otherStory = await seedStory(db, otherTicket, { iWant: "chez Carol" });
  await db
    .insert(queueItems)
    .values({ userId: alice.id, storyId: otherStory, position: 1 });
  const [night] = await db
    .insert(nights)
    .values({
      userId: alice.id,
      startsAt: new Date(Date.now() + 3600_000),
      endsAt: new Date(Date.now() + 7200_000),
      status: "planned",
    })
    .returning({ id: nights.id });
  if (!night) throw new Error("night insert returned no row");
  await db
    .insert(nightItems)
    .values({ nightId: night.id, storyId: otherStory, position: 1 });

  await db.insert(pushSubscriptions).values({
    userId: alice.id,
    endpoint: "https://push.example/alice",
    p256dh: "P256DH-VALUE",
    auth: "PUSH-AUTH-VALUE",
  });
  await db.insert(routines).values({
    userId: alice.id,
    name: "Routine d'Alice",
    instruction: "regarde",
    agents: [],
    projectIds: [],
    frequency: "on_demand",
    timeZone: "UTC",
  });
  const week = new Date(Date.now() + 7 * 86_400_000);
  await db.insert(projectInvitations).values([
    {
      projectId: otherId,
      githubId: 1000,
      login: "user1000",
      role: "read_only",
      secretHash: "inv-for-alice",
      expiresAt: week,
    },
    {
      projectId,
      githubId: 4000,
      login: "user4000",
      role: "read_only",
      secretHash: "inv-by-alice",
      expiresAt: week,
    },
  ]);
  const [code] = await db
    .insert(proCodes)
    .values({
      codeHash: "pro-code-hash",
      note: "pour Alice",
      createdAt: new Date(),
      expiresAt: week,
      userId: alice.id,
      usedAt: new Date(),
    })
    .returning({ id: proCodes.id });
  if (!code) throw new Error("code insert returned no row");

  const base = { actor: "human", origin: "ui", result: "ok" } as const;
  await db.insert(history).values([
    { ...base, userId: alice.id, projectId, action: "alice_in_her_project" },
    {
      ...base,
      userId: alice.id,
      projectId: otherId,
      action: "alice_in_carols",
    },
    { ...base, userId: bob.id, projectId, action: "bob_in_alices" },
    { ...base, userId: bob.id, projectId: otherId, action: "bob_in_carols" },
  ]);
  return {
    ...ctx,
    bob,
    carol,
    oldId,
    otherId,
    ticketId,
    storyId,
    code: code.id,
    runId: run.id,
    bobRunId: bobRun.id,
  };
}
export type Life = Awaited<ReturnType<typeof withLife>>;
