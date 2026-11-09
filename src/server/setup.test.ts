import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { history, instanceSettings, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { decrypt } from "./secrets.ts";
import { failOnUnexpectedFetch, githubAppConfig } from "./test-github.ts";
import {
  configureTestInstance,
  createAdminWithSession,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

const CODE = testAppOptions.setupCode;
const PUBLIC_URL = "https://cockpit.example.com";
const PEM = githubAppConfig.githubAppPrivateKey;
const CLIENT_SECRET = "CLIENT-SECRET-VALUE-9f3a";
const WEBHOOK_SECRET = "WEBHOOK-SECRET-VALUE-7b1c";
const CONVERSION = {
  id: 98765,
  slug: "cockpit-acme",
  client_id: "Iv1.acme",
  client_secret: CLIENT_SECRET,
  webhook_secret: WEBHOOK_SECRET,
  pem: PEM,
  html_url: "https://github.com/apps/cockpit-acme",
};
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An instance nobody has configured yet. */
async function freshInstance() {
  const db = await openTestDatabase();
  const app = createApp(db, "1.2.3", testAppOptions);
  return { db, app };
}

async function configuredInstance() {
  const { db, app } = await freshInstance();
  await configureTestInstance(db, TEST_KEY);
  return { db, app };
}

const pairOf = (setCookie: string) => setCookie.split(";")[0] ?? "";
const cookieNamed = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const cookieValueOf = (setCookie: string) =>
  pairOf(setCookie).slice(pairOf(setCookie).indexOf("=") + 1);

type App = Awaited<ReturnType<typeof freshInstance>>["app"];

/** The request of a visitor who reached Cockpit over https (decision 028 J: the address is detected from the request itself). */
const HTTPS_VISITOR = {
  "cf-visitor": '{"scheme":"https"}',
  host: "cockpit.example.com",
};

const postStart = (
  app: App,
  body: unknown,
  headers: Record<string, string> = HTTPS_VISITOR,
  url = "/api/setup/start",
) =>
  app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/** Stubs the global fetch: only GitHub's manifest conversion is known; any other call fails loudly. */
function stubConversion(status: number, body: unknown = CONVERSION) {
  const unexpectedFetch = failOnUnexpectedFetch();
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (
        method === "POST" &&
        raw === "https://api.github.com/app-manifests/the-code/conversions"
      )
        return Response.json(body, { status });
      throw unexpectedFetch(`${method} ${raw}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Runs /api/setup/start with the right code and returns the state the server gave. */
async function startWizard(app: App) {
  const res = await postStart(app, { code: CODE });
  const cookie = cookieNamed(res, "cockpit_setup");
  assert(cookie, "start must set cockpit_setup");
  return { state: cookieValueOf(cookie), cookie: pairOf(cookie) };
}

const callbackRequest = (app: App, query: string, cookie?: string) =>
  app.request(`/api/setup/callback?${query}`, {
    headers: cookie ? { cookie } : {},
  });

const FAILED = "/installation?erreur=setup-echoue";

describe("GET /api/setup/status", () => {
  it("given an instance nobody configured, when the status is asked with the forwarded headers of the proxy, then configured is false and detectedUrl is built from them", async () => {
    const { app } = await freshInstance();

    const res = await app.request("/api/setup/status", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "cockpit.example.com",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      configured: false,
      detectedUrl: "https://cockpit.example.com",
    });
  });

  it("given no forwarded header, when the status is asked, then detectedUrl is the origin of the request", async () => {
    const { app } = await freshInstance();

    const res = await app.request("http://localhost:3000/api/setup/status");

    expect(await res.json()).toMatchObject({
      configured: false,
      detectedUrl: "http://localhost:3000",
    });
  });

  it("given the proxy forwards the protocol but not the host, when the status is asked, then detectedUrl uses x-forwarded-proto with the Host header", async () => {
    const { app } = await freshInstance();

    const res = await app.request("/api/setup/status", {
      headers: {
        host: "cockpit.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(await res.json()).toMatchObject({
      detectedUrl: "https://cockpit.example.com",
    });
  });

  it.each([
    ["Host", { host: "cockpit.example.com" }],
    ["X-Forwarded-Host", { "x-forwarded-host": "cockpit.example.com" }],
  ])(
    "given CF-Visitor says https while X-Forwarded-Proto says http (a tunnel), when the status is asked with the %s, then detectedUrl is https (decision 023 A)",
    async (_name, hostHeader) => {
      const { app } = await freshInstance();

      const res = await app.request("/api/setup/status", {
        headers: {
          ...hostHeader,
          "cf-visitor": '{"scheme":"https"}',
          "x-forwarded-proto": "http",
        },
      });

      expect(await res.json()).toMatchObject({
        detectedUrl: "https://cockpit.example.com",
      });
    },
  );

  it("given CF-Visitor says http while X-Forwarded-Proto says https, when the status is asked, then CF-Visitor wins and detectedUrl is http", async () => {
    const { app } = await freshInstance();

    const res = await app.request("/api/setup/status", {
      headers: {
        host: "cockpit.example.com",
        "cf-visitor": '{"scheme":"http"}',
        "x-forwarded-proto": "https",
      },
    });

    expect(await res.json()).toMatchObject({
      detectedUrl: "http://cockpit.example.com",
    });
  });

  // Guard: a header we cannot read changes nothing (it already holds before decision 023).
  it.each([
    ["not JSON", "scheme=https"],
    ["a scheme that is neither http nor https", '{"scheme":"ftp"}'],
    ["a JSON without scheme", "{}"],
    ["a JSON that is not an object", "[1]"],
    ["a scheme that is not a string", '{"scheme":42}'],
  ])(
    "given a malformed CF-Visitor (%s), when the status is asked, then it is ignored and X-Forwarded-Proto is used",
    async (_name, visitor) => {
      const { app } = await freshInstance();

      const res = await app.request("/api/setup/status", {
        headers: {
          host: "cockpit.example.com",
          "cf-visitor": visitor,
          "x-forwarded-proto": "https",
        },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        detectedUrl: "https://cockpit.example.com",
      });
    },
  );

  it("given a configured instance without administrator, when the status is asked, then hasAdmin is false", async () => {
    const { app } = await configuredInstance();

    const res = await app.request("/api/setup/status");

    expect(await res.json()).toMatchObject({
      configured: true,
      hasAdmin: false,
    });
  });

  it("given a configured instance with an administrator, when the status is asked, then hasAdmin is true", async () => {
    const { app, db } = await configuredInstance();
    await createAdminWithSession(db, 500);

    const res = await app.request("/api/setup/status");

    expect(await res.json()).toMatchObject({
      configured: true,
      hasAdmin: true,
    });
  });

  it("given a configured instance, when the status is asked without any session, then configured is true", async () => {
    const { app } = await configuredInstance();

    const res = await app.request("/api/setup/status");

    expect(res.status).toBe(200);
    expect(((await res.json()) as { configured: boolean }).configured).toBe(
      true,
    );
  });
});

describe("POST /api/setup/start", () => {
  it("given the right start code and an https request, when the wizard starts, then it answers the GitHub action URL carrying the state, and keeps the same state in an HttpOnly cookie", async () => {
    const { app } = await freshInstance();

    const res = await postStart(app, { code: CODE });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; manifest: object };
    const cookie = cookieNamed(res, "cockpit_setup");
    assert(cookie, "start must set cockpit_setup");
    const state = cookieValueOf(cookie);
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(body.action).toBe(
      `https://github.com/settings/apps/new?state=${state}`,
    );
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\/api\/setup(;|$)/i);
    expect(cookie).toMatch(/;\s*Max-Age=3600(;|$)/i);
  });

  it("given the right start code, when the wizard starts, then the manifest points every URL at the address detected from the request", async () => {
    const { app } = await freshInstance();

    const res = await postStart(app, { code: CODE });

    const { manifest } = (await res.json()) as {
      manifest: Record<string, unknown>;
    };
    expect(manifest).toMatchObject({
      url: PUBLIC_URL,
      redirect_url: `${PUBLIC_URL}/api/setup/callback`,
      callback_urls: [`${PUBLIC_URL}/api/auth/callback`],
      setup_url: `${PUBLIC_URL}/projets`,
      setup_on_update: true,
      public: true,
      hook_attributes: {
        url: `${PUBLIC_URL}/api/webhooks/github`,
        active: true,
      },
    });
  });

  it("given the right start code, when the wizard starts, then the manifest asks for the whole MVP permissions (Pull requests in write, decision 012 D amended by 026 G) and events, under a name GitHub accepts", async () => {
    const { app } = await freshInstance();

    const res = await postStart(app, { code: CODE });

    const { manifest } = (await res.json()) as {
      manifest: {
        name: string;
        default_permissions: unknown;
        default_events: string[];
      };
    };
    // Changed by decision 052 A (slice R6): the manifest also asks for the three alert permissions in read and the three alert events;
    // by decision 067 D (slice 12.4): and for `workflows` in write;
    // by decision 068 F (slice 12.5): and for `repository_creation` in write.
    expect(manifest.default_permissions).toEqual({
      metadata: "read",
      contents: "write",
      issues: "write",
      pull_requests: "write",
      checks: "read",
      statuses: "read",
      actions: "read",
      dependabot_alerts: "read",
      security_events: "read",
      secret_scanning_alerts: "read",
      workflows: "write",
      repository_creation: "write",
    });
    expect(manifest.default_events).toEqual(
      expect.arrayContaining([
        "issues",
        "pull_request",
        "check_suite",
        "status",
        "workflow_run",
        "dependabot_alert",
        "code_scanning_alert",
        "secret_scanning_alert",
      ]),
    );
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.name.length).toBeLessThanOrEqual(34);
  });

  it.each([
    ["lowercase without dashes", CODE.toLowerCase().replaceAll("-", "")],
    ["lowercase with dashes", CODE.toLowerCase()],
    ["with spaces around it", ` ${CODE} `],
  ])(
    "given the start code typed %s, when the wizard starts, then it is accepted like the canonical one",
    async (_name, typed) => {
      const { app } = await freshInstance();

      const res = await postStart(app, { code: typed });

      expect(res.status).toBe(200);
      expect(cookieNamed(res, "cockpit_setup")).toBeDefined();
    },
  );

  it("given a wrong start code, when the wizard starts, then it answers 403 with an error and sets no cookie", async () => {
    const { app } = await freshInstance();

    const res = await postStart(app, { code: "nope" });

    expect(res.status).toBe(403);
    expect(typeof ((await res.json()) as { error?: unknown }).error).toBe(
      "string",
    );
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("given an https request and another publicUrl in the body, when the wizard starts, then the manifest is built on the detected address and the body address is ignored (decision 028 J)", async () => {
    const { app } = await freshInstance();

    const res = await postStart(app, {
      code: CODE,
      publicUrl: "https://other.example.org",
    });

    expect(res.status).toBe(200);
    const { manifest } = (await res.json()) as {
      manifest: { url: string; redirect_url: string };
    };
    expect(manifest.url).toBe("https://cockpit.example.com");
    expect(manifest.redirect_url).toBe(
      "https://cockpit.example.com/api/setup/callback",
    );
  });

  it.each([
    ["garbage", "cockpit"],
    ["an http address", "http://cockpit.example.com"],
    ["empty", ""],
  ])(
    "given an https request and a publicUrl that is %s in the body, when the wizard starts, then it is ignored and the wizard starts (decision 028 J)",
    async (_name, publicUrl) => {
      const { app } = await freshInstance();

      const res = await postStart(app, { code: CODE, publicUrl });

      expect(res.status).toBe(200);
      expect(cookieNamed(res, "cockpit_setup")).toBeDefined();
    },
  );

  it.each([
    ["a domain", { host: "cockpit.example.com" }],
    ["a domain with a port", { host: "cockpit.example.com:3000" }],
    ["a private IP", { host: "192.168.1.20:3000" }],
    ["a domain that starts like localhost", { host: "localhost.example.com" }],
    ["a domain that starts like an IP", { host: "127.0.0.1.example.com" }],
  ])(
    "given the right start code and a request that arrives in http on %s (X-Forwarded-Proto: http), when the wizard starts, then it answers 400 with the https sentence, sets no cookie and prepares nothing (decision 028 J)",
    async (_name, host) => {
      const { app, db } = await freshInstance();

      const res = await postStart(
        app,
        { code: CODE, publicUrl: "https://cockpit.example.com" },
        { ...host, "x-forwarded-proto": "http" },
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error:
          "Ouvre Cockpit par son adresse en https:// pour l'installer : claude.ai l'exige pour le connecteur.",
      });
      expect(cookieNamed(res, "cockpit_setup")).toBeUndefined();
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(await db.select().from(instanceSettings)).toHaveLength(0);
    },
  );

  it("given the right start code and a plain http request on a public host with no forwarded header, when the wizard starts, then it answers 400 with the https sentence", async () => {
    const { app } = await freshInstance();

    const res = await postStart(
      app,
      { code: CODE },
      {},
      "http://cockpit.example.com/api/setup/start",
    );

    expect(res.status).toBe(400);
    expect(cookieNamed(res, "cockpit_setup")).toBeUndefined();
  });

  // Developing on one's own machine keeps working (decision 023 B), the manifest being built on the request's own origin.
  it.each([
    ["localhost", "http://localhost:3000"],
    ["127.0.0.1", "http://127.0.0.1:3000"],
    ["[::1]", "http://[::1]:3000"],
  ])(
    "given the right start code on %s over http, when the wizard starts, then it is accepted and the manifest is built on %s",
    async (_name, origin) => {
      const { app } = await freshInstance();

      const res = await postStart(
        app,
        { code: CODE },
        {},
        `${origin}/api/setup/start`,
      );

      expect(res.status).toBe(200);
      expect(cookieNamed(res, "cockpit_setup")).toBeDefined();
      const { manifest } = (await res.json()) as {
        manifest: { url: string; redirect_url: string };
      };
      expect(manifest.url).toBe(origin);
      expect(manifest.redirect_url).toBe(`${origin}/api/setup/callback`);
    },
  );

  it("given an instance that is already configured, when the wizard starts with the right code, then it answers 409 and sets no cookie", async () => {
    const { app } = await configuredInstance();

    const res = await postStart(app, { code: CODE });

    expect(res.status).toBe(409);
    expect(cookieNamed(res, "cockpit_setup")).toBeUndefined();
  });
});

describe("GET /api/setup/callback", () => {
  it("given a state matching the cookie and a successful conversion, when GitHub sends the browser back, then the App is stored with its three secrets encrypted", async () => {
    const { app, db } = await freshInstance();
    const { state, cookie } = await startWizard(app);
    const fetchMock = stubConversion(201);

    const res = await callbackRequest(
      app,
      `code=the-code&state=${state}`,
      cookie,
    );

    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [rows, ...others] = await db.select().from(instanceSettings);
    assert(rows);
    expect(others).toHaveLength(0);
    expect(rows).toMatchObject({
      id: 1,
      publicUrl: PUBLIC_URL,
      githubAppId: String(CONVERSION.id),
      githubAppSlug: CONVERSION.slug,
      githubClientId: CONVERSION.client_id,
    });
    expect(decrypt(TEST_KEY, rows.githubClientSecret)).toBe(CLIENT_SECRET);
    expect(decrypt(TEST_KEY, rows.githubPrivateKey)).toBe(PEM);
    expect(decrypt(TEST_KEY, rows.githubWebhookSecret)).toBe(WEBHOOK_SECRET);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(CLIENT_SECRET);
    expect(serialized).not.toContain(WEBHOOK_SECRET);
    for (const line of PEM.split("\n").filter((l) => l.length > 20))
      expect(serialized).not.toContain(line);
  });

  it("given a successful conversion, when the callback answers, then it hands out an HttpOnly admin claim cookie whose SHA-256 is stored, and redirects to the GitHub login", async () => {
    const { app, db } = await freshInstance();
    const { state, cookie } = await startWizard(app);
    stubConversion(201);

    const res = await callbackRequest(
      app,
      `code=the-code&state=${state}`,
      cookie,
    );

    expect(res.headers.get("location")).toBe("/api/auth/login");
    const claim = cookieNamed(res, "cockpit_admin_claim");
    assert(claim, "the callback must set cockpit_admin_claim");
    expect(claim).toMatch(/;\s*HttpOnly/i);
    expect(cookieValueOf(claim).length).toBeGreaterThanOrEqual(32);
    const [row] = await db.select().from(instanceSettings);
    expect(row?.adminClaimHash).toBe(sha256(cookieValueOf(claim)));
    expect(row?.adminClaimHash).not.toBe(cookieValueOf(claim));
  });

  it("given a successful conversion, when the callback answers, then one setup_github_app entry is written as ok, by a human, with no user and no secret", async () => {
    const { app, db } = await freshInstance();
    const { state, cookie } = await startWizard(app);
    stubConversion(201);

    await callbackRequest(app, `code=the-code&state=${state}`, cookie);

    const rows = await db.select().from(history);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "setup_github_app",
      result: "ok",
      actor: "human",
      userId: null,
    });
    const serialized = JSON.stringify(rows[0]);
    for (const secret of [CLIENT_SECRET, WEBHOOK_SECRET, "PRIVATE KEY"])
      expect(serialized).not.toContain(secret);
  });

  it.each([
    ["the state differs from the cookie", "wrong-state", true],
    ["there is no setup cookie at all", "any-state", false],
    ["the callback has no state", "", true],
  ])(
    "given a callback where %s, when it arrives, then it redirects to setup-echoue, never calls GitHub and stores nothing",
    async (_name, queryState, withCookie) => {
      const { app, db } = await freshInstance();
      const { cookie } = await startWizard(app);
      const fetchMock = stubConversion(201);
      const query = queryState
        ? `code=the-code&state=${queryState}`
        : "code=the-code";

      const res = await callbackRequest(
        app,
        query,
        withCookie ? cookie : undefined,
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(FAILED);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.select().from(instanceSettings)).toHaveLength(0);
      expect(cookieNamed(res, "cockpit_admin_claim")).toBeUndefined();
    },
  );

  it("given a state that already served once (here a failed conversion), when the browser replays the callback, then it redirects to setup-echoue and GitHub is not called again", async () => {
    const { app, db } = await freshInstance();
    const { state, cookie } = await startWizard(app);
    const fetchMock = stubConversion(422, { message: "Validation Failed" });
    await callbackRequest(app, `code=the-code&state=${state}`, cookie);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const replayMock = stubConversion(201);

    const res = await callbackRequest(
      app,
      `code=the-code&state=${state}`,
      cookie,
    );

    expect(res.headers.get("location")).toBe(FAILED);
    expect(replayMock).not.toHaveBeenCalled();
    expect(await db.select().from(instanceSettings)).toHaveLength(0);
  });

  it("given a successful setup, when the same callback is replayed, then it redirects to setup-echoue, GitHub is not called and the stored settings do not change", async () => {
    const { app, db } = await freshInstance();
    const { state, cookie } = await startWizard(app);
    stubConversion(201);
    await callbackRequest(app, `code=the-code&state=${state}`, cookie);
    const before = await db.select().from(instanceSettings);
    const replayMock = stubConversion(201);

    const res = await callbackRequest(
      app,
      `code=the-code&state=${state}`,
      cookie,
    );

    expect(res.headers.get("location")).toBe(FAILED);
    expect(replayMock).not.toHaveBeenCalled();
    expect(await db.select().from(instanceSettings)).toEqual(before);
    expect(await db.select().from(history)).toHaveLength(1);
  });

  it("given a valid state started before the instance got configured, when its callback arrives after the configuration, then it redirects to setup-echoue, GitHub is not called and nothing changes", async () => {
    const { app, db } = await freshInstance();
    const { state, cookie } = await startWizard(app);
    await configureTestInstance(db, TEST_KEY);
    const before = await db.select().from(instanceSettings);
    const fetchMock = stubConversion(201);

    const res = await callbackRequest(
      app,
      `code=the-code&state=${state}`,
      cookie,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(FAILED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(instanceSettings)).toEqual(before);
    expect(cookieNamed(res, "cockpit_admin_claim")).toBeUndefined();
    expect(await db.select().from(history)).toHaveLength(0);
  });

  it.each([
    ["answers 422", 422, { message: "Validation Failed" }],
    ["answers 404", 404, { message: "Not Found" }],
    ["answers 201 with a body that is not an App", 201, { id: 1 }],
  ])(
    "given GitHub's conversion %s, when the callback arrives with a good state, then it redirects to setup-echoue and stores nothing",
    async (_name, status, body) => {
      const { app, db } = await freshInstance();
      const { state, cookie } = await startWizard(app);
      stubConversion(status, body);

      const res = await callbackRequest(
        app,
        `code=the-code&state=${state}`,
        cookie,
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(FAILED);
      expect(await db.select().from(instanceSettings)).toHaveLength(0);
      expect(cookieNamed(res, "cockpit_admin_claim")).toBeUndefined();
    },
  );
});

describe("an instance that is not configured", () => {
  it("given no configuration, when someone asks to log in, then they are sent to the wizard instead of GitHub", async () => {
    const { app } = await freshInstance();

    const res = await app.request("/api/auth/login");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/installation");
  });

  it.each([
    ["GET", "/api/projects"],
    ["POST", "/api/projects"],
    ["POST", "/api/projects/1/archive"],
    ["GET", "/api/github/repositories"],
  ])(
    "given no configuration, when %s %s is called, then it answers 503 with an error",
    async (method, path) => {
      const { app } = await freshInstance();

      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });

      expect(res.status).toBe(503);
      expect(typeof ((await res.json()) as { error?: unknown }).error).toBe(
        "string",
      );
    },
  );

  it("given no configuration, when /api/me and /api/health are called, then they keep working", async () => {
    const { app } = await freshInstance();

    const me = await app.request("/api/me");
    const health = await app.request("/api/health");

    expect(me.status).toBe(401);
    expect(health.status).toBe(200);
  });
});

describe("first administrator", () => {
  const CLAIM = "claim-value-of-the-first-admin-0123456789";
  const octocat = {
    id: 1,
    login: "octocat",
    name: "The Octocat",
    avatar_url: "https://avatars/1",
  };

  /** The login callback, with GitHub stubbed; `extraCookies` is what the browser holds besides the OAuth state. */
  async function logIn(app: App, extraCookies: string) {
    const unexpectedFetch = failOnUnexpectedFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : String(input));
        if (
          url.origin + url.pathname ===
          "https://github.com/login/oauth/access_token"
        )
          return Response.json({ access_token: "gho_token" });
        if (url.origin + url.pathname === "https://api.github.com/user")
          return Response.json(octocat);
        // The landing check after login (decision 012 H): the App is installed.
        if (/^\/users\/[^/]+\/installation$/.test(url.pathname))
          return Response.json({ id: 77, account: { id: octocat.id } });
        throw unexpectedFetch(url.href);
      }),
    );
    const start = await app.request("/api/auth/login");
    const location = start.headers.get("location");
    assert(location, "login must redirect");
    const state = new URL(location).searchParams.get("state");
    assert(state, "login must send a state");
    const stateCookies = start.headers.getSetCookie().map(pairOf).join("; ");
    return app.request(
      `/api/auth/callback?code=gh-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie: [stateCookies, extraCookies].filter(Boolean).join("; "),
        },
      },
    );
  }

  it("given the claim cookie of the wizard, when the first person logs in with GitHub, then they become administrator, the claim is spent, its cookie deleted and a session issued", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY, {
      adminClaimHash: sha256(CLAIM),
    });

    const res = await logIn(app, `cockpit_admin_claim=${CLAIM}`);

    expect(res.headers.get("location")).toBe("/");
    const [user, ...others] = await db.select().from(users);
    assert(user);
    expect(others).toHaveLength(0);
    expect(user).toMatchObject({
      githubId: 1,
      login: "octocat",
      isAdmin: true,
    });
    const [settings] = await db.select().from(instanceSettings);
    expect(settings?.adminClaimHash).toBeNull();
    const cleared = cookieNamed(res, "cockpit_admin_claim");
    assert(cleared, "the claim cookie must be deleted");
    expect(cookieValueOf(cleared)).toBe("");
    expect(cookieNamed(res, "cockpit_session")).toBeDefined();
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it("given a claim cookie that does not match the stored hash, when someone logs in, then they sign up as a non-administrator and the claim stays available", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY, {
      adminClaimHash: sha256(CLAIM),
    });

    const res = await logIn(app, "cockpit_admin_claim=another-value");

    expect(res.headers.get("location")).toBe("/");
    const [user, ...others] = await db.select().from(users);
    expect(others).toHaveLength(0);
    expect(user).toMatchObject({ login: "octocat", isAdmin: false });
    expect(await db.select().from(sessions)).toHaveLength(1);
    const [settings] = await db.select().from(instanceSettings);
    expect(settings?.adminClaimHash).toBe(sha256(CLAIM));
  });

  it("given the claim already spent, when a second person logs in with the old claim cookie, then they sign up as a non-administrator", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY);
    await createAdminWithSession(db, 500);

    const res = await logIn(app, `cockpit_admin_claim=${CLAIM}`);

    expect(res.headers.get("location")).toBe("/");
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(2);
    expect(rows.filter((u) => u.isAdmin).map((u) => u.githubId)).toEqual([500]);
  });

  it("given an administrator already exists, when a person logs in with a claim cookie that still matches a leftover hash, then they do not become administrator", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY, {
      adminClaimHash: sha256(CLAIM),
    });
    await createAdminWithSession(db, 500);

    const res = await logIn(app, `cockpit_admin_claim=${CLAIM}`);

    expect(res.headers.get("location")).toBe("/");
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(2);
    const admins = rows.filter((u) => u.isAdmin);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.githubId).toBe(500);
  });

  it("given no claim cookie and nobody is administrator yet, when someone logs in, then they sign up as a non-administrator and the claim stays available", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY, {
      adminClaimHash: sha256(CLAIM),
    });

    const res = await logIn(app, "");

    expect(res.headers.get("location")).toBe("/");
    const [user, ...others] = await db.select().from(users);
    expect(others).toHaveLength(0);
    expect(user).toMatchObject({ login: "octocat", isAdmin: false });
    const [settings] = await db.select().from(instanceSettings);
    expect(settings?.adminClaimHash).toBe(sha256(CLAIM));
  });

  const postClaim = (app: App, body: unknown) =>
    app.request("/api/setup/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("given a configured instance without administrator, when the right start code is posted to /api/setup/claim, then it answers the login path and a fresh HttpOnly claim cookie whose SHA-256 replaces the stored hash", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY, {
      adminClaimHash: sha256(CLAIM),
    });

    const res = await postClaim(app, { code: CODE });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ next: "/api/auth/login" });
    const cookie = cookieNamed(res, "cockpit_admin_claim");
    assert(cookie, "claim must set cockpit_admin_claim");
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookieValueOf(cookie).length).toBeGreaterThanOrEqual(32);
    const [row] = await db.select().from(instanceSettings);
    expect(row?.adminClaimHash).toBe(sha256(cookieValueOf(cookie)));
    expect(row?.adminClaimHash).not.toBe(sha256(CLAIM));
  });

  it("given the claim cookie handed out by /api/setup/claim, when the person logs in with GitHub, then they become administrator", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY);
    const claim = await postClaim(app, { code: CODE });
    const cookie = cookieNamed(claim, "cockpit_admin_claim");
    assert(cookie, "claim must set cockpit_admin_claim");

    const res = await logIn(app, pairOf(cookie));

    expect(res.headers.get("location")).toBe("/");
    const [user] = await db.select().from(users);
    expect(user).toMatchObject({ login: "octocat", isAdmin: true });
    const [row] = await db.select().from(instanceSettings);
    expect(row?.adminClaimHash).toBeNull();
  });

  it("given a wrong start code, when it is posted to /api/setup/claim, then it answers 403 and sets no cookie nor stores a hash", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY);

    const res = await postClaim(app, { code: "nope" });

    expect(res.status).toBe(403);
    expect(cookieNamed(res, "cockpit_admin_claim")).toBeUndefined();
    const [row] = await db.select().from(instanceSettings);
    expect(row?.adminClaimHash).toBeNull();
  });

  it("given an administrator already exists, when the right start code is posted to /api/setup/claim, then it answers 409 and sets no cookie", async () => {
    const { app, db } = await freshInstance();
    await configureTestInstance(db, TEST_KEY);
    await createAdminWithSession(db, 500);

    const res = await postClaim(app, { code: CODE });

    expect(res.status).toBe(409);
    expect(cookieNamed(res, "cockpit_admin_claim")).toBeUndefined();
    const [row] = await db.select().from(instanceSettings);
    expect(row?.adminClaimHash).toBeNull();
  });
});
