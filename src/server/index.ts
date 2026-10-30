import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { createApp } from "./app.ts";
import { openDatabase } from "./db/db.ts";
import { instanceSettings, users } from "./db/schema.ts";
import { checkInstanceKey, instanceReader } from "./instance.ts";
import { scheduleRoutines } from "./routines.ts";
import { loadOrCreateKey } from "./secrets.ts";
import { schedulePurge } from "./tokens.ts";
import { scheduleDeliveries } from "./webhooks.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Example: DATABASE_URL=postgres://user:password@localhost:5432/cockpit",
  );
  process.exit(1);
}

// The key of the GitHub secrets lives in its own volume, never in the database (decision 012 F).
const keyFile = process.env.COCKPIT_KEY_FILE ?? "secrets/master.key";
const keyIsNew = !existsSync(keyFile);
const encryptionKey = loadOrCreateKey(keyFile);
if (keyIsNew)
  console.log(
    `Cockpit created its encryption key in ${keyFile}. Keep a copy of it off this machine: a restore needs the database backup AND this key (README).`,
  );

// No 0, O, 1, I, L: the code is read on a screen and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const setupCode = Array.from({ length: 4 }, () =>
  Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    "",
  ),
).join("-");

const port = Number(process.env.PORT ?? 3000);
const version = readFileSync("version.txt", "utf8").trim();

const db = await openDatabase(databaseUrl);
const app = createApp(db, version, { encryptionKey, setupCode });

try {
  await checkInstanceKey(db, encryptionKey, keyFile);
} catch (error) {
  // A key created just now cannot be the one that encrypted a row that already exists.
  if (keyIsNew)
    console.error(`${keyFile} did not exist, so a new key was created.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
// Started once the key is known good, so a failing start deletes nothing.
schedulePurge(db);
scheduleRoutines(db, {
  encryptionKey,
  fireRoutine: (url, init) => fetch(url, init),
});
scheduleDeliveries(db, { readInstance: instanceReader(db, encryptionKey) });
const [settings] = await db
  .select({ id: instanceSettings.id })
  .from(instanceSettings);
const [admin] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.isAdmin, true))
  .limit(1);
// The code is also needed when the App exists but nobody could become administrator.
const needsSetupCode = !settings || !admin;

serve({ fetch: app.fetch, port }, (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`Cockpit v${version} listening on ${url}`);
  if (needsSetupCode)
    console.log(`Cockpit setup code: ${setupCode} — open ${url}/installation`);
});
