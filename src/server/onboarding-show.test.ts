import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sessions, users } from "./db/schema.ts";
import { seedProject, setup, type TestDb } from "./test-mcp.ts";

// Ticket 50: the guide comes back. Pinned: POST /api/me/onboarding/show -> 200 { ok: true }, 401 { error: "Unauthorized" };
// it clears users.onboarding_hidden_at, the mirror of POST /api/me/onboarding/hide.

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
const post = (app: App, path: string, cookie?: string) =>
  app.request(path, { method: "POST", headers: cookie ? { cookie } : {} });
const steps = async (app: App, cookie: string) => {
  const res = await app.request("/api/home", { headers: { cookie } });
  const body = (await res.json()) as {
    onboarding: null | { steps: { key: string; done: boolean }[] };
  };
  return body.onboarding?.steps.map((s) => s.done) ?? null;
};

describe("ticket 50: the getting-started guide can come back", () => {
  it("given the guide hidden after a first step, when the user shows it again, then the home has onboarding again with its done steps still ticked", async () => {
    const { app, db } = await setup();
    const alice = await newUser(db, 1);
    await seedProject(db, alice.id, { githubRepoId: 1, fullName: "user1/app" });
    expect(
      (await post(app, "/api/me/onboarding/hide", alice.cookie)).status,
    ).toBe(200);
    expect(await steps(app, alice.cookie)).toBeNull();

    const res = await post(app, "/api/me/onboarding/show", alice.cookie);

    expect(res.status).toBe(200);
    expect(await steps(app, alice.cookie)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("given no session, when someone shows the guide, then it is 401", async () => {
    const { app } = await setup();

    expect((await post(app, "/api/me/onboarding/show")).status).toBe(401);
  });
});
