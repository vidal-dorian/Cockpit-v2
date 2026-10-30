import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { history, instanceSettings, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  createAdminWithSession,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 023 B, C, D: the administrator changes the public address from Réglages.
//
// Pinned choices (the decision leaves them open):
// - A refused body (not a URL, not http(s), http:// on a non-loopback host, no `publicUrl`) is a 400 decided before
//   the action runs, as the other validated routes do (tokens.ts, projects.ts: `{ error }` and no history entry).
//   Only a successful change leaves an entry; a 400 changes nothing and leaves nothing in the history.
// - An http:// address answers exactly the sentence of the wizard; the other 400 only has to carry a string `error`.

const OLD_URL = "https://cockpit.example.com";
const NEW_URL = "https://new.example.org";
const HTTPS_ONLY =
  "L'adresse publique doit commencer par https:// : claude.ai l'exige.";

type App = ReturnType<typeof createApp>;
type TestDb = Awaited<ReturnType<typeof openTestDatabase>>;

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, {
    publicUrl: OLD_URL,
    githubAppSlug: "cockpit-acme",
  });
  const app = createApp(db, "1.2.3", testAppOptions);
  const admin = await createAdminWithSession(db, 99);
  return { db, app, admin };
}

/** A non-administrator with a live session. */
async function userWithSession(db: TestDb, githubId: number) {
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
  return { id: user.id, cookie: `cockpit_session=${value}` };
}

const get = (app: App, cookie?: string) =>
  app.request("/api/settings/public-url", {
    headers: cookie ? { cookie } : {},
  });

const put = (app: App, cookie: string | undefined, body: unknown) =>
  app.request("/api/settings/public-url", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const storedUrl = async (db: TestDb) =>
  (await db.select().from(instanceSettings))[0]?.publicUrl;

const entries = (db: TestDb) => db.select().from(history).orderBy(history.id);

describe("GET /api/settings/public-url", () => {
  it("given an administrator, when the address is requested, then it answers the stored publicUrl and the link to the settings of the App", async () => {
    const { app, admin } = await setup();

    const res = await get(app, admin.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      publicUrl: OLD_URL,
      appSettingsUrl: "https://github.com/settings/apps/cockpit-acme",
    });
  });

  it("given an administrator, when the address is requested, then nothing is written in the history", async () => {
    const { db, app, admin } = await setup();

    await get(app, admin.cookie);

    expect(await entries(db)).toHaveLength(0);
  });
});

describe("PUT /api/settings/public-url", () => {
  it("given an administrator, when they put a new https address, then it answers 200 with the new publicUrl and stores it", async () => {
    const { db, app, admin } = await setup();

    const res = await put(app, admin.cookie, { publicUrl: NEW_URL });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ publicUrl: NEW_URL });
    expect(await storedUrl(db)).toBe(NEW_URL);
    expect(await (await get(app, admin.cookie)).json()).toMatchObject({
      publicUrl: NEW_URL,
    });
  });

  it.each([
    ["a path", "https://new.example.org/some/path", NEW_URL],
    ["a trailing slash", "https://new.example.org/", NEW_URL],
    [
      "a port, a path and a query",
      "https://new.example.org:8443/x/?a=1",
      "https://new.example.org:8443",
    ],
  ])(
    "given an address with %s, when it is put, then only its origin is stored and answered",
    async (_name, typed, origin) => {
      const { db, app, admin } = await setup();

      const res = await put(app, admin.cookie, { publicUrl: typed });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ publicUrl: origin });
      expect(await storedUrl(db)).toBe(origin);
    },
  );

  it.each([
    ["localhost", "http://localhost:3000"],
    ["127.0.0.1", "http://127.0.0.1:3000"],
    ["[::1]", "http://[::1]:3000"],
  ])(
    "given an http:// address on %s, when it is put, then it is accepted (decision 023 B)",
    async (_name, publicUrl) => {
      const { db, app, admin } = await setup();

      const res = await put(app, admin.cookie, { publicUrl });

      expect(res.status).toBe(200);
      expect(await storedUrl(db)).toBe(publicUrl);
    },
  );

  it.each([
    ["a domain", "http://cockpit.example.com"],
    ["a private IP", "http://192.168.1.20:3000"],
    ["a domain that starts like localhost", "http://localhost.example.com"],
  ])(
    "given an http:// address on %s, when it is put, then 400 with the https message and nothing changes",
    async (_name, publicUrl) => {
      const { db, app, admin } = await setup();

      const res = await put(app, admin.cookie, { publicUrl });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: HTTPS_ONLY });
      expect(await storedUrl(db)).toBe(OLD_URL);
      expect(await entries(db)).toHaveLength(0);
    },
  );

  it.each([
    ["not a URL", { publicUrl: "cockpit" }],
    ["not http(s)", { publicUrl: "ftp://cockpit.example.com" }],
    ["empty", { publicUrl: "" }],
    ["missing", {}],
    ["not a string", { publicUrl: 42 }],
    ["a body that is not JSON", "{not json"],
  ])(
    "given a body with an address that is %s, when it is put, then 400 with an error and nothing changes, not even in the history",
    async (_name, body) => {
      const { db, app, admin } = await setup();

      const res = await put(app, admin.cookie, body);

      expect(res.status).toBe(400);
      expect(typeof ((await res.json()) as { error?: unknown }).error).toBe(
        "string",
      );
      expect(await storedUrl(db)).toBe(OLD_URL);
      expect(await entries(db)).toHaveLength(0);
    },
  );
});

describe("the new address is used at once, without restarting (decision 023 C)", () => {
  it("given the address was changed, when /api/me/connect is requested, then mcpUrl is <new address>/mcp", async () => {
    const { app, admin } = await setup();
    const before = await app.request("/api/me/connect", {
      headers: { cookie: admin.cookie },
    });
    // Reads the settings first, so a cache that never forgets would keep the old address.
    expect(await before.json()).toMatchObject({ mcpUrl: `${OLD_URL}/mcp` });

    const res = await put(app, admin.cookie, { publicUrl: NEW_URL });
    expect(res.status).toBe(200);

    const after = await app.request("/api/me/connect", {
      headers: { cookie: admin.cookie },
    });
    expect(await after.json()).toMatchObject({ mcpUrl: `${NEW_URL}/mcp` });
  });

  it("given the address was changed, when the OAuth metadata is requested, then the issuer, the endpoints and the protected resource follow the new address", async () => {
    const { app, admin } = await setup();
    await app.request("/.well-known/oauth-authorization-server");

    await put(app, admin.cookie, { publicUrl: NEW_URL });

    const server = await app.request("/.well-known/oauth-authorization-server");
    expect(await server.json()).toMatchObject({
      issuer: NEW_URL,
      authorization_endpoint: `${NEW_URL}/oauth/authorize`,
      token_endpoint: `${NEW_URL}/oauth/token`,
    });
    const resource = await app.request("/.well-known/oauth-protected-resource");
    expect(await resource.json()).toMatchObject({
      resource: `${NEW_URL}/mcp`,
      authorization_servers: [NEW_URL],
    });
  });

  it("given a refused change, when /api/me/connect is requested, then it still answers the old address", async () => {
    const { app, admin } = await setup();
    await app.request("/api/me/connect", { headers: { cookie: admin.cookie } });

    await put(app, admin.cookie, { publicUrl: "http://cockpit.example.com" });

    const res = await app.request("/api/me/connect", {
      headers: { cookie: admin.cookie },
    });
    expect(await res.json()).toMatchObject({ mcpUrl: `${OLD_URL}/mcp` });
  });
});

describe("the history of a change of address (decision 023 D)", () => {
  it("given an administrator changes the address, then one change_public_url entry is written: ok, by a human from the ui, with no args and neither address anywhere", async () => {
    const { db, app, admin } = await setup();

    await put(app, admin.cookie, { publicUrl: NEW_URL });

    const rows = await entries(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: admin.id,
      actor: "human",
      origin: "ui",
      action: "change_public_url",
      result: "ok",
      args: {},
    });
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain("example.org");
    expect(text).not.toContain("example.com");
  });
});

describe("access to /api/settings/public-url", () => {
  const routes: [
    string,
    (app: App, cookie?: string) => Response | Promise<Response>,
  ][] = [
    ["GET", (app, cookie) => get(app, cookie)],
    ["PUT", (app, cookie) => put(app, cookie, { publicUrl: NEW_URL })],
  ];

  it.each(routes)(
    "given a session that is not an administrator, when %s is called, then 403 and the address is unchanged",
    async (_method, call) => {
      const { db, app } = await setup();
      const user = await userWithSession(db, 5);

      const res = await call(app, user.cookie);

      expect(res.status).toBe(403);
      expect(await storedUrl(db)).toBe(OLD_URL);
      expect(await entries(db)).toHaveLength(0);
    },
  );

  it.each(routes)(
    "given no session, when %s is called, then 401 and the address is unchanged",
    async (_method, call) => {
      const { db, app } = await setup();

      const res = await call(app);

      expect(res.status).toBe(401);
      expect(await storedUrl(db)).toBe(OLD_URL);
    },
  );

  it.each(routes)(
    "given an instance the wizard has not configured, when %s is called, then 503 as the other /api/settings routes",
    async (_method, call) => {
      const db = await openTestDatabase();
      const app = createApp(db, "1.2.3", testAppOptions);

      const res = await call(app);

      expect(res.status).toBe(503);
    },
  );
});
