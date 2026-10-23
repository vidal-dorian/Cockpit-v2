import { createHash } from "node:crypto";
import type { Db } from "./db/db.ts";
import { instanceSettings, sessions, users } from "./db/schema.ts";
import { encrypt } from "./secrets.ts";
import { githubAppConfig } from "./test-github.ts";

/** A fixed 32-byte key, so a test can decrypt what the server stored. */
export const TEST_KEY = Buffer.alloc(32, 7);

/** The `options` argument of `createApp` for tests (decision 012). */
export const testAppOptions = {
  encryptionKey: TEST_KEY,
  // The canonical form: uppercase, four groups of four, dashes.
  setupCode: "ABCD-EFGH-JKMN-PQRS",
};

export type InstanceOverrides = {
  publicUrl?: string;
  githubAppId?: string;
  githubAppSlug?: string;
  githubClientId?: string;
  /** Clear text: the helper encrypts the three secrets, as the server does. */
  githubClientSecret?: string;
  githubPrivateKey?: string;
  githubWebhookSecret?: string;
  adminClaimHash?: string | null;
};

/** Stores a configured `instance_settings` row (what the wizard leaves behind), secrets encrypted with `key`. */
export async function configureTestInstance(
  db: Db,
  key: Buffer,
  overrides: InstanceOverrides = {},
) {
  await db.insert(instanceSettings).values({
    id: 1,
    publicUrl: overrides.publicUrl ?? "https://cockpit.example.com",
    githubAppId: overrides.githubAppId ?? githubAppConfig.githubAppId,
    githubAppSlug: overrides.githubAppSlug ?? githubAppConfig.githubAppSlug,
    githubClientId: overrides.githubClientId ?? "Iv1.client",
    githubClientSecret: encrypt(key, overrides.githubClientSecret ?? "secret"),
    githubPrivateKey: encrypt(
      key,
      overrides.githubPrivateKey ?? githubAppConfig.githubAppPrivateKey,
    ),
    githubWebhookSecret: encrypt(
      key,
      overrides.githubWebhookSecret ?? "webhook-secret",
    ),
    adminClaimHash: overrides.adminClaimHash ?? null,
  });
}

/** An administrator with a live session (login admin<githubId>); returns the user id and the Cookie header. */
export async function createAdminWithSession(db: Db, githubId = 1) {
  const [user] = await db
    .insert(users)
    .values({ githubId, login: `admin${githubId}`, isAdmin: true })
    .returning({ id: users.id });
  if (!user) throw new Error("admin insert returned no row");
  const value = `admin-cookie-of-${githubId}`;
  await db.insert(sessions).values({
    id: createHash("sha256").update(value).digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { id: user.id, githubId, cookie: `cockpit_session=${value}` };
}
