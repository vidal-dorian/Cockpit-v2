import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decrypt } from "./secrets.ts";
import { send } from "./test-decisions.ts";
import { TEST_KEY } from "./test-instance.ts";
import { withProject } from "./test-mcp.ts";
import {
  appWith,
  device,
  deviceRows,
  pushDouble,
  subscribe,
} from "./test-push.ts";

// Slice 15.2 (decision 072 D, F): the VAPID key, the devices, the switches and the test notification.

const DEFAULTS = {
  question: true,
  runFailed: true,
  prReady: true,
  nightRecap: true,
  quietStartHour: 22,
  quietEndHour: 7,
};

describe("slice 15.2: the VAPID key", () => {
  it("given a logged-in user, when GET /api/push/key is called twice, then it answers the same public key and the private key is stored encrypted", async () => {
    const ctx = await withProject();

    const first = await send(ctx.app, ctx.alice.cookie, "GET", "/api/push/key");
    const second = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      "/api/push/key",
    );

    expect(first.status).toBe(200);
    const { publicKey } = (await first.json()) as { publicKey: string };
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(await second.json()).toEqual({ publicKey });
    const row = (
      (await ctx.db.execute(
        sql`select to_jsonb(s) as r from instance_settings s`,
      )) as unknown as { rows: { r: Record<string, unknown> }[] }
    ).rows[0]?.r;
    const decrypted = Object.values(row ?? {})
      .filter((v): v is string => typeof v === "string" && v.startsWith("v1:"))
      .map((v) => {
        try {
          return decrypt(TEST_KEY, v);
        } catch {
          return "";
        }
      });
    const privateKey = decrypted.find((v) => /^[A-Za-z0-9_-]{43}$/.test(v));
    expect(privateKey, "an encrypted VAPID private key").toBeDefined();
    expect(JSON.stringify(row)).not.toContain(privateKey);
  });

  it("given no session, when GET /api/push/key is called, then 401", async () => {
    const ctx = await withProject();

    const res = await ctx.app.request("/api/push/key");

    expect(res.status).toBe(401);
  });
});

describe("slice 15.2: the devices", () => {
  it("given a user, when the same device is subscribed twice, then one row belongs to her; when it is deleted, then no row is left", async () => {
    const ctx = await withProject();

    const first = await subscribe(ctx, ctx.alice.cookie, 1);
    const again = await subscribe(ctx, ctx.alice.cookie, 1);

    expect(first.status).toBe(204);
    expect(again.status).toBe(204);
    expect(await deviceRows(ctx.db)).toEqual([
      { user_id: ctx.alice.id, endpoint: device(1).endpoint },
    ]);
    const gone = await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      "/api/push/subscriptions",
      { endpoint: device(1).endpoint },
    );
    expect(gone.status).toBe(204);
    expect(await deviceRows(ctx.db)).toEqual([]);
  });

  it("given no session, when a device is subscribed, then 401 and nothing is stored", async () => {
    const ctx = await withProject();

    const res = await ctx.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(device(1)),
    });

    expect(res.status).toBe(401);
    expect(await deviceRows(ctx.db)).toEqual([]);
  });

  it("given a non-https endpoint, when the device is subscribed, then 400 and nothing is stored", async () => {
    const ctx = await withProject();

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      "/api/push/subscriptions",
      { ...device(1), endpoint: "http://push.example.com/send/1" },
    );

    expect(res.status).toBe(400);
    expect(await deviceRows(ctx.db)).toEqual([]);
  });
});

describe("slice 15.2: the switches and the quiet hours", () => {
  it("given a new user, when GET /api/me/notifications is called, then the four switches are on and the quiet hours are 22 to 7", async () => {
    const ctx = await withProject();

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      "/api/me/notifications",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULTS);
  });

  it("given a user, when PUT /api/me/notifications changes a switch and the hours, then the answer and the next read show them", async () => {
    const ctx = await withProject();

    const put = await send(
      ctx.app,
      ctx.alice.cookie,
      "PUT",
      "/api/me/notifications",
      { question: false, quietStartHour: 23, quietEndHour: 6 },
    );

    const expected = {
      ...DEFAULTS,
      question: false,
      quietStartHour: 23,
      quietEndHour: 6,
    };
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(expected);
    const read = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      "/api/me/notifications",
    );
    expect(await read.json()).toEqual(expected);
  });

  it("given a user, when PUT /api/me/notifications sends an hour of 24, then 400 and nothing changes", async () => {
    const ctx = await withProject();

    const put = await send(
      ctx.app,
      ctx.alice.cookie,
      "PUT",
      "/api/me/notifications",
      { quietStartHour: 24 },
    );

    expect(put.status).toBe(400);
    const read = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      "/api/me/notifications",
    );
    expect(await read.json()).toEqual(DEFAULTS);
  });
});

describe("slice 15.2: the test notification", () => {
  it("given a user with two devices, when POST /api/push/test is called, then one push goes to each device", async () => {
    const ctx = await withProject();
    const push = pushDouble();
    const app = appWith(ctx.db, push.fn);
    await subscribe({ app }, ctx.alice.cookie, 1);
    await subscribe({ app }, ctx.alice.cookie, 2);

    const res = await send(app, ctx.alice.cookie, "POST", "/api/push/test");

    expect(res.status).toBe(204);
    expect(push.calls.map((c) => c.subscription.endpoint).sort()).toEqual([
      device(1).endpoint,
      device(2).endpoint,
    ]);
  });
});
