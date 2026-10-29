import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { mcpTokens, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { failOnUnexpectedFetch, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  type InstanceOverrides,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";
import {
  callTool,
  dataOf,
  historyText,
  listedTools,
  mcpRows,
  rows,
  rpc,
  seedProject,
  shape,
} from "./test-mcp.ts";

// Slice « Connecter Claude » (decisions 021 and 006): Cockpit as a claude.ai connector. The client is simulated as
// the decision describes it: a CIMD document served by a fake, PKCE, the token endpoint, then a /mcp call.
//
// Pinned choices where decision 021 leaves room (the developer follows them):
// - AppOptions gets two optional fields:
//   `fetchClientMetadata?: (url: string, init?: RequestInit) => Promise<Response>`: how Cockpit reads a CIMD
//   document (default: the global fetch). Cockpit passes `{ signal }` (5 s timeout) and itself enforces the 64 KiB
//   limit, the JSON parsing and the cache.
//   `now?: () => number`: the clock in milliseconds (default Date.now), for the 60 s code and the 10 min CIMD cache.
//   Expiry of access and refresh tokens is tested by writing expires_at / refresh_expires_at in the database.
// - GET /oauth/authorize: a refused request answers a 400 HTML page in French (it says « Demande d'autorisation
//   invalide »), never a redirect. Otherwise 302 to `/autoriser?<the same query>`, or without session to
//   `/api/auth/login?next=<that /autoriser URL, encoded>`. The request is checked before the session.
// - GET /api/oauth/request?<the authorize query> (session required): 200 { clientName, returnHost } or 400
//   { error: "invalid_request" }. It feeds the /autoriser page. clientName is « Claude Code » for the client
//   https://claude.ai/oauth/claude-code-client-metadata and « claude.ai » for any other client.
// - POST /api/oauth/approve, JSON body: the authorize query as fields (response_type, client_id, redirect_uri,
//   code_challenge, code_challenge_method, state, resource) plus `decision: "approve" | "deny"`.
//   200 { redirectUrl }; 400 { error: "invalid_request" } for a request the checks refuse; 401 without session;
//   403 { error: "account_blocked" } for a blocked account.
// - Tokens: the access token is `ckp_…` like a manual one; token_hash and refresh_hash are the SHA-256 hex.
// - GET /api/me/tokens (and the creation answer) gain `kind: "oauth" | "manual"`.
// - GET /api/me/connect (session required): { mcpUrl, connected, connectedAt }, which the Réglages page reads.

const PUBLIC_URL = "https://cockpit.example.com";
const MCP_URL = `${PUBLIC_URL}/mcp`;
const CLIENT_ID = "https://claude.ai/oauth/mcp-client-metadata.json";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
const CODE_REDIRECT_URI = "http://localhost:54321/callback";
const STATE = "st@te &=?/ç";
const AUTH_REQUIRED = `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`;
const DAY = 24 * 3_600_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- the fake client: a CIMD document, PKCE ---

/** The document of a client, as claude.ai serves it; `over` changes what a test is about. */
const cimdDocument = (
  clientId = CLIENT_ID,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  client_id: clientId,
  client_name: "Claude",
  redirect_uris: [
    clientId === CODE_CLIENT_ID ? CODE_REDIRECT_URI : REDIRECT_URI,
  ],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  ...over,
});

type Docs = Record<string, () => Response | Promise<Response>>;
const validDocs = (): Docs => ({
  [CLIENT_ID]: () => Response.json(cimdDocument()),
  [CODE_CLIENT_ID]: () => Response.json(cimdDocument(CODE_CLIENT_ID)),
});

/** The injected `fetchClientMetadata`: serves `docs`, 404 for the rest. */
function cimdFetch(docs: Docs) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return docs[url]?.() ?? new Response("not found", { status: 404 });
  });
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

type Params = Record<string, string | undefined>;

/** The authorize request of a claude.ai client, with its PKCE pair. */
function request(over: Params = {}) {
  const { verifier, challenge } = pkce();
  const params: Params = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: STATE,
    resource: MCP_URL,
    ...over,
  };
  return { verifier, params };
}

const query = (params: Params) =>
  new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ).toString();

// --- the app ---

async function setup(
  options: {
    docs?: Docs;
    instance?: InstanceOverrides;
    fetchClientMetadata?: ReturnType<typeof cimdFetch>;
  } = {},
) {
  // The GitHub stub is always on: nothing here may reach GitHub, and the CIMD fetch must use the injected function.
  stubGitHub({ account: null });
  const fetchClientMetadata =
    options.fetchClientMetadata ?? cimdFetch(options.docs ?? validDocs());
  const clock = { now: Date.now() };
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, options.instance);
  const app = createApp(db, "1.2.3", {
    ...testAppOptions,
    fetchClientMetadata,
    now: () => clock.now,
  });
  return { db, app, fetchClientMetadata, clock };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
type TestDb = Ctx["db"];

/** A user with a live session. */
async function userWithSession(
  db: TestDb,
  githubId: number,
  extra: { blockedAt?: Date } = {},
) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `user${githubId}`, ...extra })
    .returning({ id: users.id });
  assert(user);
  const value = `cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: createHash("sha256").update(value).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { id: user.id, cookie: `cockpit_session=${value}` };
}
type User = Awaited<ReturnType<typeof userWithSession>>;

const authorizeRequest = (ctx: Ctx, params: Params, cookie?: string) =>
  ctx.app.request(`/oauth/authorize?${query(params)}`, {
    headers: cookie ? { cookie } : {},
  });

const approveRequest = (
  ctx: Ctx,
  cookie: string | undefined,
  params: Params,
  decision: "approve" | "deny" = "approve",
) =>
  ctx.app.request("/api/oauth/approve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ ...params, decision }),
  });

/** What the user's click on Autoriser gives the client: the code. */
async function approved(ctx: Ctx, user: User, over: Params = {}) {
  const { verifier, params } = request(over);
  const res = await approveRequest(ctx, user.cookie, params);
  expect(res.status, "approving must work for this test").toBe(200);
  const { redirectUrl } = (await res.json()) as { redirectUrl: string };
  const code = new URL(redirectUrl).searchParams.get("code");
  assert(code, "the redirect carries a code");
  return { code, verifier, params };
}
type Approval = Awaited<ReturnType<typeof approved>>;

const tokenRequest = (ctx: Ctx, form: Record<string, string | undefined>) =>
  ctx.app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: query(form),
  });

/** The exchange of a code, as the client does it. */
const exchange = (ctx: Ctx, a: Approval, over: Record<string, string> = {}) =>
  tokenRequest(ctx, {
    grant_type: "authorization_code",
    code: a.code,
    redirect_uri: a.params.redirect_uri,
    client_id: a.params.client_id,
    code_verifier: a.verifier,
    ...over,
  });

const refresh = (
  ctx: Ctx,
  refreshToken: string,
  clientId: string = CLIENT_ID,
) =>
  tokenRequest(ctx, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

type Issued = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
};

/** The whole connection: authorize, approve, exchange. */
async function connect(ctx: Ctx, user: User, over: Params = {}) {
  const a = await approved(ctx, user, over);
  const res = await exchange(ctx, a);
  expect(res.status, "the exchange must work for this test").toBe(200);
  return (await res.json()) as Issued;
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type TokenRow = {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  last_four: string;
  client_id: string | null;
  refresh_hash: string | null;
  expires_ms: number | null;
  refresh_expires_ms: number | null;
  revoked: boolean;
};

/** mcp_tokens in raw SQL, so no test depends on the Drizzle export of the new columns. */
async function tokenRows(db: TestDb) {
  const result = await db.execute(
    sql`select id, user_id, name, token_hash, last_four, client_id, refresh_hash,
      (extract(epoch from expires_at) * 1000)::float8 as expires_ms,
      (extract(epoch from refresh_expires_at) * 1000)::float8 as refresh_expires_ms,
      revoked_at is not null as revoked
      from mcp_tokens order by id`,
  );
  return (result as unknown as { rows: TokenRow[] }).rows;
}

/** `n` active manual tokens (and `revoked` revoked ones) for a user, without going through the creation route. */
async function seedManualTokens(
  db: TestDb,
  userId: number,
  active: number,
  revoked = 0,
) {
  const make = (i: number, revokedAt?: Date) => ({
    userId,
    name: `manual ${i}`,
    tokenHash: `hash-${userId}-${i}-${revokedAt ? "r" : "a"}`,
    lastFour: "abcd",
    revokedAt,
  });
  await db
    .insert(mcpTokens)
    .values([
      ...Array.from({ length: active }, (_, i) => make(i)),
      ...Array.from({ length: revoked }, (_, i) => make(i, new Date())),
    ]);
}

const revokeRoute = (ctx: Ctx, cookie: string, id: number) =>
  ctx.app.request(`/api/me/tokens/${id}/revoke`, {
    method: "POST",
    headers: { cookie },
  });

const json = async (res: Response) => (await res.json()) as unknown;

/** A 400 of the token endpoint: RFC 6749 JSON. */
async function expectTokenError(res: Response, error: string) {
  expect(res.status).toBe(400);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  expect(await json(res)).toMatchObject({ error });
}

// ---------------------------------------------------------------------------
// Criterion 1: the metadata
// ---------------------------------------------------------------------------

describe("criterion 1: discovery metadata", () => {
  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])(
    "given the public URL, when %s is requested, then resource is <publicUrl>/mcp and authorization_servers is [<publicUrl>]",
    async (path) => {
      const { app } = await setup();

      const res = await app.request(path);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(await json(res)).toMatchObject({
        resource: MCP_URL,
        authorization_servers: [PUBLIC_URL],
      });
    },
  );

  it("given another public URL, when the metadata is requested, then it follows the instance settings and not a constant", async () => {
    const { app } = await setup({
      instance: { publicUrl: "http://127.0.0.1:3000" },
    });

    const resource = await app.request("/.well-known/oauth-protected-resource");
    const server = await app.request("/.well-known/oauth-authorization-server");

    expect(await json(resource)).toMatchObject({
      resource: "http://127.0.0.1:3000/mcp",
      authorization_servers: ["http://127.0.0.1:3000"],
    });
    expect(await json(server)).toMatchObject({
      issuer: "http://127.0.0.1:3000",
      token_endpoint: "http://127.0.0.1:3000/oauth/token",
    });
  });

  it("given the public URL, when /.well-known/oauth-authorization-server is requested, then it answers exactly the fields of decision 021 A", async () => {
    const { app } = await setup();

    const res = await app.request("/.well-known/oauth-authorization-server");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await json(res)).toEqual({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
      token_endpoint: `${PUBLIC_URL}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
    });
  });

  it.each([
    "/.well-known/openid-configuration",
    "/.well-known/oauth-protected-resource/other",
    "/.well-known/oauth-authorization-server/mcp",
    "/.well-known/nope",
  ])(
    "given the path %s, when it is requested, then it is still a 404 in JSON, not the page",
    async (path) => {
      const { app } = await setup();

      const res = await app.request(path);

      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
    },
  );

  it("given no Authorization header, when POST /mcp is called, then 401 with the WWW-Authenticate that names the protected resource metadata, and no history entry", async () => {
    const { app, db } = await setup();

    const res = await rpc(app, "tools/list", {});

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(AUTH_REQUIRED);
    expect(await rows(db)).toEqual([]);
  });

  it("given a token nobody has, when POST /mcp is called, then the 401 carries the same WWW-Authenticate", async () => {
    const { app } = await setup();

    const res = await rpc(
      app,
      "tools/list",
      {},
      `Bearer ckp_${"x".repeat(43)}`,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(AUTH_REQUIRED);
  });
});

// ---------------------------------------------------------------------------
// Criterion 2: the authorize request
// ---------------------------------------------------------------------------

describe("criterion 2: GET /oauth/authorize, validation", () => {
  it("given a valid claude.ai client and a session, when /oauth/authorize is requested, then it redirects to /autoriser keeping every parameter, after reading the CIMD document once", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const { params } = request();

    const res = await authorizeRequest(ctx, params, alice.cookie);

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "", PUBLIC_URL);
    expect(location.pathname).toBe("/autoriser");
    expect(Object.fromEntries(location.searchParams)).toEqual(params);
    expect(ctx.fetchClientMetadata).toHaveBeenCalledTimes(1);
    expect(ctx.fetchClientMetadata.mock.calls[0]?.[0]).toBe(CLIENT_ID);
  });

  const refused: [string, Params, Docs | undefined][] = [
    [
      "a client_id on another host",
      { client_id: "https://evil.example/c.json" },
      undefined,
    ],
    [
      "a client_id in http",
      { client_id: "http://claude.ai/oauth/c.json" },
      undefined,
    ],
    [
      "a client_id on a host that only starts like claude.ai",
      { client_id: "https://claude.ai.evil.example/c.json" },
      undefined,
    ],
    [
      "a client_id that hides another host behind claude.ai",
      { client_id: "https://claude.ai@evil.example/c.json" },
      undefined,
    ],
    ["no client_id", { client_id: undefined }, undefined],
    ["no redirect_uri", { redirect_uri: undefined }, undefined],
    [
      "a CIMD document that answers 404",
      {},
      { [CLIENT_ID]: () => new Response("", { status: 404 }) },
    ],
    [
      "a CIMD document that answers 500",
      {},
      { [CLIENT_ID]: () => new Response("", { status: 500 }) },
    ],
    [
      "a CIMD document that cannot be reached",
      {},
      {
        [CLIENT_ID]: () => {
          throw new TypeError("fetch failed");
        },
      },
    ],
    [
      "a CIMD document that is not JSON",
      {},
      { [CLIENT_ID]: () => new Response("<html>no</html>") },
    ],
    [
      "a CIMD document that is a JSON array",
      {},
      { [CLIENT_ID]: () => Response.json([cimdDocument()]) },
    ],
    [
      "a CIMD document over 64 KiB",
      {},
      {
        [CLIENT_ID]: () =>
          new Response(
            JSON.stringify(
              cimdDocument(CLIENT_ID, { padding: "x".repeat(70_000) }),
            ),
          ),
      },
    ],
    [
      "a CIMD document without redirect_uris",
      {},
      {
        [CLIENT_ID]: () =>
          Response.json(cimdDocument(CLIENT_ID, { redirect_uris: undefined })),
      },
    ],
    [
      "a redirect_uri that is not in the redirect_uris of the document",
      { redirect_uri: "https://claude.ai/api/mcp/other_callback" },
      undefined,
    ],
    [
      "a redirect_uri on another host",
      { redirect_uri: "https://evil.example/api/mcp/auth_callback" },
      undefined,
    ],
    [
      "a document whose client_id is another address",
      {},
      {
        [CLIENT_ID]: () =>
          Response.json(
            cimdDocument("https://claude.ai/oauth/someone-else.json"),
          ),
      },
    ],
    ["no code_challenge", { code_challenge: undefined }, undefined],
    [
      "a code_challenge_method of plain",
      { code_challenge_method: "plain" },
      undefined,
    ],
    [
      "no code_challenge_method",
      { code_challenge_method: undefined },
      undefined,
    ],
    ["a response_type of token", { response_type: "token" }, undefined],
    ["no response_type", { response_type: undefined }, undefined],
  ];

  it.each(refused)(
    "given %s, when /oauth/authorize is requested, then a 400 page in French and no redirect, not even to the given redirect_uri",
    async (_name, over, docs) => {
      const ctx = await setup({ docs: docs ?? validDocs() });
      const { params } = request(over);

      const res = await authorizeRequest(ctx, params);

      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const page = await res.text();
      expect(page).toMatch(/demande/i);
      expect(page).toMatch(/invalide/i);
      // SSRF: a client_id that is not under https://claude.ai/ is never fetched.
      for (const [url] of ctx.fetchClientMetadata.mock.calls)
        expect(String(url).startsWith("https://claude.ai/")).toBe(true);
    },
  );

  it("given a CIMD document that never answers, when /oauth/authorize is requested, then Cockpit gives up (the fetch is given an abort signal) and answers the 400 page", {
    timeout: 20_000,
  }, async () => {
    const hanging = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const ctx = await setup({
      fetchClientMetadata: hanging as unknown as ReturnType<typeof cimdFetch>,
    });

    const res = await authorizeRequest(ctx, request().params);

    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("given two requests for the same client within 10 minutes, when /oauth/authorize is requested twice, then the CIMD document is fetched once; after 10 minutes it is fetched again", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);

    await authorizeRequest(ctx, request().params, alice.cookie);
    await authorizeRequest(ctx, request().params, alice.cookie);
    expect(ctx.fetchClientMetadata).toHaveBeenCalledTimes(1);

    ctx.clock.now += 9 * 60_000;
    await authorizeRequest(ctx, request().params, alice.cookie);
    expect(ctx.fetchClientMetadata).toHaveBeenCalledTimes(1);

    ctx.clock.now += 2 * 60_000;
    const res = await authorizeRequest(ctx, request().params, alice.cookie);
    expect(res.status).toBe(302);
    expect(ctx.fetchClientMetadata).toHaveBeenCalledTimes(2);
  });

  it("given a valid request without session, when /oauth/authorize is requested, then the request is still checked first: an invalid one is a 400 page, not a login", async () => {
    const ctx = await setup();

    const res = await authorizeRequest(
      ctx,
      request({ code_challenge_method: "plain" }).params,
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterion 3: login first
// ---------------------------------------------------------------------------

const octocat = {
  id: 1,
  login: "octocat",
  name: "The Octocat",
  avatar_url: "x",
};

/** The GitHub login endpoints, as in auth.test.ts; any other call fails loudly. */
function stubGitHubLogin() {
  const unexpected = failOnUnexpectedFetch();
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
      const where = url.origin + url.pathname;
      if (where === "https://github.com/login/oauth/access_token")
        return Response.json({ access_token: "gho_token" });
      if (where === "https://api.github.com/user")
        return Response.json(octocat);
      if (/^\/users\/[^/]+\/installation$/.test(url.pathname))
        return Response.json({ id: 77, account: { id: octocat.id } });
      throw unexpected(`${raw} ${init?.method ?? ""}`);
    }),
  );
}

const pairOf = (setCookie: string) => setCookie.split(";")[0] ?? "";

/** The GitHub login from /api/auth/login?next=… to the callback; returns the callback's response. */
async function loginThroughGitHub(ctx: Ctx, next?: string) {
  stubGitHubLogin();
  const start = await ctx.app.request(
    next === undefined
      ? "/api/auth/login"
      : `/api/auth/login?next=${encodeURIComponent(next)}`,
  );
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  assert(state, "login must send a state");
  const cookie = start.headers
    .getSetCookie()
    .map(pairOf)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
  return ctx.app.request(
    `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie } },
  );
}

describe("criterion 3: the login comes first", () => {
  it("given no session, when /oauth/authorize is requested with a valid request, then it redirects to /api/auth/login with next set to the /autoriser URL that keeps the request", async () => {
    const ctx = await setup();
    const { params } = request();

    const res = await authorizeRequest(ctx, params);

    expect(res.status).toBe(302);
    const login = new URL(res.headers.get("location") ?? "", PUBLIC_URL);
    expect(login.pathname).toBe("/api/auth/login");
    const next = login.searchParams.get("next");
    assert(next, "login carries next");
    const target = new URL(next, PUBLIC_URL);
    expect(target.origin).toBe(PUBLIC_URL);
    expect(target.pathname).toBe("/autoriser");
    expect(Object.fromEntries(target.searchParams)).toEqual(params);
  });

  it("given a login started with next=/autoriser?…, when GitHub sends the user back, then the user lands on that /autoriser URL and has a session", async () => {
    const ctx = await setup();
    const next = `/autoriser?${query(request().params)}`;

    const res = await loginThroughGitHub(ctx, next);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(next);
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith("cockpit_session=")),
    ).toBe(true);
  });

  it("given a login without next, when GitHub sends the user back, then the landing is still /", async () => {
    const ctx = await setup();

    const res = await loginThroughGitHub(ctx);

    expect(res.headers.get("location")).toBe("/");
  });

  it.each([
    "https://evil.example/autoriser",
    "https://cockpit.example.com/autoriser",
    "//evil.example",
    "//evil.example/autoriser",
    "/\\evil.example",
    "/api/me",
    "/api/auth/logout",
    "/reglages",
    "autoriser",
    "javascript:alert(1)",
    "",
  ])(
    "given the next %j, when the login ends, then it is ignored and the user lands on the normal page (no open redirect)",
    async (next) => {
      const ctx = await setup();

      const res = await loginThroughGitHub(ctx, next);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    },
  );
});

// ---------------------------------------------------------------------------
// Criterion 4: approve and deny
// ---------------------------------------------------------------------------

describe("criterion 4: POST /api/oauth/approve", () => {
  it("given a logged-in user and a valid request, when they approve, then the answer is the redirect redirect_uri?code=…&state=… with the state given back as is", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const { params } = request();

    const res = await approveRequest(ctx, alice.cookie, params);

    expect(res.status).toBe(200);
    const { redirectUrl } = (await res.json()) as { redirectUrl: string };
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code")?.length).toBeGreaterThanOrEqual(20);
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("error")).toBeNull();
  });

  it("given two approvals, when they are compared, then the codes differ", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);

    const first = await approved(ctx, alice);
    const second = await approved(ctx, alice);

    expect(first.code).not.toBe(second.code);
  });

  it("given a logged-in user, when they deny, then the answer is redirect_uri?error=access_denied&state=… with no code", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const { params } = request();

    const res = await approveRequest(ctx, alice.cookie, params, "deny");

    expect(res.status).toBe(200);
    const { redirectUrl } = (await res.json()) as { redirectUrl: string };
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("code")).toBeNull();
  });

  it("given no session, when someone approves, then 401, no code, and nothing in the history", async () => {
    const ctx = await setup();

    const res = await approveRequest(ctx, undefined, request().params);

    expect(res.status).toBe(401);
    expect(JSON.stringify(await json(res))).not.toContain("code=");
    expect(await rows(ctx.db)).toEqual([]);
  });

  it("given a blocked account with a session that was not closed yet, when it approves, then 403, no code and no ok oauth_authorize entry", async () => {
    const ctx = await setup();
    const blocked = await userWithSession(ctx.db, 1, { blockedAt: new Date() });

    const res = await approveRequest(ctx, blocked.cookie, request().params);

    expect(res.status).toBe(403);
    expect(JSON.stringify(await json(res))).not.toContain("code=");
    expect(
      await rows(ctx.db, sql`action = 'oauth_authorize' and result = 'ok'`),
    ).toEqual([]);
  });

  it.each([
    [
      "a redirect_uri the document does not list",
      { redirect_uri: "https://claude.ai/api/mcp/other" },
    ],
    [
      "a client_id on another host",
      { client_id: "https://evil.example/c.json" },
    ],
    ["a code_challenge_method of plain", { code_challenge_method: "plain" }],
    ["no code_challenge", { code_challenge: undefined }],
  ] as [string, Params][])(
    "given %s, when a logged-in user approves, then 400 invalid_request and no redirect URL: the checks run again on the POST",
    async (_name, over) => {
      const ctx = await setup();
      const alice = await userWithSession(ctx.db, 1);

      const res = await approveRequest(ctx, alice.cookie, request(over).params);

      expect(res.status).toBe(400);
      const body = (await json(res)) as Record<string, unknown>;
      expect(body.error).toBe("invalid_request");
      expect(body.redirectUrl).toBeUndefined();
    },
  );

  it("given an approval, when it is done, then one oauth_authorize entry is written: human, ui, ok, for that user, without the code or the challenge", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);

    const found = await rows(ctx.db, sql`action = 'oauth_authorize'`);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: alice.id,
      actor: "human",
      origin: "ui",
      action: "oauth_authorize",
      result: "ok",
    });
    const text = await historyText(ctx.db);
    expect(text).not.toContain(a.code);
    expect(text).not.toContain(a.params.code_challenge);
    expect(text).not.toContain(a.verifier);
  });
});

describe("criterion 4 and 11: GET /api/oauth/request, what the /autoriser page shows", () => {
  const ask = (ctx: Ctx, params: Params, cookie?: string) =>
    ctx.app.request(`/api/oauth/request?${query(params)}`, {
      headers: cookie ? { cookie } : {},
    });

  it("given a claude.ai client, when the page asks, then clientName is claude.ai and returnHost the host of the redirect_uri", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);

    const res = await ask(ctx, request().params, alice.cookie);

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      clientName: "claude.ai",
      returnHost: "claude.ai",
    });
  });

  it("given the Claude Code client, when the page asks, then clientName is Claude Code and returnHost is localhost", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);

    const res = await ask(
      ctx,
      request({ client_id: CODE_CLIENT_ID, redirect_uri: CODE_REDIRECT_URI })
        .params,
      alice.cookie,
    );

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      clientName: "Claude Code",
      returnHost: "localhost",
    });
  });

  it("given an invalid request, when the page asks, then 400 invalid_request", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);

    const res = await ask(
      ctx,
      request({ redirect_uri: "https://evil.example/cb" }).params,
      alice.cookie,
    );

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "invalid_request" });
  });

  it("given no session, when the page asks, then 401", async () => {
    const ctx = await setup();

    const res = await ask(ctx, request().params);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Criterion 5: the token endpoint, authorization_code
// ---------------------------------------------------------------------------

describe("criterion 5: POST /oauth/token, authorization_code", () => {
  it("given a code, the right verifier, redirect_uri and client_id, when it is exchanged, then 200 { access_token ckp_…, token_type Bearer, expires_in 3600, refresh_token }", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);

    const res = await exchange(ctx, a);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await json(res);
    expect(body).toEqual({
      access_token: expect.stringMatching(/^ckp_[A-Za-z0-9_-]{43}$/),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^\S{32,}$/),
    });
    const issued = body as Issued;
    expect(issued.refresh_token).not.toBe(issued.access_token);
  });

  it("given an exchange, when it succeeds, then one mcp_tokens row holds the user, the client_id, the name claude.ai, both hashes, an access expiry about 1 h ahead and a refresh expiry about 90 days ahead", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);

    const found = await tokenRows(ctx.db);

    expect(found).toHaveLength(1);
    const [row] = found;
    assert(row);
    expect(row).toMatchObject({
      user_id: alice.id,
      name: "claude.ai",
      client_id: CLIENT_ID,
      token_hash: sha256(issued.access_token),
      last_four: issued.access_token.slice(-4),
      refresh_hash: sha256(issued.refresh_token),
      revoked: false,
    });
    expect(
      Math.abs((row.expires_ms ?? 0) - (Date.now() + 3_600_000)),
    ).toBeLessThan(60_000);
    expect(
      Math.abs((row.refresh_expires_ms ?? 0) - (Date.now() + 90 * DAY)),
    ).toBeLessThan(60_000);
  });

  it("given the Claude Code client, when its code is exchanged, then the connection is named Claude Code", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);

    await connect(ctx, alice, {
      client_id: CODE_CLIENT_ID,
      redirect_uri: CODE_REDIRECT_URI,
    });

    const [row] = await tokenRows(ctx.db);
    expect(row).toMatchObject({
      name: "Claude Code",
      client_id: CODE_CLIENT_ID,
    });
  });

  it("given a code already exchanged, when it is exchanged again, then invalid_grant and no second row", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);
    expect((await exchange(ctx, a)).status).toBe(200);

    const again = await exchange(ctx, a);

    await expectTokenError(again, "invalid_grant");
    expect(await tokenRows(ctx.db)).toHaveLength(1);
  });

  it("given a code 59 seconds old, when it is exchanged, then it works", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);
    ctx.clock.now += 59_000;

    expect((await exchange(ctx, a)).status).toBe(200);
  });

  it("given a code 61 seconds old, when it is exchanged, then invalid_grant and no row", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);
    ctx.clock.now += 61_000;

    await expectTokenError(await exchange(ctx, a), "invalid_grant");
    expect(await tokenRows(ctx.db)).toEqual([]);
  });

  it("given a code nobody issued, when it is exchanged, then invalid_grant", async () => {
    const ctx = await setup();
    const a = {
      code: "not-a-code",
      verifier: pkce().verifier,
      params: request().params,
    };

    await expectTokenError(await exchange(ctx, a), "invalid_grant");
  });

  it.each([
    ["a wrong code_verifier", { code_verifier: pkce().verifier }],
    [
      "another redirect_uri",
      { redirect_uri: "https://claude.ai/api/mcp/other_callback" },
    ],
    [
      "another client_id",
      { client_id: "https://claude.ai/oauth/another-client.json" },
    ],
  ] as [string, Record<string, string>][])(
    "given %s, when the code is exchanged, then invalid_grant and no row",
    async (_name, over) => {
      const ctx = await setup();
      const alice = await userWithSession(ctx.db, 1);
      const a = await approved(ctx, alice);

      await expectTokenError(await exchange(ctx, a, over), "invalid_grant");
      expect(await tokenRows(ctx.db)).toEqual([]);
    },
  );

  it("given a body in JSON, when it is posted to /oauth/token, then 400 invalid_request: only form-urlencoded is read", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);

    const res = await ctx.app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: a.code,
        redirect_uri: a.params.redirect_uri,
        client_id: a.params.client_id,
        code_verifier: a.verifier,
      }),
    });

    await expectTokenError(res, "invalid_request");
    expect(await tokenRows(ctx.db)).toEqual([]);
  });

  it.each(["code", "redirect_uri", "client_id", "code_verifier", "grant_type"])(
    "given no %s, when the code is exchanged, then 400 invalid_request",
    async (missing) => {
      const ctx = await setup();
      const alice = await userWithSession(ctx.db, 1);
      const a = await approved(ctx, alice);

      const res = await tokenRequest(ctx, {
        grant_type: "authorization_code",
        code: a.code,
        redirect_uri: a.params.redirect_uri,
        client_id: a.params.client_id,
        code_verifier: a.verifier,
        [missing]: undefined,
      });

      await expectTokenError(res, "invalid_request");
      expect(await tokenRows(ctx.db)).toEqual([]);
    },
  );

  it("given an unknown grant_type, when it is posted, then 400 unsupported_grant_type", async () => {
    const ctx = await setup();

    const res = await tokenRequest(ctx, {
      grant_type: "password",
      username: "a",
      password: "b",
    });

    await expectTokenError(res, "unsupported_grant_type");
  });

  it("given an exchange, when it succeeds, then one oauth_token entry is written: claude, mcp, args { tokenId, grant }, token_id, and no secret anywhere in the history", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const a = await approved(ctx, alice);
    const issued = (await json(await exchange(ctx, a))) as Issued;
    const [row] = await tokenRows(ctx.db);
    assert(row);

    const found = (await mcpRows(ctx.db)).filter(
      (r) => r.action === "oauth_token",
    );

    expect(found.map(shape)).toEqual([
      expect.objectContaining({
        token_id: row.id,
        actor: "claude",
        origin: "mcp",
        action: "oauth_token",
        args: { tokenId: row.id, grant: "authorization_code" },
        result: "ok",
      }),
    ]);
    const text = await historyText(ctx.db);
    for (const secret of [
      issued.access_token,
      issued.refresh_token,
      a.code,
      a.verifier,
    ])
      expect(text).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6: the token endpoint, refresh_token
// ---------------------------------------------------------------------------

describe("criterion 6: POST /oauth/token, refresh_token", () => {
  it("given a refresh token, when it is used, then the same row gets a new access token and a new refresh token, and the answer has the same shape", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const first = await connect(ctx, alice);
    const [before] = await tokenRows(ctx.db);
    assert(before);

    const res = await refresh(ctx, first.refresh_token);

    expect(res.status).toBe(200);
    const second = (await json(res)) as Issued;
    expect(second).toEqual({
      access_token: expect.stringMatching(/^ckp_[A-Za-z0-9_-]{43}$/),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: expect.any(String),
    });
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const found = await tokenRows(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: before.id,
      client_id: CLIENT_ID,
      token_hash: sha256(second.access_token),
      refresh_hash: sha256(second.refresh_token),
      revoked: false,
    });
    expect(
      Math.abs((found[0]?.expires_ms ?? 0) - (Date.now() + 3_600_000)),
    ).toBeLessThan(60_000);
  });

  it("given a rotation, when the old tokens are used, then the old refresh token gives invalid_grant and the old access token gets 401, while the new ones work", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const first = await connect(ctx, alice);
    const second = (await json(
      await refresh(ctx, first.refresh_token),
    )) as Issued;

    await expectTokenError(
      await refresh(ctx, first.refresh_token),
      "invalid_grant",
    );
    const oldAccess = await rpc(
      ctx.app,
      "tools/list",
      {},
      `Bearer ${first.access_token}`,
    );
    const newAccess = await rpc(
      ctx.app,
      "tools/list",
      {},
      `Bearer ${second.access_token}`,
    );

    expect(oldAccess.status).toBe(401);
    expect(newAccess.status).toBe(200);
    expect(await tokenRows(ctx.db)).toHaveLength(1);
  });

  it("given a refresh, when it succeeds, then an oauth_token entry with grant refresh_token and the same token_id as the connection is written", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const first = await connect(ctx, alice);
    const [row] = await tokenRows(ctx.db);
    assert(row);

    const second = (await json(
      await refresh(ctx, first.refresh_token),
    )) as Issued;

    const found = (await mcpRows(ctx.db)).filter(
      (r) => r.action === "oauth_token",
    );
    expect(
      found.map((r) => [r.token_id, r.args, r.actor, r.origin, r.result]),
    ).toEqual([
      [
        row.id,
        { tokenId: row.id, grant: "authorization_code" },
        "claude",
        "mcp",
        "ok",
      ],
      [
        row.id,
        { tokenId: row.id, grant: "refresh_token" },
        "claude",
        "mcp",
        "ok",
      ],
    ]);
    const text = await historyText(ctx.db);
    for (const secret of [
      first.refresh_token,
      second.refresh_token,
      second.access_token,
    ])
      expect(text).not.toContain(secret);
  });

  it("given a connection revoked from Réglages, when its refresh token is used, then invalid_grant and no new token", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    const [row] = await tokenRows(ctx.db);
    assert(row);
    expect((await revokeRoute(ctx, alice.cookie, row.id)).status).toBe(204);

    await expectTokenError(
      await refresh(ctx, issued.refresh_token),
      "invalid_grant",
    );

    const [after] = await tokenRows(ctx.db);
    expect(after?.token_hash).toBe(sha256(issued.access_token));
  });

  it("given a blocked user, when the refresh token is used, then invalid_grant", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    await ctx.db.execute(
      sql`update users set blocked_at = now() where id = ${alice.id}`,
    );

    await expectTokenError(
      await refresh(ctx, issued.refresh_token),
      "invalid_grant",
    );
  });

  it("given a refresh token past refresh_expires_at, when it is used, then invalid_grant", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    await ctx.db.execute(
      sql`update mcp_tokens set refresh_expires_at = now() - interval '1 minute'`,
    );

    await expectTokenError(
      await refresh(ctx, issued.refresh_token),
      "invalid_grant",
    );
  });

  it.each([
    ["an unknown refresh token", () => "r".repeat(43)],
    [
      "an access token presented as a refresh token",
      (i: Issued) => i.access_token,
    ],
  ])("given %s, when it is used, then invalid_grant", async (_name, pick) => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);

    await expectTokenError(await refresh(ctx, pick(issued)), "invalid_grant");
  });

  it("given no refresh_token, when a refresh is posted, then 400 invalid_request", async () => {
    const ctx = await setup();

    const res = await tokenRequest(ctx, {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
    });

    await expectTokenError(res, "invalid_request");
  });
});

// ---------------------------------------------------------------------------
// Criterion 7: /mcp with an OAuth token
// ---------------------------------------------------------------------------

describe("criterion 7: /mcp with an OAuth access token", () => {
  it("given a connected user with a project, when Claude calls tools/list and list_projects with the access token, then it works as with a manual token", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await seedProject(ctx.db, alice.id, {
      githubRepoId: 1,
      fullName: "user1/app",
    });
    const issued = await connect(ctx, alice);

    const names = (await listedTools(ctx.app, issued.access_token)).map(
      (t) => t.name,
    );
    const listed = dataOf<{ projects: { full_name: string }[] }>(
      await callTool(ctx.app, issued.access_token, "list_projects", {}),
    );

    expect(names).toContain("list_projects");
    expect(listed.projects.map((p) => p.full_name)).toEqual(["user1/app"]);
  });

  it("given a call with the access token, when it is accepted, then last_used_at is filled and the entry of the tool carries the token id", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    const [row] = await tokenRows(ctx.db);
    assert(row);

    await callTool(ctx.app, issued.access_token, "list_projects", {});

    const entries = (await mcpRows(ctx.db)).filter(
      (r) => r.action === "list_projects",
    );
    expect(entries.map((r) => [r.user_id, r.token_id])).toEqual([
      [alice.id, row.id],
    ]);
  });

  it("given an access token past expires_at, when Claude calls /mcp, then 401 with the WWW-Authenticate header and one refused mcp_auth entry", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    await ctx.db.execute(
      sql`update mcp_tokens set expires_at = now() - interval '1 minute'`,
    );

    const res = await rpc(
      ctx.app,
      "tools/list",
      {},
      `Bearer ${issued.access_token}`,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(AUTH_REQUIRED);
    const refused = await rows(ctx.db, sql`action = 'mcp_auth'`);
    expect(refused.map((r) => r.result)).toEqual(["refused"]);
    expect(await historyText(ctx.db)).not.toContain(issued.access_token);
  });

  it("given an expired access token, when the refresh token is used, then a new access token works again", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    await ctx.db.execute(
      sql`update mcp_tokens set expires_at = now() - interval '1 minute'`,
    );

    const renewed = (await json(
      await refresh(ctx, issued.refresh_token),
    )) as Issued;

    const res = await rpc(
      ctx.app,
      "tools/list",
      {},
      `Bearer ${renewed.access_token}`,
    );
    expect(res.status).toBe(200);
  });

  it("given a manual token next to a connection, when Claude calls /mcp with it, then it still works: it has no expiry", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const res = await ctx.app.request("/api/me/tokens", {
      method: "POST",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Mon Claude" }),
    });
    const { secret } = (await res.json()) as { secret: string };
    await connect(ctx, alice);

    const call = await rpc(ctx.app, "tools/list", {}, `Bearer ${secret}`);

    expect(call.status).toBe(200);
  });

  it("given a connection revoked from Réglages, when Claude calls /mcp with its access token, then 401", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    const [row] = await tokenRows(ctx.db);
    assert(row);
    expect((await revokeRoute(ctx, alice.cookie, row.id)).status).toBe(204);

    const res = await rpc(
      ctx.app,
      "tools/list",
      {},
      `Bearer ${issued.access_token}`,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(AUTH_REQUIRED);
  });
});

// ---------------------------------------------------------------------------
// Criterion 8: the limit of 20 active tokens
// ---------------------------------------------------------------------------

describe("criterion 8: OAuth connections count in the 20 active tokens", () => {
  it("given 20 active tokens, when a code is exchanged, then 400 invalid_request and no row is created", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await seedManualTokens(ctx.db, alice.id, 20);
    const a = await approved(ctx, alice);

    const res = await exchange(ctx, a);

    await expectTokenError(res, "invalid_request");
    const found = await tokenRows(ctx.db);
    expect(found).toHaveLength(20);
    expect(found.filter((r) => r.client_id !== null)).toEqual([]);
  });

  it("given 19 active tokens and 5 revoked ones, when a code is exchanged, then it works: only active tokens count", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await seedManualTokens(ctx.db, alice.id, 19, 5);

    await connect(ctx, alice);

    expect(await tokenRows(ctx.db)).toHaveLength(24);
  });

  it("given 20 active tokens that include the connection, when it is refreshed, then it works: a rotation adds no row", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await seedManualTokens(ctx.db, alice.id, 19);
    const issued = await connect(ctx, alice);

    const res = await refresh(ctx, issued.refresh_token);

    expect(res.status).toBe(200);
    expect(await tokenRows(ctx.db)).toHaveLength(20);
  });

  it("given another user at 20 tokens, when a user with none connects, then it works: the limit is per user", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const bob = await userWithSession(ctx.db, 2);
    await seedManualTokens(ctx.db, alice.id, 20);

    await connect(ctx, bob);

    expect(
      (await tokenRows(ctx.db)).filter((r) => r.user_id === bob.id),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterion 9: the tokens list
// ---------------------------------------------------------------------------

type Listed = { id: number; name: string; kind: string; lastFour: string };

describe("criterion 9: Jetons MCP shows the connection", () => {
  const list = async (ctx: Ctx, cookie: string) => {
    const res = await ctx.app.request("/api/me/tokens", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { tokens: Listed[] }).tokens;
  };

  it("given a connection and a manual token, when the tokens are listed, then both appear: the connection named claude.ai with kind oauth, the manual one with kind manual", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await ctx.app.request("/api/me/tokens", {
      method: "POST",
      headers: { cookie: alice.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Mon PC" }),
    });
    await connect(ctx, alice);

    const tokens = await list(ctx, alice.cookie);

    expect(tokens.map((t) => [t.name, t.kind]).sort()).toEqual([
      ["Mon PC", "manual"],
      ["claude.ai", "oauth"],
    ]);
  });

  it("given a connection whose access token expired, when the tokens are listed, then it is still listed: the refresh token keeps it alive", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await connect(ctx, alice);
    await ctx.db.execute(
      sql`update mcp_tokens set expires_at = now() - interval '1 minute'`,
    );

    const tokens = await list(ctx, alice.cookie);

    expect(tokens.map((t) => t.kind)).toEqual(["oauth"]);
  });

  it("given a connection, when the user revokes it with the existing route, then it is no longer listed, and never the hashes or the refresh token", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const issued = await connect(ctx, alice);
    const [connection] = await list(ctx, alice.cookie);
    assert(connection);

    const res = await revokeRoute(ctx, alice.cookie, connection.id);

    expect(res.status).toBe(204);
    expect(await list(ctx, alice.cookie)).toEqual([]);
    const text = JSON.stringify(
      await (
        await ctx.app.request("/api/me/tokens", {
          headers: { cookie: alice.cookie },
        })
      ).json(),
    );
    expect(text).not.toContain(issued.refresh_token);
    expect(text).not.toContain("refresh_hash");
    expect(text).not.toContain(sha256(issued.refresh_token));
  });

  it("given a connection of Alice, when Bob lists his tokens or revokes her connection, then he sees nothing and gets 404", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const bob = await userWithSession(ctx.db, 2);
    await connect(ctx, alice);
    const [row] = await tokenRows(ctx.db);
    assert(row);

    expect(await list(ctx, bob.cookie)).toEqual([]);
    expect((await revokeRoute(ctx, bob.cookie, row.id)).status).toBe(404);
  });
});

describe("criterion 10: GET /api/me/connect, what the Réglages section reads", () => {
  const connectInfo = (ctx: Ctx, cookie?: string) =>
    ctx.app.request("/api/me/connect", {
      headers: cookie ? { cookie } : {},
    });

  it("given no session, when it is requested, then 401", async () => {
    const ctx = await setup();

    expect((await connectInfo(ctx)).status).toBe(401);
  });

  it("given a user with no connection, when it is requested, then mcpUrl is <publicUrl>/mcp and connected is false", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await seedManualTokens(ctx.db, alice.id, 2);

    const res = await connectInfo(ctx, alice.cookie);

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      mcpUrl: MCP_URL,
      connected: false,
      connectedAt: null,
    });
  });

  it("given a connection, when it is requested, then connected is true with the date of the connection, and another user's connection does not count", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    const bob = await userWithSession(ctx.db, 2);
    await connect(ctx, alice);

    const mine = (await json(await connectInfo(ctx, alice.cookie))) as {
      connected: boolean;
      connectedAt: string;
    };
    const his = (await json(await connectInfo(ctx, bob.cookie))) as {
      connected: boolean;
    };

    expect(mine.connected).toBe(true);
    expect(
      Math.abs(new Date(mine.connectedAt).getTime() - Date.now()),
    ).toBeLessThan(60_000);
    expect(his.connected).toBe(false);
  });

  it("given a connection that was revoked, when it is requested, then connected is false again", async () => {
    const ctx = await setup();
    const alice = await userWithSession(ctx.db, 1);
    await connect(ctx, alice);
    const [row] = await tokenRows(ctx.db);
    assert(row);
    await revokeRoute(ctx, alice.cookie, row.id);

    const res = await connectInfo(ctx, alice.cookie);

    expect(await json(res)).toMatchObject({ connected: false });
  });
});
