import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, loadOrCreateKey } from "./secrets.ts";

const key = Buffer.alloc(32, 1);
const otherKey = Buffer.alloc(32, 2);

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "cockpit-secrets-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("encrypt and decrypt", () => {
  it("given a text and a key, when it is encrypted then decrypted, then the text comes back and the stored value is v1:<iv>:<tag>:<data> without the text", () => {
    const text =
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n";

    const stored = encrypt(key, text);

    expect(stored).toMatch(
      /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(stored).not.toContain("BEGIN PRIVATE KEY");
    expect(decrypt(key, stored)).toBe(text);
  });

  it("given the same text encrypted twice, when the two values are compared, then they differ and both decrypt to the text", () => {
    const first = encrypt(key, "same");
    const second = encrypt(key, "same");

    expect(first).not.toBe(second);
    expect(decrypt(key, first)).toBe("same");
    expect(decrypt(key, second)).toBe("same");
  });

  it("given a value encrypted with one key, when it is decrypted with another key, then it throws", () => {
    const stored = encrypt(key, "secret");

    expect(() => decrypt(otherKey, stored)).toThrow();
  });

  it("given a stored value that was tampered with, when it is decrypted, then it throws", () => {
    const [version, iv, tag, data] = encrypt(key, "secret").split(":");
    const flipped = Buffer.from(data ?? "", "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 1;

    expect(() =>
      decrypt(key, [version, iv, tag, flipped.toString("base64")].join(":")),
    ).toThrow();
    expect(() => decrypt(key, "not-a-stored-value")).toThrow();
  });

  it("given a stored value whose tag was truncated to 4 bytes, when it is decrypted, then it throws instead of checking only those 4 bytes", () => {
    const [version, iv, tag, data] = encrypt(key, "secret").split(":");
    const short = Buffer.from(tag ?? "", "base64")
      .subarray(0, 4)
      .toString("base64");

    expect(() => decrypt(key, [version, iv, short, data].join(":"))).toThrow(
      "malformed_secret",
    );
  });
});

describe("loadOrCreateKey", () => {
  it("given no key file, when the key is loaded, then a 32-byte file with mode 0600 is created, parent directories included", () => {
    const path = join(tempDir(), "nested", "secrets", "master.key");

    const created = loadOrCreateKey(path);

    expect(created).toHaveLength(32);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path)).toHaveLength(32);
    // Windows has no POSIX modes; the Pi (Linux) is where 0600 matters.
    if (process.platform !== "win32")
      expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("given a key file created by a first call, when the key is loaded again, then the same key comes back", () => {
    const path = join(tempDir(), "master.key");
    const first = loadOrCreateKey(path);

    const second = loadOrCreateKey(path);

    expect(second.equals(first)).toBe(true);
  });

  it.each([
    ["empty", 0],
    ["too short", 16],
    ["too long", 64],
  ])(
    "given a key file that is %s (not 32 bytes), when the key is loaded, then it throws and leaves the file untouched",
    (_name, size) => {
      const path = join(tempDir(), "master.key");
      writeFileSync(path, Buffer.alloc(size, 9));

      expect(() => loadOrCreateKey(path)).toThrow();
      expect(readFileSync(path)).toHaveLength(size);
    },
  );
});
