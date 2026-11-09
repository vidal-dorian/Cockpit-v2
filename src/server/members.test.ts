import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nightItems, nights, projectMembers, queueItems } from "./db/schema.ts";
import { send } from "./test-decisions.ts";
import { createAdminWithSession } from "./test-instance.ts";
import {
  historyText,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
} from "./test-mcp.ts";
import {
  acceptAndReturn,
  entriesOf,
  INVITEE_TOKEN,
  invite,
  invited,
  memberWith,
  PUBLIC_URL,
  type Sharing,
  TOKEN_URL,
  withSharing,
} from "./test-members.ts";

// Slice 13.1, decision 076 C to J (the contract is written at the top of test-members.ts).

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAUL = { paul: 4000 };
const get = (ctx: Sharing, cookie: string, path: string) =>
  send(ctx.app, cookie, "GET", path);

async function memberRows(ctx: Sharing) {
  const found = await ctx.db.execute(
    sql`select user_id, role from project_members where project_id = ${ctx.projectId} order by user_id`,
  );
  return (found as unknown as { rows: { user_id: number; role: string }[] })
    .rows;
}

async function invitationTable(ctx: Sharing) {
  const found = await ctx.db.execute(
    sql`select row_to_json(t)::text as json, (to_jsonb(t)->>'github_id')::bigint as github_id, t.expires_at from project_invitations t`,
  );
  return (
    found as unknown as {
      rows: { json: string; github_id: number; expires_at: Date }[];
    }
  ).rows;
}

describe("076 D: inviting by GitHub login", () => {
  it("given the owner, when she invites @paul as can_validate, then she gets a one-time link worth 7 days, only its hash and Paul's GitHub id are kept, and the history holds no login", async () => {
    const ctx = await withSharing({ users: PAUL });

    const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
      login: "paul",
      role: "can_validate",
    });

    expect(res.status).toBe(201);
    const { invitation, url } = (await res.json()) as {
      invitation: { id: number; expiresAt: string };
      url: string;
    };
    expect(url).toMatch(new RegExp(`^${PUBLIC_URL}/invitations/[\\w-]{20,}$`));
    const days = (Date.parse(invitation.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    const secret = url.split("/invitations/")[1] as string;
    const stored = await invitationTable(ctx);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.json).not.toContain(secret);
    expect(Number(stored[0]?.github_id)).toBe(4000);
    expect(ctx.calls.map((c) => `${c.method} ${c.url}`)).toContain(
      "GET https://api.github.com/users/paul",
    );
    const entries = await entriesOf(ctx.db, "create_invitation");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      project_id: ctx.projectId,
      user_id: ctx.alice.id,
      result: "ok",
    });
    const history = await historyText(ctx.db);
    expect(history).not.toContain("paul");
    expect(history).not.toContain(secret);
  });

  it("given a login GitHub does not know, when the owner invites it, then 404 unknown_login and nothing is kept", async () => {
    const ctx = await withSharing({ users: PAUL });

    const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
      login: "fantome",
      role: "can_validate",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_login" });
    expect(await invitationTable(ctx)).toEqual([]);
  });

  it("given Bob already a member, when the owner invites him, then 409 already_member", async () => {
    const ctx = await withSharing({ users: { user2000: 2000 } });
    await memberWith(ctx, 2000, "read_only");

    const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
      login: "user2000",
      role: "can_validate",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_member" });
  });

  it("given a pending invitation of @paul on the project, when the owner invites him again, then 409 already_invited", async () => {
    const ctx = await withSharing({ users: PAUL });
    await invited(ctx, "paul");

    const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
      login: "paul",
      role: "read_only",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_invited" });
    expect(await invitationTable(ctx)).toHaveLength(1);
  });

  it("given the owner, when she invites herself, then 409 self", async () => {
    const ctx = await withSharing({ users: { user1000: 1000 } });

    const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
      login: "user1000",
      role: "can_validate",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "self" });
  });

  it.each([["owner"], ["admin"], [undefined]])(
    "given the role %s, when the owner invites, then 400 Bad request",
    async (role) => {
      const ctx = await withSharing({ users: PAUL });

      const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
        login: "paul",
        role,
      });

      expect(res.status).toBe(400);
      expect(await invitationTable(ctx)).toEqual([]);
    },
  );

  it("given a member who is not the owner, when she invites, then 403 role, journaled refused", async () => {
    const ctx = await withSharing({ users: PAUL });
    const bob = await memberWith(ctx, 2000, "can_launch");

    const res = await invite(ctx, bob.cookie, ctx.projectId, {
      login: "paul",
      role: "read_only",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "role" });
    expect(await invitationTable(ctx)).toEqual([]);
    expect(
      (await rows(ctx.db)).filter(
        (r) => r.result === "refused" && r.detail?.reason === "role",
      ),
    ).toHaveLength(1);
  });

  it("given a stranger to the project, when he invites on it, then 404", async () => {
    const ctx = await withSharing({ users: PAUL });
    const eve = await userWithToken(ctx.app, ctx.db, 5000);

    const res = await invite(ctx, eve.cookie, ctx.projectId, {
      login: "paul",
      role: "read_only",
    });

    expect(res.status).toBe(404);
  });
});

describe("076 E: reading and accepting a link", () => {
  it("given a link for Carol, when Carol opens it, then she reads who invites her, on which repo, with which role", async () => {
    const ctx = await withSharing({ users: { user3000: 3000 } });
    const carol = await userWithToken(ctx.app, ctx.db, 3000);
    const { secret } = await invited(ctx, "user3000", "can_validate");

    const res = await get(ctx, carol.cookie, `/api/invitations/${secret}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      invitation: {
        owner: "user1000",
        fullName: "user1000/app",
        role: "can_validate",
      },
    });
  });

  it("given a link, when it is opened without a session, then 401 (the page asks to log in and comes back)", async () => {
    const ctx = await withSharing({ users: { user3000: 3000 } });
    const { secret } = await invited(ctx, "user3000");

    const res = await ctx.app.request(`/api/invitations/${secret}`);

    expect(res.status).toBe(401);
  });

  it("given links that are unknown, expired, cancelled, renewed or for another account, when they are opened, then every one says the same 404 invalid_invitation", async () => {
    const ctx = await withSharing({
      users: { user3000: 3000, user3001: 3001, user3002: 3002, user3003: 3003 },
    });
    const carol = await userWithToken(ctx.app, ctx.db, 3000);
    const expired = await invited(ctx, "user3000");
    await ctx.db.execute(
      sql`update project_invitations set expires_at = now() - interval '1 second'`,
    );
    const cancelled = await invited(ctx, "user3001");
    await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      `/api/invitations/${cancelled.id}`,
    );
    const renewed = await invited(ctx, "user3002");
    await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/invitations/${renewed.id}/renew`,
    );
    const forSomeoneElse = await invited(ctx, "user3003");

    const answers = [];
    for (const secret of [
      "not-a-secret-at-all",
      expired.secret,
      cancelled.secret,
      renewed.secret,
      forSomeoneElse.secret,
    ]) {
      const res = await get(ctx, carol.cookie, `/api/invitations/${secret}`);
      answers.push([res.status, await res.json()]);
    }

    expect(answers).toEqual(
      Array(5).fill([404, { error: "invalid_invitation" }]),
    );
  });

  it("given a link and an invitee who can read the repo, when she accepts and comes back from GitHub, then she is a member with the invited role, the link is erased and spent, and her token only read the repo", async () => {
    const ctx = await withSharing({ users: { user3000: 3000 } });
    const carol = await userWithToken(ctx.app, ctx.db, 3000);
    const { secret } = await invited(ctx, "user3000", "can_validate");

    const back = await acceptAndReturn(ctx, carol.cookie, secret);

    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(`/projets/${ctx.projectId}`);
    expect(await memberRows(ctx)).toEqual([
      { user_id: ctx.alice.id, role: "owner" },
      { user_id: carol.id, role: "can_validate" },
    ]);
    expect(await invitationTable(ctx)).toEqual([]);
    expect(
      (await get(ctx, carol.cookie, `/api/invitations/${secret}`)).status,
    ).toBe(404);
    const used = ctx.calls.filter(
      (c) => c.authorization === `Bearer ${INVITEE_TOKEN}`,
    );
    expect(used.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.github.com/repos/user1000/app",
    ]);
    expect(ctx.calls.some((c) => c.url === TOKEN_URL)).toBe(true);
    expect(await entriesOf(ctx.db, "accept_invitation")).toHaveLength(1);
    expect(await historyText(ctx.db)).not.toContain(INVITEE_TOKEN);
  });

  it("given an accepted link, when Carol lists her projects, then the project is there with her role and « partagé par » its owner, and the owner's own project says no sharer", async () => {
    const ctx = await withSharing({ users: { user3000: 3000 } });
    const carol = await userWithToken(ctx.app, ctx.db, 3000);
    const { secret } = await invited(ctx, "user3000", "can_launch");
    await acceptAndReturn(ctx, carol.cookie, secret);

    const shared = (await (
      await get(ctx, carol.cookie, "/api/projects")
    ).json()) as { projects: Record<string, unknown>[] };
    const own = (await (
      await get(ctx, ctx.alice.cookie, "/api/projects")
    ).json()) as { projects: Record<string, unknown>[] };

    expect(shared.projects).toEqual([
      expect.objectContaining({
        id: ctx.projectId,
        fullName: "user1000/app",
        role: "can_launch",
        sharedBy: "user1000",
      }),
    ]);
    expect(own.projects[0]).toMatchObject({ role: "owner", sharedBy: null });
  });

  it("given an invitee who cannot read the repo on GitHub, when she accepts, then she lands on the link with erreur=sans-acces, nothing is added and the link still works once she is added as a collaborator", async () => {
    const ctx = await withSharing({
      users: { user3000: 3000 },
      access: false,
    });
    const carol = await userWithToken(ctx.app, ctx.db, 3000);
    const { secret } = await invited(ctx, "user3000");

    const back = await acceptAndReturn(ctx, carol.cookie, secret);

    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(
      `/invitations/${secret}?erreur=sans-acces`,
    );
    expect(await memberRows(ctx)).toHaveLength(1);
    expect(await invitationTable(ctx)).toHaveLength(1);
    expect(
      (await get(ctx, carol.cookie, `/api/invitations/${secret}`)).status,
    ).toBe(200);
  });

  it("given a link meant for Carol, when Bob accepts it, then 404 invalid_invitation, nothing is exchanged with GitHub and nothing is added", async () => {
    const ctx = await withSharing({ users: { user3000: 3000 } });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const { secret } = await invited(ctx, "user3000");

    const res = await send(
      ctx.app,
      bob.cookie,
      "POST",
      `/api/invitations/${secret}/accept`,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "invalid_invitation" });
    expect(ctx.calls.filter((c) => c.url === TOKEN_URL)).toEqual([]);
    expect(await memberRows(ctx)).toHaveLength(1);
  });

  it("given a link, when its owner renews it, then the old link is worth nothing, the new one works, and renew_invitation is journaled; cancelling it spends it too", async () => {
    const ctx = await withSharing({ users: { user3000: 3000 } });
    const carol = await userWithToken(ctx.app, ctx.db, 3000);
    const first = await invited(ctx, "user3000");

    const renewed = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/invitations/${first.id}/renew`,
    );

    expect(renewed.status).toBe(200);
    const { url } = (await renewed.json()) as { url: string };
    const fresh = url.split("/invitations/")[1] as string;
    expect(fresh).not.toBe(first.secret);
    expect(
      (await get(ctx, carol.cookie, `/api/invitations/${first.secret}`)).status,
    ).toBe(404);
    expect(
      (await get(ctx, carol.cookie, `/api/invitations/${fresh}`)).status,
    ).toBe(200);
    expect(await entriesOf(ctx.db, "renew_invitation")).toHaveLength(1);

    const cancelled = await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      `/api/invitations/${first.id}`,
    );
    expect(cancelled.status).toBe(200);
    expect(
      (await get(ctx, carol.cookie, `/api/invitations/${fresh}`)).status,
    ).toBe(404);
    expect(await invitationTable(ctx)).toEqual([]);
    expect(await entriesOf(ctx.db, "cancel_invitation")).toHaveLength(1);
  });

  it("given a member who is not the owner, when she renews or cancels an invitation, then 403 role and the invitation stays", async () => {
    const ctx = await withSharing({ users: PAUL });
    const bob = await memberWith(ctx, 2000, "can_launch");
    const { id } = await invited(ctx, "paul");

    const renew = await send(
      ctx.app,
      bob.cookie,
      "POST",
      `/api/invitations/${id}/renew`,
    );
    const cancel = await send(
      ctx.app,
      bob.cookie,
      "DELETE",
      `/api/invitations/${id}`,
    );

    expect([renew.status, cancel.status]).toEqual([403, 403]);
    expect(await invitationTable(ctx)).toHaveLength(1);
  });
});

describe("076 E: logging in on the way to a link", () => {
  it("given a login started with next=/invitations/<secret>, when it starts, then the way back is kept for the callback", async () => {
    const ctx = await withSharing({});

    const res = await ctx.app.request(
      `/api/auth/login?next=${encodeURIComponent("/invitations/abc-123_XYZ")}`,
    );

    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.getSetCookie().join(";"))).toContain(
      "cockpit_login_next=/invitations/abc-123_XYZ",
    );
  });
});

describe("076 F: the members screen's data", () => {
  it("given Bob a member and @paul invited, when the owner reads her members, then she sees her projects, Bob's row with his last login, Paul's pending invitation and no secret", async () => {
    const ctx = await withSharing({ users: PAUL });
    const bob = await memberWith(ctx, 2000, "can_launch");
    await ctx.db.execute(
      sql`update users set last_login_at = ${new Date("2026-11-09T10:00:00Z").toISOString()}::timestamptz where id = ${bob.id}`,
    );
    const { secret } = await invited(ctx, "paul", "read_only");

    const res = await get(ctx, ctx.alice.cookie, "/api/members");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      me: { login: "user1000", projects: 1 },
      projects: [{ id: ctx.projectId, fullName: "user1000/app" }],
      members: [
        {
          userId: bob.id,
          login: "user2000",
          projectId: ctx.projectId,
          projectName: "user1000/app",
          role: "can_launch",
          lastLoginAt: "2026-11-09T10:00:00.000Z",
        },
      ],
      invitations: [
        {
          login: "paul",
          projectId: ctx.projectId,
          projectName: "user1000/app",
          role: "read_only",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("given someone who owns nothing, when she reads the members, then there is nobody and no project to invite on", async () => {
    const ctx = await withSharing({});
    const bob = await memberWith(ctx, 2000, "can_launch");

    const body = (await (
      await get(ctx, bob.cookie, "/api/members")
    ).json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      me: { projects: 0 },
      projects: [],
      members: [],
      invitations: [],
    });
  });

  it("given Bob a member, when the owner changes his role, then it changes and is journaled on the project; the role owner, the owner's own row and a stranger are refused", async () => {
    const ctx = await withSharing({});
    const bob = await memberWith(ctx, 2000, "can_validate");
    const path = `/api/projects/${ctx.projectId}/members`;

    const changed = await send(
      ctx.app,
      ctx.alice.cookie,
      "PATCH",
      `${path}/${bob.id}`,
      {
        role: "can_launch",
      },
    );
    const toOwner = await send(
      ctx.app,
      ctx.alice.cookie,
      "PATCH",
      `${path}/${bob.id}`,
      {
        role: "owner",
      },
    );
    const herself = await send(
      ctx.app,
      ctx.alice.cookie,
      "PATCH",
      `${path}/${ctx.alice.id}`,
      {
        role: "read_only",
      },
    );
    const byBob = await send(
      ctx.app,
      bob.cookie,
      "PATCH",
      `${path}/${bob.id}`,
      {
        role: "can_launch",
      },
    );

    expect(changed.status).toBe(200);
    expect([toOwner.status, herself.status, byBob.status]).toEqual([
      400, 409, 403,
    ]);
    expect(await memberRows(ctx)).toEqual([
      { user_id: ctx.alice.id, role: "owner" },
      { user_id: bob.id, role: "can_launch" },
    ]);
    expect(await entriesOf(ctx.db, "change_member_role")).toHaveLength(1);
  });

  it("given Bob a member with a story in his queue and his night on this project and another in a project of his own, when the owner removes him, then he loses the project and those queue and night items only; removing the owner is refused", async () => {
    const ctx = await withSharing({});
    const bob = await memberWith(ctx, 2000, "can_launch");
    const ticket = await seedTicket(ctx.db, ctx.projectId, "Partagé");
    const shared = await seedStory(ctx.db, ticket, { status: "ready" });
    const ownProject = await seedProject(ctx.db, bob.id, {
      githubRepoId: 7,
      fullName: "user2000/own",
    });
    const ownStory = await seedStory(
      ctx.db,
      await seedTicket(ctx.db, ownProject, "À moi"),
      { status: "ready" },
    );
    await ctx.db.insert(queueItems).values([
      { userId: bob.id, storyId: shared, position: 1 },
      { userId: bob.id, storyId: ownStory, position: 2 },
    ]);
    const [night] = await ctx.db
      .insert(nights)
      .values({
        userId: bob.id,
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
        status: "planned",
      })
      .returning({ id: nights.id });
    await ctx.db.insert(nightItems).values([
      { nightId: night?.id as number, storyId: shared, position: 1 },
      { nightId: night?.id as number, storyId: ownStory, position: 2 },
    ]);
    const path = `/api/projects/${ctx.projectId}/members`;

    const refused = await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      `${path}/${ctx.alice.id}`,
    );
    const removed = await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      `${path}/${bob.id}`,
    );

    expect(refused.status).toBe(409);
    expect(removed.status).toBe(200);
    expect(await memberRows(ctx)).toEqual([
      { user_id: ctx.alice.id, role: "owner" },
    ]);
    expect(
      (await ctx.db.select().from(queueItems)).map((q) => q.storyId),
    ).toEqual([ownStory]);
    expect(
      (await ctx.db.select().from(nightItems)).map((n) => n.storyId),
    ).toEqual([ownStory]);
    expect(
      (await get(ctx, bob.cookie, `/api/projects/${ctx.projectId}/tickets`))
        .status,
    ).toBe(404);
    expect(
      await ctx.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.userId, bob.id)),
    ).toHaveLength(1);
    expect(await entriesOf(ctx.db, "remove_member")).toHaveLength(1);
  });
});

describe("076 G: the role travels with what the server renders", () => {
  it("given Bob a can_validate member, when he reads a story, then its project says his role", async () => {
    const ctx = await withSharing({});
    const bob = await memberWith(ctx, 2000, "can_validate");
    const story = await seedStory(
      ctx.db,
      await seedTicket(ctx.db, ctx.projectId, "T"),
    );

    const res = await get(ctx, bob.cookie, `/api/stories/${story}`);

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { project: { role: string } }).project.role,
    ).toBe("can_validate");
  });
});

describe("076 H: the administrator's view of the accounts", () => {
  it("given a user with a project and a last login, when the administrator lists the users, then each line says the last login and the number of projects, and the administrator still reads no project", async () => {
    const ctx = await withSharing({});
    await memberWith(ctx, 2000, "read_only");
    const admin = await createAdminWithSession(ctx.db, 99);
    await ctx.db.execute(
      sql`update users set last_login_at = ${new Date("2026-11-08T08:00:00Z").toISOString()}::timestamptz where id = ${ctx.alice.id}`,
    );

    const res = await get(ctx, admin.cookie, "/api/settings/users");

    expect(res.status).toBe(200);
    const { users } = (await res.json()) as {
      users: { id: number; lastLoginAt: string | null; projects: number }[];
    };
    const byId = new Map(users.map((u) => [u.id, u]));
    expect(byId.get(ctx.alice.id)).toMatchObject({
      lastLoginAt: "2026-11-08T08:00:00.000Z",
      projects: 1,
    });
    expect(byId.get(admin.id)).toMatchObject({
      lastLoginAt: null,
      projects: 0,
    });
    expect(
      (
        (await (await get(ctx, admin.cookie, "/api/projects")).json()) as {
          projects: unknown[];
        }
      ).projects,
    ).toEqual([]);
  });
});
