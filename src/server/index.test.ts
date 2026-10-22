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

  it("given GITHUB_CLIENT_ID is missing, when it starts, then it exits with an error that names GITHUB_CLIENT_ID before connecting to the database", () => {
    const { GITHUB_CLIENT_ID: _removed, ...env } = process.env;

    const result = spawnSync("node", ["src/server/index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      env: {
        ...env,
        PORT: "0",
        // Unreachable on purpose: the check must fail before any connection.
        DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/none",
        GITHUB_CLIENT_SECRET: "secret",
        PUBLIC_URL: "http://localhost:3000",
        ALLOWED_GITHUB_LOGINS: "octocat",
      },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain("GITHUB_CLIENT_ID");
  }, 15_000);

  it("given PUBLIC_URL is not a URL, when it starts, then it exits with an error that names PUBLIC_URL before connecting to the database", () => {
    const result = spawnSync("node", ["src/server/index.ts"], {
      cwd: join(import.meta.dirname, "../.."),
      env: {
        ...process.env,
        PORT: "0",
        // Unreachable on purpose: the check must fail before any connection.
        DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/none",
        GITHUB_CLIENT_ID: "client-id",
        GITHUB_CLIENT_SECRET: "secret",
        PUBLIC_URL: "nope",
        ALLOWED_GITHUB_LOGINS: "octocat",
      },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain("PUBLIC_URL");
  }, 15_000);
});
