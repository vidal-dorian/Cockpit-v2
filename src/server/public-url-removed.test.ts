import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { history, instanceSettings } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { githubCalls, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  createAdminWithSession,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 028 I: GET and PUT /api/settings/public-url are gone (404 as any unknown route), even for the administrator;
// the stored address does not change, GitHub is not told anything and nothing is written in the history.

const ADDRESS = "https://cockpit.example.com";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  const fetchMock = stubGitHub({ account: null });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, {
    publicUrl: ADDRESS,
    githubAppSlug: "cockpit-acme",
  });
  const app = createApp(db, "1.2.3", testAppOptions);
  const admin = await createAdminWithSession(db, 99);
  return { db, app, admin, fetchMock };
}

describe("/api/settings/public-url is gone (decision 028 I)", () => {
  it("given an administrator, when GET /api/settings/public-url is requested, then the answer is 404", async () => {
    const { app, admin } = await setup();

    const res = await app.request("/api/settings/public-url", {
      headers: { cookie: admin.cookie },
    });

    expect(res.status).toBe(404);
  });

  it("given an administrator, when PUT /api/settings/public-url is requested with a new https address, then the answer is 404, the stored address is unchanged, GitHub is not called and nothing is written in the history", async () => {
    const { db, app, admin, fetchMock } = await setup();

    const res = await app.request("/api/settings/public-url", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ publicUrl: "https://new.example.org" }),
    });

    expect(res.status).toBe(404);
    expect((await db.select().from(instanceSettings))[0]?.publicUrl).toBe(
      ADDRESS,
    );
    expect(githubCalls(fetchMock).filter((c) => c.method === "PATCH")).toEqual(
      [],
    );
    expect(await db.select().from(history)).toHaveLength(0);
  });
});
