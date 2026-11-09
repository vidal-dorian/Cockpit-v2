import { sql } from "drizzle-orm";
import { createApp } from "./app.ts";
import type { SendPush } from "./push.ts";
import { send } from "./test-decisions.ts";
import { TEST_KEY, testAppOptions } from "./test-instance.ts";
import type { TestDb } from "./test-mcp.ts";

// Shared by the tests of slice 15.2 (decision 072). Names pinned where the decision leaves room:
// - the sender is an injected dependency `sendPush(subscription, payload)`: `AppOptions.sendPush` (the route of the test
//   notification) and the `deps` of `runDueRoutines` (the pass of the minute); it resolves, or throws an error carrying
//   `statusCode` like the WebPushError of `web-push` (404 or 410: the subscription is deleted);
// - subscription = { endpoint, keys: { p256dh, auth } }; payload = { title, body, url, actions?: { action, title }[] }
//   (url relative to Cockpit: "/runs/12", "/");
// - GET /api/push/key -> 200 { publicKey }; POST /api/push/subscriptions { endpoint, keys } -> 204 (same endpoint: one row);
//   DELETE /api/push/subscriptions { endpoint } -> 204; POST /api/push/test -> 204 (one push to each device of the user);
// - GET and PUT /api/me/notifications -> 200 { question, runFailed, prReady, nightRecap, quietStartHour, quietEndHour }
//   (PUT takes any of those fields, answers the whole object; hours are integers 0 to 23, else 400);
// - tables `push_subscriptions(user_id, endpoint, ...)` and `notifications` (the outbox, empty once the pass has run).

export type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type Payload = {
  title: string;
  body: string;
  url: string;
  actions?: { action: string; title: string }[];
};

export const device = (n: number): Subscription => ({
  endpoint: `https://push.example.com/send/device-${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

/** The double of the push service: records every call; `fail` makes it throw. */
export function pushDouble() {
  const calls: { subscription: Subscription; payload: Payload }[] = [];
  const state: { fail: Error | null } = { fail: null };
  const fn = async (subscription: Subscription, payload: Payload) => {
    calls.push({ subscription, payload });
    if (state.fail) throw state.fail;
  };
  return { fn, calls, state };
}

export const pushError = (statusCode: number) =>
  Object.assign(new Error(`push service answered ${statusCode}`), {
    statusCode,
  });

export const subscribe = (
  ctx: { app: Parameters<typeof send>[0] },
  cookie: string,
  n = 1,
) => send(ctx.app, cookie, "POST", "/api/push/subscriptions", device(n));

/** One pass of the minute at `at`, with the double as the sender. */
export async function pass(db: TestDb, at: Date, sendPush: SendPush) {
  const { runDueRoutines } = await import("./routines.ts");
  const deps = {
    encryptionKey: TEST_KEY,
    fireRoutine: async () => new Response("{}"),
    sendPush,
  };
  return runDueRoutines(db, deps, at);
}

/** The app of the context, rebuilt over the same database with the sender of the test. */
export function appWith(db: TestDb, sendPush: SendPush) {
  const options = { ...testAppOptions, sendPush };
  return createApp(db, "1.2.3", options);
}

export const outbox = async (db: TestDb) =>
  (
    (await db.execute(
      sql`select count(*)::int as n from notifications`,
    )) as unknown as {
      rows: { n: number }[];
    }
  ).rows[0]?.n;

export const deviceRows = async (db: TestDb) =>
  (
    (await db.execute(
      sql`select user_id, endpoint from push_subscriptions order by id`,
    )) as unknown as { rows: { user_id: number; endpoint: string }[] }
  ).rows;
