import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser, exchangeCode, sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  nightItems,
  nights,
  projectInvitations,
  projectMembers,
  projects,
  queueItems,
  tickets,
  userStories,
  users,
} from "./db/schema.ts";
import type { InstanceSettings, ReadInstance } from "./instance.ts";
import { isDatabaseId, memberProject, NOT_CONFIGURED } from "./projects.ts";

// The return of the authorization is the login's callback (decision 076 C, as the creation from a template, 068 D).
const CALLBACK = "/api/auth/callback";
const STATE_COOKIE = "cockpit_invitation_state";
const INVITATION_MS = 7 * 24 * 60 * 60_000;
const GITHUB_TIMEOUT_MS = 10_000;
const unauthorized = { error: "Unauthorized" };
const invalid = { error: "invalid_invitation" };

const invitableRole = z.enum(["read_only", "can_validate", "can_launch"]);
const inviteBody = z.object({
  login: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  role: invitableRole,
});
const roleBody = z.object({ role: invitableRole });

const newSecret = () => randomBytes(24).toString("base64url");

/** The invitation a link opens for this user: not expired and meant for their GitHub account; the same nothing for any other case (decision 076 E). */
async function openInvitation(db: Db, secret: string, githubId: number) {
  const [found] = await db
    .select({
      invitation: projectInvitations,
      project: projects,
    })
    .from(projectInvitations)
    .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
    .where(
      and(
        eq(projectInvitations.secretHash, sha256(secret)),
        gt(projectInvitations.expiresAt, new Date()),
        isNull(projects.archivedAt),
        eq(projectInvitations.githubId, githubId),
      ),
    );
  return found;
}

/** The numeric id of a GitHub account, null when GitHub does not know the login (decision 076 D); a public read, so no token is needed. */
export async function findAccountId(login: string) {
  const res = await fetch(`https://api.github.com/users/${login}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "cockpit" },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`account_http_${res.status}`);
  return z.object({ id: z.number().int() }).parse(await res.json()).id;
}

/** Whether the invitee can read the repo on GitHub: their token is used for this one read and forgotten. */
async function canReadRepo(token: string, fullName: string) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "cockpit",
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 403) return false;
  if (!res.ok) throw new Error(`repo_http_${res.status}`);
  return true;
}

/** Their queue and night lose this project's stories only; a run already launched goes on (decision 076 F). */
async function clearLaunches(tx: Tx, projectId: number, userId: number) {
  const stories = tx
    .select({ id: userStories.id })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .where(eq(tickets.projectId, projectId));
  await tx
    .delete(queueItems)
    .where(
      and(eq(queueItems.userId, userId), inArray(queueItems.storyId, stories)),
    );
  await tx
    .delete(nightItems)
    .where(
      and(
        inArray(
          nightItems.nightId,
          tx
            .select({ id: nights.id })
            .from(nights)
            .where(eq(nights.userId, userId)),
        ),
        inArray(nightItems.storyId, stories),
      ),
    );
}

export function memberRoutes(db: Db, readInstance: ReadInstance) {
  const linkOf = async (secret: string) =>
    `${(await readInstance())?.publicUrl}/invitations/${secret}`;

  /** An invitation of a project the user owns, found by its id; a stranger's looks like none. */
  const ownInvitation = async (userId: number, id: number) => {
    const [found] = isDatabaseId(id)
      ? await db
          .select()
          .from(projectInvitations)
          .where(eq(projectInvitations.id, id))
      : [];
    const project =
      found && (await memberProject(db, userId, found.projectId, "owner"));
    return project && found;
  };

  /** Gives the invitation a new secret and a new week: the old link is worth nothing. */
  const renew = async (c: Context) => {
    const user = await currentUser(db, c);
    if (!user) return c.json(unauthorized, 401);
    const found = await ownInvitation(user.userId, Number(c.req.param("id")));
    if (!found) return c.json({ error: "Not found" }, 404);
    const secret = newSecret();
    await act(
      db,
      {
        userId: user.userId,
        projectId: found.projectId,
        actor: "human",
        origin: "ui",
        action: "renew_invitation",
        args: { invitationId: found.id },
      },
      (tx) =>
        tx
          .update(projectInvitations)
          .set({
            secretHash: sha256(secret),
            expiresAt: new Date(Date.now() + INVITATION_MS),
            createdAt: new Date(),
          })
          .where(eq(projectInvitations.id, found.id)),
    );
    return c.json({ url: await linkOf(secret) });
  };

  /** The answer for a member that cannot be changed or removed: unknown on the project (404) or its owner (409); null otherwise. */
  const memberRefusal = async (
    c: Context,
    projectId: number,
    userId: number,
  ) => {
    const [row] = isDatabaseId(userId)
      ? await db
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, userId),
            ),
          )
      : [];
    if (!row) return c.json({ error: "Not found" }, 404);
    return row.role === "owner" ? c.json({ error: "owner" }, 409) : null;
  };

  return new Hono()
    .post("/api/projects/:id/invitations", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
        "owner",
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      if (project.archivedAt) return c.json({ error: "project_archived" }, 409);
      const parsed = inviteBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const { login, role } = parsed.data;
      let githubId: number | null;
      try {
        githubId = await findAccountId(login);
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
      if (githubId === null) return c.json({ error: "unknown_login" }, 404);
      if (githubId === user.githubId) return c.json({ error: "self" }, 409);
      const [member] = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(projectMembers, eq(projectMembers.userId, users.id))
        .where(
          and(
            eq(users.githubId, githubId),
            eq(projectMembers.projectId, project.id),
          ),
        );
      if (member) return c.json({ error: "already_member" }, 409);
      const [pending] = await db
        .select({ id: projectInvitations.id })
        .from(projectInvitations)
        .where(
          and(
            eq(projectInvitations.projectId, project.id),
            eq(projectInvitations.githubId, githubId),
          ),
        );
      if (pending) return c.json({ error: "already_invited" }, 409);
      const secret = newSecret();
      // The login stays out of `args` (decision 076 I).
      const created = await act(
        db,
        {
          userId: user.userId,
          projectId: project.id,
          actor: "human",
          origin: "ui",
          action: "create_invitation",
          args: { role },
        },
        async (tx) => {
          const [row] = await tx
            .insert(projectInvitations)
            .values({
              projectId: project.id,
              githubId,
              login,
              role,
              secretHash: sha256(secret),
              expiresAt: new Date(Date.now() + INVITATION_MS),
            })
            .returning({
              id: projectInvitations.id,
              expiresAt: projectInvitations.expiresAt,
            });
          return row as NonNullable<typeof row>;
        },
      );
      return c.json({ invitation: created, url: await linkOf(secret) }, 201);
    })
    .post("/api/invitations/:id/renew", renew)
    .delete("/api/invitations/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await ownInvitation(user.userId, Number(c.req.param("id")));
      if (!found) return c.json({ error: "Not found" }, 404);
      await act(
        db,
        {
          userId: user.userId,
          projectId: found.projectId,
          actor: "human",
          origin: "ui",
          action: "cancel_invitation",
          args: { invitationId: found.id },
        },
        (tx) =>
          tx
            .delete(projectInvitations)
            .where(eq(projectInvitations.id, found.id)),
      );
      return c.json({ ok: true });
    })
    .get("/api/invitations/:secret", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const found = await openInvitation(
        db,
        c.req.param("secret"),
        user.githubId,
      );
      if (!found) return c.json(invalid, 404);
      const [owner] = await db
        .select({ login: users.login })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(
          and(
            eq(projectMembers.projectId, found.project.id),
            eq(projectMembers.role, "owner"),
          ),
        );
      return c.json({
        invitation: {
          owner: owner?.login,
          fullName: found.project.fullName,
          role: found.invitation.role,
        },
      });
    })
    .post("/api/invitations/:secret/accept", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const secret = c.req.param("secret");
      if (!(await openInvitation(db, secret, user.githubId)))
        return c.json(invalid, 404);
      const config = await readInstance();
      if (!config) return c.json({ error: NOT_CONFIGURED }, 503);
      const state = randomBytes(32).toString("hex");
      // The link travels with the state, so the return knows which invitation it answers (only the hash is stored).
      setCookie(c, STATE_COOKIE, `${state}.${secret}`, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.publicUrl.startsWith("https:"),
        path: CALLBACK,
        maxAge: 10 * 60,
      });
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.search = new URLSearchParams({
        client_id: config.githubClientId,
        redirect_uri: `${config.publicUrl}${CALLBACK}`,
        state,
      }).toString();
      return c.json({ authorizeUrl: authorize.href });
    })
    .get("/api/members", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const owned = await db
        .select({ id: projects.id, fullName: projects.fullName })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(
          and(
            eq(projectMembers.userId, user.userId),
            eq(projectMembers.role, "owner"),
            sql`${projects.archivedAt} is null`,
          ),
        )
        .orderBy(asc(projects.id));
      const ids = owned.map((p) => p.id);
      const names = new Map(owned.map((p) => [p.id, p.fullName]));
      const members = ids.length
        ? await db
            .select({
              userId: users.id,
              login: users.login,
              name: users.name,
              projectId: projectMembers.projectId,
              role: projectMembers.role,
              lastLoginAt: users.lastLoginAt,
            })
            .from(projectMembers)
            .innerJoin(users, eq(users.id, projectMembers.userId))
            .where(
              and(
                inArray(projectMembers.projectId, ids),
                ne(projectMembers.userId, user.userId),
              ),
            )
            .orderBy(asc(projectMembers.projectId), asc(users.login))
        : [];
      const invitations = ids.length
        ? await db
            .select({
              id: projectInvitations.id,
              login: projectInvitations.login,
              projectId: projectInvitations.projectId,
              role: projectInvitations.role,
              createdAt: projectInvitations.createdAt,
            })
            .from(projectInvitations)
            .where(inArray(projectInvitations.projectId, ids))
            .orderBy(asc(projectInvitations.id))
        : [];
      return c.json({
        me: { login: user.login, name: user.name, projects: owned.length },
        projects: owned,
        members: members.map((m) => ({
          ...m,
          projectName: names.get(m.projectId),
        })),
        invitations: invitations.map((i) => ({
          ...i,
          projectName: names.get(i.projectId),
        })),
      });
    })
    .patch("/api/projects/:id/members/:userId", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
        "owner",
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const parsed = roleBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const target = Number(c.req.param("userId"));
      const refused = await memberRefusal(c, project.id, target);
      if (refused) return refused;
      await act(
        db,
        {
          userId: user.userId,
          projectId: project.id,
          actor: "human",
          origin: "ui",
          action: "change_member_role",
          args: { memberId: target, role: parsed.data.role },
        },
        async (tx) => {
          await tx
            .update(projectMembers)
            .set({ role: parsed.data.role })
            .where(
              and(
                eq(projectMembers.projectId, project.id),
                eq(projectMembers.userId, target),
              ),
            );
          if (parsed.data.role !== "can_launch")
            await clearLaunches(tx, project.id, target);
        },
      );
      return c.json({ ok: true });
    })
    .delete("/api/projects/:id/members/:userId", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json(unauthorized, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
        "owner",
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      const target = Number(c.req.param("userId"));
      const refused = await memberRefusal(c, project.id, target);
      if (refused) return refused;
      await act(
        db,
        {
          userId: user.userId,
          projectId: project.id,
          actor: "human",
          origin: "ui",
          action: "remove_member",
          args: { memberId: target },
        },
        async (tx) => {
          await clearLaunches(tx, project.id, target);
          await tx
            .delete(projectMembers)
            .where(
              and(
                eq(projectMembers.projectId, project.id),
                eq(projectMembers.userId, target),
              ),
            );
        },
      );
      return c.json({ ok: true });
    });
}

/** The return of an invitation's authorization, handed over by the login's callback: null when the request is not one (no cookie, or another state), so the next one runs. The token reads the repo once and is forgotten. */
export function invitationReturn(db: Db) {
  return async (c: Context, config: InstanceSettings) => {
    const [expected, secret] = (getCookie(c, STATE_COOKIE) ?? "").split(".");
    const { code, state, error } = c.req.query();
    if (!expected || !secret || state !== expected) return null;
    // The state is single-use: whatever happens next, it is gone.
    deleteCookie(c, STATE_COOKIE, { path: CALLBACK });
    const user = await currentUser(db, c);
    if (!user) return c.redirect("/");
    const back = (reason: string) =>
      c.redirect(`/invitations/${secret}?erreur=${reason}`);
    const found = await openInvitation(db, secret, user.githubId);
    if (!found) return back("lien-invalide");
    if (error || !code) return back("annulee");
    let readable: boolean;
    try {
      const token = await exchangeCode(config, code, CALLBACK);
      readable = await canReadRepo(token, found.project.fullName);
    } catch (failure) {
      console.error("Invitation check failed:", failure);
      return back("github-injoignable");
    }
    if (!readable) return back("sans-acces");
    const entry: Entry = {
      userId: user.userId,
      projectId: found.project.id,
      actor: "human",
      origin: "ui",
      action: "accept_invitation",
      args: { role: found.invitation.role },
    };
    try {
      await act(db, entry, async (tx) => {
        // Deleting decides: a second return finds nothing.
        const spent = await tx
          .delete(projectInvitations)
          .where(eq(projectInvitations.id, found.invitation.id))
          .returning({ id: projectInvitations.id });
        if (spent.length === 0) throw new Refused("invalid_invitation");
        await tx
          .insert(projectMembers)
          .values({
            projectId: found.project.id,
            userId: user.userId,
            role: found.invitation.role,
          })
          .onConflictDoNothing();
      });
    } catch (failure) {
      if (failure instanceof Refused) return back("lien-invalide");
      throw failure;
    }
    return c.redirect(`/projets/${found.project.id}`);
  };
}
