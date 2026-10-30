import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
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

// Decision 024 G (slice 5.1): changing the public address also changes the address of the App's webhook.
//
// Pinned choices (the decision leaves them open):
// - The answer of PUT /api/settings/public-url is exactly { publicUrl, webhookUpdated }.
// - A failed PATCH (any non-2xx answer of GitHub) leaves the change done, with exactly one change_public_url entry (ok).
// - A refused address (400) or a non-administrator never reaches GitHub.

afterEach(() => {
  vi.unstubAllGlobals();
});

const OLD_URL = "https://cockpit.example.com";
const NEW_URL = "https://new.example.org";

async function setup(
  webhook: Parameters<typeof stubGitHub>[0]["webhook"] = {},
) {
  const fetchMock = stubGitHub({ account: null, webhook });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, { publicUrl: OLD_URL });
  const app = createApp(db, "1.2.3", testAppOptions);
  const admin = await createAdminWithSession(db, 99);
  const put = (publicUrl: string) =>
    app.request("/api/settings/public-url", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ publicUrl }),
    });
  const patches = () =>
    githubCalls(fetchMock).filter((c) => c.method === "PATCH");
  /** The JSON bodies sent with PATCH /app/hook/config. */
  const patchBodies = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method?.toUpperCase() === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
  const stored = async () =>
    (await db.select().from(instanceSettings))[0]?.publicUrl;
  return { db, app, admin, fetchMock, put, patches, patchBodies, stored };
}

describe("PUT /api/settings/public-url changes the webhook of the App (decision 024 G)", () => {
  it("given an administrator, when they put a new address, then PATCH /app/hook/config is sent once as the App with exactly { url: <new>/api/webhooks/github }", async () => {
    const { put, patches, patchBodies } = await setup();

    const res = await put(NEW_URL);

    expect(res.status).toBe(200);
    expect(patches().map((c) => c.path)).toEqual(["/app/hook/config"]);
    expect(patches()[0]?.authorization).toMatch(/^bearer eyJ/i);
    expect(patchBodies()).toEqual([{ url: `${NEW_URL}/api/webhooks/github` }]);
  });

  it("given an address typed with a path and a trailing slash, when it is put, then the webhook gets the stored origin followed by /api/webhooks/github", async () => {
    const { put, patchBodies, fetchMock } = await setup();

    await put("https://new.example.org:8443/some/path/");

    expect(patchBodies()).toEqual([
      { url: "https://new.example.org:8443/api/webhooks/github" },
    ]);
    expect(fetchMock.webhook.url).toBe(
      "https://new.example.org:8443/api/webhooks/github",
    );
  });

  it("given GitHub accepts the change, when it is put, then the answer is exactly { publicUrl, webhookUpdated: true } and the address is stored", async () => {
    const { put, stored } = await setup();

    const res = await put(NEW_URL);

    expect(await res.json()).toEqual({
      publicUrl: NEW_URL,
      webhookUpdated: true,
    });
    expect(await stored()).toBe(NEW_URL);
  });

  it.each([500, 403, 404])(
    "given GitHub answers %s to the PATCH, when the address is put, then 200 { publicUrl, webhookUpdated: false }, the address is changed anyway and one change_public_url entry says ok",
    async (patchStatus) => {
      const { put, stored, db, admin, fetchMock } = await setup({
        patchStatus,
      });

      const res = await put(NEW_URL);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        publicUrl: NEW_URL,
        webhookUpdated: false,
      });
      expect(await stored()).toBe(NEW_URL);
      expect(fetchMock.webhook.url).toBe(`${OLD_URL}/api/webhooks/github`);
      const entries = await db
        .select()
        .from(history)
        .where(eq(history.action, "change_public_url"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ userId: admin.id, result: "ok" });
    },
  );

  it("given the PATCH is sent, when the address is read back by the server, then it was stored before GitHub was told (the new address is already in use when GitHub starts delivering)", async () => {
    const { put, db, fetchMock } = await setup();
    let storedWhenPatched: string | undefined;
    const real = fetchMock.getMockImplementation();
    assert(real);
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method?.toUpperCase() === "PATCH")
        storedWhenPatched = (await db.select().from(instanceSettings))[0]
          ?.publicUrl;
      return real(input, init);
    });

    await put(NEW_URL);

    expect(storedWhenPatched).toBe(NEW_URL);
  });

  it.each([
    ["an http:// address on a domain", "http://cockpit.example.com"],
    ["not a URL", "cockpit"],
  ])(
    "given an address that is %s, when it is put, then 400 and GitHub is not called",
    async (_name, publicUrl) => {
      const { put, fetchMock, patches } = await setup();

      const res = await put(publicUrl);

      expect(res.status).toBe(400);
      expect(patches()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
