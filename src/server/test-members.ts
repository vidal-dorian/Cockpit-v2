import assert from "node:assert/strict";
import { vi } from "vitest";
import { projectMembers } from "./db/schema.ts";
import { send } from "./test-decisions.ts";
import {
  type App,
  rows,
  type TestDb,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Shared by the acceptance tests of slice 13.1 (decision 076). Pinned where the decision leaves room:
//
// Roles (project_members.role): owner > can_launch > can_validate > read_only. A refusal for the role is 403 { error: "role" },
// journaled `refused` with detail { reason: "role" } (MCP: the tool answers "Refused: role", same entry).
//
// POST   /api/projects/:id/invitations  { login, role: read_only|can_validate|can_launch }  (owner only)
//          -> 201 { invitation: { id, expiresAt }, url: "<publicUrl>/invitations/<secret>" }; the secret is 7 days valid, kept hashed in
//          the table `project_invitations` (columns project_id, github_id, role, expires_at, created_at); GitHub read: GET /users/{login}.
//          400 { error: "Bad request" } (role "owner" included) | 403 role | 404 { error: "unknown_login" } (GitHub does not know it)
//          | 409 { error: "already_member" | "already_invited" | "self" }; history `create_invitation` on the project, no login in args.
// POST   /api/invitations/:id/renew     (owner) -> 200 { url }; the old link is worth nothing; history `renew_invitation`.
// DELETE /api/invitations/:id           (owner) -> 200 { ok: true }; history `cancel_invitation`.
// GET    /api/invitations/:secret       (session; 401 without) -> 200 { invitation: { owner: "<login>", fullName, role } }
//          or 404 { error: "invalid_invitation" } for unknown, expired, used, cancelled, renewed-away and other-account links alike.
// POST   /api/invitations/:secret/accept (session) -> 200 { authorizeUrl } (GitHub OAuth, redirect_uri <publicUrl>/api/auth/callback, a state)
//          + an HttpOnly state cookie; 404 { error: "invalid_invitation" } as above. The return is GET /api/auth/callback?code&state,
//          always a 302: success -> /projets/<id> (member added, invitation erased, history `accept_invitation`); failures go to
//          /invitations/<secret>?erreur=<code> with `sans-acces` (the invitee cannot read the repo: nothing is added, the link stays valid)
//          or `lien-invalide`. The code is exchanged at GitHub's token URL, the token reads GET /repos/{owner}/{repo} once and is never used otherwise.
// GET    /api/members (session) -> 200 { me: { login, name, projects }, projects: [{ id, fullName }] (owned, active),
//          members: [{ userId, login, name, projectId, projectName, role, lastLoginAt }] (other people on the owner's projects),
//          invitations: [{ id, login, projectId, projectName, role, createdAt }] }
// PATCH  /api/projects/:id/members/:userId { role: read_only|can_validate|can_launch } (owner) -> 200; the owner's own row: 409 { error: "owner" };
//          history `change_member_role`. DELETE /api/projects/:id/members/:userId (owner) -> 200 { ok: true }; history `remove_member`.
// GET /api/projects: each project also says `role` and `sharedBy` (the owner's login, null on one's own projects); GET /api/stories/:id says `project.role`.
// GET /api/settings/users: each user also says `lastLoginAt` (ISO or null, the column users.last_login_at) and `projects` (a count).

export type Role = "owner" | "can_launch" | "can_validate" | "read_only";
export const ROLES: Role[] = [
  "read_only",
  "can_validate",
  "can_launch",
  "owner",
];

export const TOKEN_URL = "https://github.com/login/oauth/access_token";
export const INVITEE_TOKEN = "gho_invitee_token";
export const PUBLIC_URL = "https://cockpit.example.com";

/** Adds the GitHub of sharing on top of the stub already in place: the account lookup, the token exchange and the repo read as the invitee. */
export function stubSharing(
  options: {
    /** login -> GitHub id of the accounts GitHub knows. */
    users?: Record<string, number>;
    /** The invitee can read the repo. */
    access?: boolean;
  } = {},
) {
  const inner = globalThis.fetch;
  const calls: { method: string; url: string; authorization: string }[] = [];
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
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const call = {
        method: (init?.method ?? "GET").toUpperCase(),
        url: url.origin + url.pathname,
        authorization: headers.get("authorization") ?? "",
      };
      const account = /^\/users\/([^/]+)$/.exec(url.pathname);
      if (url.origin === "https://api.github.com" && account) {
        calls.push(call);
        const id = options.users?.[account[1] as string];
        return id === undefined
          ? Response.json({ message: "Not Found" }, { status: 404 })
          : Response.json({ id, login: account[1] });
      }
      if (call.url === TOKEN_URL) {
        calls.push(call);
        return Response.json({ access_token: INVITEE_TOKEN });
      }
      if (call.authorization === `Bearer ${INVITEE_TOKEN}`) {
        calls.push(call);
        return options.access === false
          ? Response.json({ message: "Not Found" }, { status: 404 })
          : Response.json({ id: 1, full_name: "user1000/app" });
      }
      return inner(input, init);
    }),
  );
  return calls;
}

/** Alice (1000) owns `user1000/app`; sharing stubs on top. */
export async function withSharing(options: Parameters<typeof stubSharing>[0]) {
  const ctx = await withProject();
  const calls = stubSharing(options);
  return { ...ctx, calls };
}
export type Sharing = Awaited<ReturnType<typeof withSharing>>;

/** A user (login user<githubId>) with a session and a token, member of the project with this role. */
export async function memberWith(
  ctx: { app: App; db: TestDb; projectId: number },
  githubId: number,
  role: Role,
) {
  const user = await userWithToken(ctx.app, ctx.db, githubId);
  await ctx.db
    .insert(projectMembers)
    .values({ projectId: ctx.projectId, userId: user.id, role });
  return user;
}

export const invite = (
  ctx: { app: App },
  cookie: string,
  projectId: number,
  body: unknown,
) =>
  send(ctx.app, cookie, "POST", `/api/projects/${projectId}/invitations`, body);

/** Creates an invitation that must succeed; returns its id and secret. */
export async function invited(
  ctx: Sharing,
  login: string,
  role: Role = "can_validate",
) {
  const res = await invite(ctx, ctx.alice.cookie, ctx.projectId, {
    login,
    role,
  });
  assert.equal(res.status, 201, "creating the invitation must work");
  const { invitation, url } = (await res.json()) as {
    invitation: { id: number };
    url: string;
  };
  return { id: invitation.id, secret: url.split("/invitations/")[1] as string };
}

/** What the browser keeps from a response's cookies. */
export const keptCookies = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((pair) => !pair.endsWith("="))
    .join("; ");

/** Clicks « Accepter », then comes back from GitHub with a code; returns the callback's answer. */
export async function acceptAndReturn(
  ctx: { app: App },
  cookie: string,
  secret: string,
) {
  const res = await send(
    ctx.app,
    cookie,
    "POST",
    `/api/invitations/${secret}/accept`,
  );
  assert.equal(res.status, 200, "accepting starts the GitHub authorization");
  const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
  const state = new URL(authorizeUrl).searchParams.get("state");
  assert(state, "the authorize URL carries a state");
  return ctx.app.request(`/api/auth/callback?code=gh-code&state=${state}`, {
    headers: { cookie: `${cookie}; ${keptCookies(res)}` },
  });
}

/** The entries of the history for one action. */
export const entriesOf = (db: TestDb, action: string) =>
  rows(db).then((all) => all.filter((r) => r.action === action));
