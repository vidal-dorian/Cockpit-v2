import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM, stored as `v1:<iv>:<tag>:<data>` (base64 parts); the version leaves room to change the format (decision 012 F). */
export function encrypt(key: Buffer, text: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const [ivText, tagText, dataText] = [iv, cipher.getAuthTag(), data].map(
    (part) => part.toString("base64"),
  );
  return `v1:${ivText}:${tagText}:${dataText}`;
}

/** Throws on a wrong key, a tampered value or a malformed one. */
export function decrypt(key: Buffer, stored: string) {
  const [version, iv, tag, data, ...rest] = stored.split(":");
  if (version !== "v1" || !iv || !tag || data === undefined || rest.length > 0)
    throw new Error("malformed_secret");
  const ivBytes = Buffer.from(iv, "base64");
  const tagBytes = Buffer.from(tag, "base64");
  // GCM accepts tags down to 4 bytes: a truncated tag would weaken the integrity check.
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES)
    throw new Error("malformed_secret");
  const decipher = createDecipheriv("aes-256-gcm", key, ivBytes, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Reads the master key, or creates it (mode 0600) on the first start. */
export function loadOrCreateKey(path: string) {
  if (existsSync(path)) {
    const key = readFileSync(path);
    if (key.length !== KEY_BYTES)
      throw new Error(
        `${path} is not a ${KEY_BYTES}-byte key (${key.length} bytes). Restore your copy of the key; do not delete the file, the stored GitHub secrets could not be read again.`,
      );
    return key;
  }
  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(path), { recursive: true });
  // "wx": never overwrite a key a parallel start just wrote.
  writeFileSync(path, key, { mode: 0o600, flag: "wx" });
  return key;
}
