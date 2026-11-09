import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogWrites, sessions, users } from "./db/schema.ts";
import {
  seedProject,
  seedStory,
  seedTicket,
  setup,
  type TestDb,
} from "./test-mcp.ts";

// Slice 15.4 (decision 075 A, B, E): the getting-started guide in GET /api/home.
//
// Pinned shapes:
//   GET /api/home -> { ..., onboarding: null | { steps: Step[] } }
//   Step = { key, done: boolean, detail: string | null, projectId: number | null, storyId: number | null }, six steps,
//   in the order of steps 2 to 7 of S06 (step 1, the App installed, comes from /api/installation):
//   keys "project", "claude", "prepare", "idea", "validate", "develop".
//   projectId / storyId: where « Faire » leads (the first project not prepared, the first story to validate or ready), null when none.
//   onboarding is null once the six steps are done, or hidden.
//   POST /api/me/onboarding/hide -> 200 { ok: true }, 401 { error: "Unauthorized" }; keeps users.onboarding_hidden_at.

afterEach(() => {
  vi.unstubAllGlobals();
});

const KEYS = ["project", "claude", "prepare", "idea", "validate", "develop"];
type Onboarding = null | {
  steps: { key: string; done: boolean; detail: string | null }[];
};

async function newUser(db: TestDb, githubId: number) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `user${githubId}` })
    .returning({ id: users.id });
  if (!user) throw new Error("no user");
  const value = `cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: createHash("sha256").update(value).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: user.id, cookie: `cockpit_session=${value}` };
}

type App = Awaited<ReturnType<typeof setup>>["app"];
const home = async (app: App, cookie: string) => {
  const res = await app.request("/api/home", { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { onboarding?: Onboarding }).onboarding;
};
const done = async (app: App, cookie: string) =>
  (await home(app, cookie))?.steps.map((s) => s.done);

const addToken = (db: TestDb, userId: number, revoked = false) =>
  db.execute(
    sql`insert into mcp_tokens (user_id, name, token_hash, last_four, revoked_at)
        values (${userId}, 't', ${`h${Math.random()}`}, 'abcd', ${revoked ? new Date().toISOString() : null}::timestamptz)`,
  );

describe("slice 15.4: the getting-started guide on the home", () => {
  it("given a brand-new user with nothing, when the home loads, then onboarding lists steps 2 to 7, none done", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);

    const onboarding = await home(app, alice.cookie);

    expect(onboarding?.steps.map((s) => s.key)).toEqual(KEYS);
    expect(onboarding?.steps.map((s) => s.done)).toEqual(Array(6).fill(false));
  });

  it("given a user who does the steps one by one, when the home loads after each, then each step flips and onboarding is null at the end", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    const flags = (n: number) => KEYS.map((_, i) => i < n);

    const projectId = await seedProject(db, alice.id, {
      githubRepoId: 1,
      fullName: "user1/app",
    });
    expect(await done(app, alice.cookie)).toEqual(flags(1));

    await addToken(db, alice.id);
    expect(await done(app, alice.cookie)).toEqual(flags(2));

    await db
      .insert(catalogWrites)
      .values({ projectId, path: ".claude/skills/dev-us.md", sha256: "x" });
    expect(await done(app, alice.cookie)).toEqual(flags(3));

    const ticketId = await seedTicket(db, projectId, "une idée");
    expect(await done(app, alice.cookie)).toEqual(flags(4));

    const toValidate = await seedStory(db, ticketId, { status: "to_validate" });
    const validated = await app.request(`/api/stories/${toValidate}/validate`, {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    expect(validated.status).toBe(200);
    expect(await done(app, alice.cookie)).toEqual(flags(5));

    const withPr = await seedStory(db, ticketId, { status: "in_review" });
    await db.execute(
      sql`update user_stories set pr_number = 7 where id = ${withPr}`,
    );
    expect(await home(app, alice.cookie)).toBeNull();
  });

  it("given a user whose only MCP token is revoked, when the home loads, then step 3 is not done", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    await addToken(db, alice.id, true);

    expect((await done(app, alice.cookie))?.[1]).toBe(false);

    await addToken(db, alice.id);
    expect((await done(app, alice.cookie))?.[1]).toBe(true);
  });

  it("given a user who hides the guide, when the home loads, then onboarding is null for them only", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    const bob = await newUser(db, 2);

    const res = await app.request("/api/me/onboarding/hide", {
      method: "POST",
      headers: { cookie: alice.cookie },
    });

    expect(res.status).toBe(200);
    expect(await home(app, alice.cookie)).toBeNull();
    expect((await home(app, bob.cookie))?.steps).toHaveLength(6);
  });

  it("given no session, when someone hides the guide, then it is 401", async () => {
    const { app } = await setup();

    const res = await app.request("/api/me/onboarding/hide", {
      method: "POST",
    });

    expect(res.status).toBe(401);
  });
});
