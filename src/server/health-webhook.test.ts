import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { projectMembers, projects, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  DEFAULT_WEBHOOK_URL,
  githubCalls,
  INSTALLATION_ID,
  stubGitHub,
} from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 024 F (slice 5.1): the fifth line of the health check, `webhook`.
//
// Pinned choices (the decision leaves them open):
// - The one-minute memory reads the clock of the app (the `now` option of createApp), like the other timed caches.
// - `GET /app/hook/deliveries` is asked with `?per_page=1`; both reads carry the JWT of the App.
// - The webhook address must equal `<public address>/api/webhooks/github` exactly (a trailing slash is another address).
// - A config answer with `active: false` is red wrong_url (the REST endpoint of GitHub does not send that field today:
//   this only pins what Cockpit does if it is there).
// - Any status_code outside 200-299 on the last delivery is last_delivery_failed.

afterEach(() => {
  vi.unstubAllGlobals();
});

const START = Date.parse("2026-10-30T10:00:00Z");
const MINUTE = 60_000;
const SYNCED = { key: "webhook", ok: true, detail: "ok" };

type Line = { key: string; ok: boolean; detail: string };

async function userWithSession(
  db: Awaited<ReturnType<typeof openTestDatabase>>,
  githubId: number,
) {
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

/** Two users, each with one project (user1000/a, user2000/b) in a repo that holds nothing; a clock the test moves. */
async function setupHealth(
  webhook: Parameters<typeof stubGitHub>[0]["webhook"] = {},
) {
  const fetchMock = stubGitHub({
    account: 1000,
    files: {},
    webhook,
  });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const clock = { now: START };
  const app = createApp(db, "1.2.3", {
    ...testAppOptions,
    now: () => clock.now,
  });
  const mk = async (githubId: number, name: string, repoId: number) => {
    const user = await userWithSession(db, githubId);
    const [project] = await db
      .insert(projects)
      .values({
        githubRepoId: repoId,
        fullName: `user${githubId}/${name}`,
        defaultBranch: "main",
        installationId: INSTALLATION_ID,
      })
      .returning({ id: projects.id });
    assert(project);
    await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: user.id, role: "owner" });
    return { cookie: user.cookie, id: project.id };
  };
  const a = await mk(1000, "a", 1);
  const b = await mk(2000, "b", 2);
  const health = (who: { cookie: string; id: number }) =>
    app.request(`/api/projects/${who.id}/health`, {
      headers: { cookie: who.cookie },
    });
  const lines = async (who: { cookie: string; id: number }) => {
    const res = await health(who);
    expect(res.status).toBe(200);
    return ((await res.json()) as { lines: Line[] }).lines;
  };
  const webhookLine = async (who: { cookie: string; id: number }) =>
    (await lines(who)).find((line) => line.key === "webhook");
  const hookCalls = () =>
    githubCalls(fetchMock).filter((c) => c.path.startsWith("/app/hook/"));
  return { fetchMock, clock, a, b, health, lines, webhookLine, hookCalls };
}

describe("the webhook line of the health check (decision 024 F)", () => {
  it("given a repo, when the health is requested, then the webhook line is the fifth, after claude_md, ci, mcp and agents", async () => {
    const { a, lines } = await setupHealth();

    // Decision 052 (slice R6): github_alerts and updates come after the webhook line; its place among the first five is unchanged.
    expect((await lines(a)).map((line) => line.key).slice(0, 5)).toEqual([
      "claude_md",
      "ci",
      "mcp",
      "agents",
      "webhook",
    ]);
  });

  it("given the webhook points at <public address>/api/webhooks/github and GitHub delivered nothing yet, when the health is requested, then the line is ok", async () => {
    const { a, webhookLine } = await setupHealth({ url: DEFAULT_WEBHOOK_URL });

    expect(await webhookLine(a)).toEqual(SYNCED);
  });

  it.each([200, 201, 204, 299])(
    "given the right address and a last delivery with status %s, when the health is requested, then the line is ok",
    async (status_code) => {
      const { a, webhookLine } = await setupHealth({
        deliveries: [{ status_code }],
      });

      expect(await webhookLine(a)).toEqual(SYNCED);
    },
  );

  it("given the right address, a last delivery that succeeded and older ones that failed, when the health is requested, then the line is ok: only the last one counts", async () => {
    const { a, webhookLine } = await setupHealth({
      deliveries: [{ status_code: 200 }, { status_code: 500 }],
    });

    expect(await webhookLine(a)).toEqual(SYNCED);
  });

  it("given the webhook is read, when the health is requested, then Cockpit asks GET /app/hook/config and GET /app/hook/deliveries?per_page=1 as the App (a JWT, never an installation token)", async () => {
    const { a, lines, hookCalls } = await setupHealth();

    await lines(a);

    const calls = hookCalls();
    expect(calls.map((c) => `${c.method} ${c.path}${c.search}`).sort()).toEqual(
      ["GET /app/hook/config", "GET /app/hook/deliveries?per_page=1"],
    );
    for (const call of calls)
      expect(call.authorization).toMatch(/^bearer eyJ/i);
  });

  it.each([
    [
      "another host",
      "https://other.example.org/api/webhooks/github",
      undefined,
    ],
    ["another path", "https://cockpit.example.com/hook", undefined],
    ["a trailing slash", `${DEFAULT_WEBHOOK_URL}/`, undefined],
    [
      "the address of Cockpit over http",
      "http://cockpit.example.com/api/webhooks/github",
      undefined,
    ],
    ["the right address but the webhook disabled", DEFAULT_WEBHOOK_URL, false],
  ])(
    "given a webhook with %s, when the health is requested, then the line is red wrong_url",
    async (_name, url, active) => {
      const { a, webhookLine } = await setupHealth({ url, active });

      expect(await webhookLine(a)).toEqual({
        key: "webhook",
        ok: false,
        detail: "wrong_url",
      });
    },
  );

  it.each([500, 404, 302])(
    "given the right address and a last delivery with status %s, when the health is requested, then the line is red last_delivery_failed",
    async (status_code) => {
      const { a, webhookLine } = await setupHealth({
        deliveries: [{ status_code }, { status_code: 200 }],
      });

      expect(await webhookLine(a)).toEqual({
        key: "webhook",
        ok: false,
        detail: "last_delivery_failed",
      });
    },
  );

  it.each([
    ["the config", { configStatus: 500 }],
    ["the deliveries", { deliveriesStatus: 500 }],
    ["both", { configStatus: 500, deliveriesStatus: 502 }],
  ])(
    "given GitHub fails on %s, when the health is requested, then 200 with the webhook line red unknown and the other four lines still computed",
    async (_name, webhook) => {
      const { a, lines } = await setupHealth(webhook);

      const answer = await lines(a);

      // Decision 052 (slice R6): the webhook line is no longer last, and the two new lines are computed too; the five of before are compared by key.
      expect(answer.slice(0, 5)).toEqual([
        { key: "claude_md", ok: false, detail: "missing" },
        { key: "ci", ok: false, detail: "missing" },
        { key: "mcp", ok: true, detail: "ok" },
        { key: "agents", ok: false, detail: "missing" },
        { key: "webhook", ok: false, detail: "unknown" },
      ]);
      expect(answer.map((l) => l.key).slice(5)).toEqual([
        "github_alerts",
        "updates",
      ]);
    },
  );
});

describe("the two webhook reads are kept one minute (decision 024 F)", () => {
  it("given three displays across two projects of two users within the minute, then the config and the deliveries are each read once", async () => {
    const { a, b, lines, hookCalls, clock } = await setupHealth();

    await lines(a);
    clock.now += 30_000;
    await lines(b);
    clock.now += 29_000;
    await lines(a);

    const paths = hookCalls().map((c) => c.path);
    expect(paths.filter((p) => p === "/app/hook/config")).toHaveLength(1);
    expect(paths.filter((p) => p === "/app/hook/deliveries")).toHaveLength(1);
  });

  it("given the reads were made, when a minute and a second have passed, then the next display reads them again, once", async () => {
    const { a, b, lines, hookCalls, clock } = await setupHealth();
    await lines(a);

    clock.now += MINUTE + 1000;
    await lines(b);
    await lines(a);

    const paths = hookCalls().map((c) => c.path);
    expect(paths.filter((p) => p === "/app/hook/config")).toHaveLength(2);
    expect(paths.filter((p) => p === "/app/hook/deliveries")).toHaveLength(2);
  });

  it("given the webhook changed on GitHub, when the health is requested within the minute, then the line still shows the old state; after the minute it shows the new one", async () => {
    const { a, fetchMock, webhookLine, clock } = await setupHealth();
    expect(await webhookLine(a)).toEqual(SYNCED);

    fetchMock.webhook.deliveries = [{ status_code: 500 }];
    clock.now += 30_000;
    expect(await webhookLine(a)).toEqual(SYNCED);
    clock.now += 31_000;

    expect(await webhookLine(a)).toEqual({
      key: "webhook",
      ok: false,
      detail: "last_delivery_failed",
    });
  });

  it("given a repo whose HEAD did not change (GitHub answers 304 on the root), when the webhook breaks and a minute passes, then the line is red wrong_url: it is not part of the per-commit cache", async () => {
    const { a, fetchMock, lines, webhookLine, clock } = await setupHealth();
    // Found by key: the webhook line is no longer the last one (decision 052, slice R6).
    expect(await webhookLine(a)).toEqual(SYNCED);
    fetchMock.webhook.url = "https://elsewhere.example.org/api/webhooks/github";
    clock.now += MINUTE + 1000;

    const second = await lines(a);

    expect(second.find((l) => l.key === "webhook")).toEqual({
      key: "webhook",
      ok: false,
      detail: "wrong_url",
    });
    // The repo itself was not read again: one root 200, the second root read answered 304.
    expect(fetchMock.served).toHaveLength(1);
  });

  it("given a project that is not the caller's, when the health is requested, then 404 and the webhook is not read", async () => {
    const { a, b, health, hookCalls } = await setupHealth();

    const res = await health({ cookie: a.cookie, id: b.id });

    expect(res.status).toBe(404);
    expect(hookCalls()).toEqual([]);
  });
});
