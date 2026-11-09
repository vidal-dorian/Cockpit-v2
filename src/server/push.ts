import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { generateVAPIDKeys, sendNotification } from "web-push";
import { z } from "zod";
import type { Tx } from "./action.ts";
import type { Db } from "./db/db.ts";
import {
  instanceSettings,
  notifications,
  projectMembers,
  pushSubscriptions,
  users,
} from "./db/schema.ts";
import { type Fire, hour, signedIn } from "./routines.ts";
import { decrypt, encrypt } from "./secrets.ts";
import { body } from "./tickets.ts";

export type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type Payload = {
  title: string;
  body: string;
  /** Relative to Cockpit. */
  url: string;
  actions?: { action: string; title: string }[];
};
/** Resolves, or throws an error with the `statusCode` of the push service, like the WebPushError of `web-push`. */
export type SendPush = (
  subscription: Subscription,
  payload: Payload,
) => Promise<void>;

type Message = Payload & { type: (typeof notifications.$inferSelect)["type"] };

const MAX_DEVICES = 10;

/** Whether the host is a name or an address of the machine's own network: the server posts to the endpoint, so it must not reach those. A literal check, no DNS (shortcut: a public name that resolves to a private address passes; upgrade with a resolved-address check). */
const isLocalHost = (name: string) => {
  // Trailing dots name the same host.
  const host = name.replace(/\.+$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(
      host,
    ) ||
    /^\[(::|f[cd]|fe[89ab])/i.test(host)
  );
};

const REVIEW_EVERY_MS = 3_600_000;
// A push carries 4 KB at most; a question can be much longer.
const clip = (text: string) => text.slice(0, 200);

/** Writes one outbox row (decision 072 B) for each member of the project, inside the transaction of the event. */
export async function notify(tx: Tx, projectId: number, message: Message) {
  const members = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  if (members.length === 0) return;
  await tx.insert(notifications).values(
    members.map(({ userId }) => ({
      ...message,
      userId,
      title: clip(message.title),
      body: clip(message.body),
    })),
  );
}

/** The VAPID keys (decision 072 F), generated at the first need; the private key never leaves the server. */
async function vapidKeys(db: Db, key: Buffer) {
  const read = () =>
    db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1))
      .then(([row]) => row);
  let row = await read();
  if (!row) throw new Error("The GitHub App is not configured");
  if (!row.vapidPublicKey) {
    const fresh = generateVAPIDKeys();
    // Only the first of two racing requests writes; both then read the winner's keys.
    await db
      .update(instanceSettings)
      .set({
        vapidPublicKey: fresh.publicKey,
        vapidPrivateKey: encrypt(key, fresh.privateKey),
      })
      .where(
        and(
          eq(instanceSettings.id, 1),
          isNull(instanceSettings.vapidPublicKey),
        ),
      );
    row = await read();
  }
  if (!row?.vapidPublicKey || !row.vapidPrivateKey)
    throw new Error("VAPID keys missing");
  return {
    publicKey: row.vapidPublicKey,
    privateKey: decrypt(key, row.vapidPrivateKey),
    // web-push refuses a subject that is not https or mailto, so a loopback install gets a placeholder.
    subject: row.publicUrl.startsWith("https:")
      ? row.publicUrl
      : "mailto:cockpit@localhost",
  };
}

/** The real sender; the tests give their own. */
export const webPushSender = (db: Db, key: Buffer): SendPush => {
  // Read and decrypted once per sender; a failure is not kept.
  let cached: ReturnType<typeof vapidKeys> | undefined;
  const keys = () =>
    (cached ??= vapidKeys(db, key).catch((error) => {
      cached = undefined;
      throw error;
    }));
  return async (subscription, payload) => {
    const { publicKey, privateKey, subject } = await keys();
    await sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject, publicKey, privateKey },
      timeout: 10_000,
    });
  };
};

/** Sends to every device of the user; a service that forgot a device (404, 410) loses its subscription, any other failure drops the push for that device (decision 072 F). */
async function deliver(
  db: Db,
  send: SendPush,
  userId: number,
  payloads: Payload[],
) {
  const devices = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(asc(pushSubscriptions.id));
  for (const device of devices)
    for (const payload of payloads)
      try {
        await send(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          payload,
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, device.id));
          break;
        }
        console.error(`Push to device ${device.id} failed:`, error);
      }
  return devices.length;
}

/** Whether `at` falls in the quiet hours of the user, in their time zone; the same two hours mean no silence. */
function isQuiet(
  at: Date,
  user: { quietStartHour: number; quietEndHour: number; nightTimeZone: string },
) {
  const { quietStartHour: start, quietEndHour: end } = user;
  const local = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: user.nightTimeZone,
      hourCycle: "h23",
      hour: "numeric",
    }).format(at),
  );
  if (start === end) return false;
  return start < end
    ? local >= start && local < end
    : local >= start || local < end;
}

/** The pass of the minute (decision 072 E): empties the outbox, sending what the switches, the quiet hours and the hour between two review pushes allow. Never throws. */
export async function sendDue(db: Db, deps: Fire, now: Date) {
  try {
    const rows = await db
      .select()
      .from(notifications)
      .orderBy(asc(notifications.id));
    const send = deps.sendPush ?? webPushSender(db, deps.encryptionKey);
    for (const userId of new Set(rows.map((r) => r.userId))) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const mine = rows.filter((r) => r.userId === userId);
      const quiet = user ? isQuiet(now, user) : true;
      const on = {
        question: user?.notifyQuestion,
        run_failed: user?.notifyRunFailed,
        pr_ready: user?.notifyPrReady,
        night_recap: user?.notifyNightRecap,
      };
      // The quiet hours silence everything but the recap; what is dropped is not kept, the home shows it anyway.
      const wanted = mine.filter(
        (r) => on[r.type] && (!quiet || r.type === "night_recap"),
      );
      const wantedReviews = wanted.filter((r) => r.type === "pr_ready");
      const reviewDue =
        wantedReviews.length > 0 &&
        (!user?.lastReviewPushAt ||
          now.getTime() - user.lastReviewPushAt.getTime() >= REVIEW_EVERY_MS);
      const held = reviewDue ? [] : wantedReviews;
      // Deleted before the send: a push that fails is not retried (F). Only the rows this pass really deleted are sent, so two overlapping passes never send a row twice.
      const claimed = new Set(
        (
          await db
            .delete(notifications)
            .where(
              inArray(
                notifications.id,
                mine.filter((r) => !held.includes(r)).map((r) => r.id),
              ),
            )
            .returning({ id: notifications.id })
        ).map((r) => r.id),
      );
      const reviews = wantedReviews.filter((r) => claimed.has(r.id));
      const payloads: Payload[] = wanted
        .filter((r) => r.type !== "pr_ready" && claimed.has(r.id))
        .map(({ title, body, url, actions }) => ({
          title,
          body,
          url,
          ...(actions && { actions }),
        }));
      const [first] = reviews;
      if (reviewDue && first)
        payloads.push(
          reviews.length === 1
            ? { title: first.title, body: first.body, url: first.url }
            : {
                title: `${reviews.length} PR prêtes à relire`,
                body: "Elles t'attendent sur l'accueil.",
                url: "/",
              },
        );
      if (payloads.length === 0) continue;
      const devices = await deliver(db, send, userId, payloads);
      if (reviewDue && reviews.length > 0 && devices > 0)
        await db
          .update(users)
          .set({ lastReviewPushAt: now })
          .where(eq(users.id, userId));
    }
  } catch (error) {
    console.error("Push pass failed:", error);
  }
}

/** The key, the devices, the test push and the switches of the user (decision 072 D, F). */
export function pushRoutes(db: Db, encryptionKey: Buffer, send: SendPush) {
  const signed = signedIn(db);
  const subscription = z.object({
    // https only: the server posts the push to this address.
    endpoint: z
      .url({ protocol: /^https$/ })
      .max(2_000)
      // refine still runs after a failed `url()`: parse safely.
      .refine(
        (url) => URL.canParse(url) && !isLocalHost(new URL(url).hostname),
      ),
    keys: z.object({
      p256dh: z.string().min(1).max(200),
      auth: z.string().min(1).max(100),
    }),
  });
  const switches = z.object({
    question: z.boolean(),
    runFailed: z.boolean(),
    prReady: z.boolean(),
    nightRecap: z.boolean(),
    quietStartHour: hour,
    quietEndHour: hour,
  });
  const read = (userId: number) =>
    db
      .select({
        question: users.notifyQuestion,
        runFailed: users.notifyRunFailed,
        prReady: users.notifyPrReady,
        nightRecap: users.notifyNightRecap,
        quietStartHour: users.quietStartHour,
        quietEndHour: users.quietEndHour,
      })
      .from(users)
      .where(eq(users.id, userId))
      .then(([row]) => row);

  return new Hono<{ Variables: { userId: number } }>()
    .use("/api/push/*", signed)
    .use("/api/me/notifications", signed)
    .get("/api/push/key", async (c) =>
      c.json({ publicKey: (await vapidKeys(db, encryptionKey)).publicKey }),
    )
    .post("/api/push/subscriptions", body(subscription), async (c) => {
      const { endpoint, keys } = c.req.valid("json");
      const userId = c.get("userId");
      const mine = await db
        .select({ endpoint: pushSubscriptions.endpoint })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
      if (
        mine.length >= MAX_DEVICES &&
        !mine.some((d) => d.endpoint === endpoint)
      )
        return c.json({ error: "too_many_devices" }, 409);
      const device = {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
      };
      await db
        .insert(pushSubscriptions)
        .values({ endpoint, ...device })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: device,
        });
      return c.body(null, 204);
    })
    .delete(
      "/api/push/subscriptions",
      body(z.object({ endpoint: z.string().max(2_000) })),
      async (c) => {
        await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.userId, c.get("userId")),
              eq(pushSubscriptions.endpoint, c.req.valid("json").endpoint),
            ),
          );
        return c.body(null, 204);
      },
    )
    .post("/api/push/test", async (c) => {
      const devices = await deliver(db, send, c.get("userId"), [
        {
          title: "Cockpit",
          body: "Les notifications arrivent sur cet appareil.",
          url: "/",
        },
      ]);
      return devices === 0
        ? c.json({ error: "no_device" }, 409)
        : c.body(null, 204);
    })
    .get("/api/me/notifications", async (c) =>
      c.json(await read(c.get("userId"))),
    )
    .put("/api/me/notifications", body(switches.partial()), async (c) => {
      const userId = c.get("userId");
      const v = c.req.valid("json");
      const set = {
        notifyQuestion: v.question,
        notifyRunFailed: v.runFailed,
        notifyPrReady: v.prReady,
        notifyNightRecap: v.nightRecap,
        quietStartHour: v.quietStartHour,
        quietEndHour: v.quietEndHour,
      };
      // An empty body changes nothing, and drizzle refuses an empty SET.
      if (Object.values(set).some((value) => value !== undefined))
        await db.update(users).set(set).where(eq(users.id, userId));
      return c.json(await read(userId));
    });
}
