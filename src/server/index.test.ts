import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("server entry point", () => {
  it("given no DATABASE_URL, when it starts, then it exits with an error that names DATABASE_URL", () => {
    const { DATABASE_URL: _removed, ...env } = process.env;

    const result = spawnSync("node", ["src/server/index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      env: { ...env, PORT: "0" },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain("DATABASE_URL");
  }, 15_000);

  it("given only DATABASE_URL and no GitHub setting, when it starts, then it does not ask for any of them (the wizard configures GitHub, decision 012)", () => {
    const keyDir = mkdtempSync(join(tmpdir(), "cockpit-index-"));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(GITHUB_|PUBLIC_URL$|ALLOWED_GITHUB_LOGINS$)/.test(name),
      ),
    );

    const result = spawnSync("node", ["src/server/index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      env: {
        ...env,
        PORT: "0",
        // Unreachable on purpose: it fails on the connection, not on a missing setting.
        DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/none",
        COCKPIT_KEY_FILE: join(keyDir, "master.key"),
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    rmSync(keyDir, { recursive: true });

    expect(result.status).toBeGreaterThan(0);
    for (const name of [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_APP",
      "PUBLIC_URL",
      "ALLOWED_GITHUB_LOGINS",
    ])
      expect(result.stderr).not.toContain(name);
  }, 15_000);
});
