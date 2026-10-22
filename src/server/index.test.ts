import { spawnSync } from "node:child_process";
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
});
