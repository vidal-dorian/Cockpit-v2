import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { send } from "./test-decisions.ts";
import { inReview, ready, refreshCi, setStory } from "./test-launcher.ts";
import {
  appWith,
  deviceRows,
  outbox,
  pass,
  pushDouble,
  subscribe,
} from "./test-push.ts";
import { asked, running } from "./test-questions.ts";

// Slice 15.2 (decision 072 C, E, F): the paths the acceptance tests leave out.
const at = (iso: string) => new Date(iso);

/** A running run with a device and a question in the outbox. */
async function withQuestion(zone = "UTC") {
  const s = await running();
  const push = pushDouble();
  await subscribe(s, s.alice.cookie);
  await s.db.execute(sql`update users set night_time_zone = ${zone}`);
  await asked(s);
  return { ...s, push };
}

describe("slice 15.2: the pass", () => {
  it("given a story whose CI fails after the third relaunch, when the pass is not needed, then a run_failed row points to the story", async () => {
    const ctx = await ready();
    const pr = await inReview(ctx);
    await setStory(ctx, "relaunch_count = 3, pr_ci_state = 'success'");

    await refreshCi(ctx, pr, [["build", "failure"]]);

    const rows = (
      (await ctx.db.execute(
        sql`select type, url from notifications`,
      )) as unknown as { rows: { type: string; url: string }[] }
    ).rows;
    expect(rows.some((r) => r.type === "run_failed")).toBe(true);
    expect(rows.find((r) => r.type === "run_failed")?.url).toMatch(
      /^\/us\/\d+$/,
    );
  });

  it("given a sender that fails with another error, when the pass runs, then the outbox is empty and the device is kept", async () => {
    const s = await withQuestion();
    s.push.state.fail = new Error("boom");

    await pass(s.db, at("2026-11-09T12:00:00Z"), s.push.fn);

    expect(s.push.calls).toHaveLength(1);
    expect(await outbox(s.db)).toBe(0);
    expect(await deviceRows(s.db)).toHaveLength(1);
  });

  it.each([
    ["21:30Z, 22:30 in Paris", "2026-11-09T21:30:00Z", 0],
    ["06:30Z, 7:30 in Paris", "2026-11-09T06:30:00Z", 1],
  ])(
    "given Europe/Paris and quiet hours 22 to 7, when the pass runs at %s, then %i push",
    async (_, time, sent) => {
      const s = await withQuestion("Europe/Paris");

      await pass(s.db, at(time), s.push.fn);

      expect(s.push.calls).toHaveLength(sent);
      expect(await outbox(s.db)).toBe(0);
    },
  );

  it("given the same start and end hour, when the pass runs at night, then the push goes", async () => {
    const s = await withQuestion();
    await send(s.app, s.alice.cookie, "PUT", "/api/me/notifications", {
      quietStartHour: 5,
      quietEndHour: 5,
    });

    await pass(s.db, at("2026-11-09T23:00:00Z"), s.push.fn);

    expect(s.push.calls).toHaveLength(1);
  });

  it("given a user without a device, when the pass runs, then her rows are deleted", async () => {
    const s = await running();
    const push = pushDouble();
    await asked(s);

    await pass(s.db, at("2026-11-09T12:00:00Z"), push.fn);

    expect(push.calls).toHaveLength(0);
    expect(await outbox(s.db)).toBe(0);
  });

  it("given two passes at once and a slow sender, when both run, then the row is sent once", async () => {
    const s = await withQuestion();
    const slow = async (...args: Parameters<typeof s.push.fn>) => {
      await new Promise((r) => setTimeout(r, 50));
      return s.push.fn(...args);
    };
    const now = at("2026-11-09T12:00:00Z");

    await Promise.all([pass(s.db, now, slow), pass(s.db, now, slow)]);

    expect(s.push.calls).toHaveLength(1);
  });
});

describe("slice 15.2: the review push", () => {
  it("given a PR row and two passes at once, when both run, then one push goes and the hour starts", async () => {
    const s = await running();
    const push = pushDouble();
    await subscribe(s, s.alice.cookie);
    await s.db.execute(
      sql`insert into notifications (user_id, type, title, body, url) values (${s.alice.id}, 'pr_ready', 'PR prête à relire', 'x', '/')`,
    );
    const slow = async (...args: Parameters<typeof push.fn>) => {
      await new Promise((r) => setTimeout(r, 50));
      return push.fn(...args);
    };
    const now = at("2026-11-09T12:00:00Z");

    await Promise.all([pass(s.db, now, slow), pass(s.db, now, slow)]);

    expect(push.calls).toHaveLength(1);
    const { rows } = (await s.db.execute(
      sql`select last_review_push_at as at from users where id = ${s.alice.id}`,
    )) as unknown as { rows: { at: Date | null }[] };
    expect(rows[0]?.at).not.toBeNull();
  });
});

describe("slice 15.2: the devices", () => {
  it.each([
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://192.168.1.2/x",
    "https://172.20.0.1/x",
    "https://169.254.169.254/latest",
    "https://[::1]/x",
    "https://localhost./x",
    "https://foo.localhost./x",
    "https://localhost../x",
    "https://100.64.0.1/x",
    "not a url",
    "https://",
    "",
  ])(
    "given the endpoint %s, when the device is subscribed, then 400",
    async (endpoint) => {
      const s = await running();

      const res = await send(
        s.app,
        s.alice.cookie,
        "POST",
        "/api/push/subscriptions",
        { endpoint, keys: { p256dh: "a", auth: "b" } },
      );

      expect(res.status).toBe(400);
      expect(await deviceRows(s.db)).toEqual([]);
    },
  );

  it("given ten devices, when an eleventh is subscribed, then 409, and an already known one still updates", async () => {
    const s = await running();
    for (let n = 1; n <= 10; n++) await subscribe(s, s.alice.cookie, n);

    const eleventh = await subscribe(s, s.alice.cookie, 11);
    const known = await subscribe(s, s.alice.cookie, 3);

    expect(eleventh.status).toBe(409);
    expect(known.status).toBe(204);
    expect(await deviceRows(s.db)).toHaveLength(10);
  });

  it("given no device, when the test notification is asked, then 409 no_device", async () => {
    const s = await running();
    const app = appWith(s.db, pushDouble().fn);

    const res = await send(app, s.alice.cookie, "POST", "/api/push/test");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_device" });
  });
});
