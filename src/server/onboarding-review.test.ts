import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogWrites, sessions, users } from "./db/schema.ts";
import {
  archiveProject,
  seedProject,
  seedStory,
  seedTicket,
  setup,
  type TestDb,
} from "./test-mcp.ts";

// Slice 15.4, review fixes (decision 075 A, B): the edges of the getting-started guide in GET /api/home.

afterEach(() => {
  vi.unstubAllGlobals();
});

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

type Step = {
  key: string;
  done: boolean;
  projectId: number | null;
  storyId: number | null;
};
type App = Awaited<ReturnType<typeof setup>>["app"];
const steps = async (app: App, cookie: string) => {
  const res = await app.request("/api/home", { headers: { cookie } });
  return ((await res.json()) as { onboarding: { steps: Step[] } }).onboarding
    .steps;
};
const done = async (app: App, cookie: string) =>
  (await steps(app, cookie)).map((s) => s.done);

describe("slice 15.4: the edges of the getting-started guide", () => {
  it("given an OAuth connection whose refresh token expired, when the home loads, then step 3 is not done", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    await db.execute(
      sql`insert into mcp_tokens (user_id, name, token_hash, last_four, client_id, refresh_hash, refresh_expires_at)
          values (${alice.id}, 't', 'h1', 'abcd', 'claude', 'r1', now() - interval '1 day')`,
    );

    expect((await done(app, alice.cookie))[1]).toBe(false);
  });

  it("given a story imported as ready, when the home loads, then step 6 is not done", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    const projectId = await seedProject(db, alice.id, {
      githubRepoId: 1,
      fullName: "user1/app",
    });
    const ticketId = await seedTicket(db, projectId, "une idée");
    await seedStory(db, ticketId, { status: "ready" });

    expect((await done(app, alice.cookie))[4]).toBe(false);
  });

  it("given another user's project, when the home loads, then none of the steps is ticked for this user", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    const bob = await newUser(db, 2);
    const projectId = await seedProject(db, bob.id, {
      githubRepoId: 1,
      fullName: "user2/app",
    });
    await db
      .insert(catalogWrites)
      .values({ projectId, path: ".claude/skills/dev-us.md", sha256: "x" });
    await seedTicket(db, projectId, "une idée");

    expect(await done(app, alice.cookie)).toEqual(Array(6).fill(false));
  });

  it("given an archived project, when the home loads, then it counts for step 2 and « Faire » of step 4 does not lead to it", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    const projectId = await seedProject(db, alice.id, {
      githubRepoId: 1,
      fullName: "user1/app",
    });
    await archiveProject(db, projectId);

    const found = await steps(app, alice.cookie);

    expect(found[0]?.done).toBe(true);
    expect(found[2]?.projectId).toBeNull();
  });
});
