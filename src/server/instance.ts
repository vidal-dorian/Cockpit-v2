import { eq } from "drizzle-orm";
import type { Db } from "./db/db.ts";
import { instanceSettings } from "./db/schema.ts";
import { decrypt } from "./secrets.ts";

/** Where GitHub delivers its webhooks (decision 024 A); the App's webhook address is the public address followed by it. */
export const WEBHOOK_PATH = "/api/webhooks/github";

/** What the start-up wizard stored, secrets decrypted (decision 012). */
export type InstanceSettings = {
  publicUrl: string;
  githubAppId: string;
  githubAppSlug: string;
  githubClientId: string;
  githubClientSecret: string;
  githubPrivateKey: string;
  githubWebhookSecret: string;
};

/** Reads the settings on demand: null until the wizard has run. The first successful read is kept until `forget()` (the public address is fixed at installation, decision 028 I). */
export function instanceReader(db: Db, encryptionKey: Buffer) {
  let cached: InstanceSettings | null = null;
  const read = async () => {
    if (cached) return cached;
    const [row] = await db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1));
    if (!row) return null;
    cached = {
      publicUrl: row.publicUrl,
      githubAppId: row.githubAppId,
      githubAppSlug: row.githubAppSlug,
      githubClientId: row.githubClientId,
      githubClientSecret: decrypt(encryptionKey, row.githubClientSecret),
      githubPrivateKey: decrypt(encryptionKey, row.githubPrivateKey),
      githubWebhookSecret: decrypt(encryptionKey, row.githubWebhookSecret),
    };
    return cached;
  };
  return Object.assign(read, {
    forget: () => {
      cached = null;
    },
  });
}

export type ReadInstance = ReturnType<typeof instanceReader>;

/** At start-up: the stored secrets must be readable with the key, or every GitHub route would fail later with a bare 500. Throws a message to print. */
export async function checkInstanceKey(
  db: Db,
  key: Buffer,
  keyFile = "secrets/master.key",
) {
  const [row] = await db.select().from(instanceSettings).limit(1);
  if (!row) return;
  try {
    decrypt(key, row.githubClientSecret);
  } catch {
    throw new Error(
      [
        `The GitHub App stored in instance_settings cannot be decrypted with ${keyFile} (the key was lost, recreated or replaced).`,
        `Either restore your saved copy of master.key at ${keyFile}, then restart;`,
        "or forget the stored App and run the wizard again to create a new one (every user must then reinstall it):",
        "  docker compose --env-file /etc/cockpit/cockpit.env exec db psql -U postgres -d cockpit -c 'DELETE FROM instance_settings;'",
      ].join("\n"),
    );
  }
}
