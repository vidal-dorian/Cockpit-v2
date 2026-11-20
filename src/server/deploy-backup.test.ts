import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A copy of deploy.sh in a scratch checkout, with a fake backup.sh and a fake docker, both logging to one file.
function runDeploy(backupExit: number) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-"));
  dirs.push(dir);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "bin"));
  copyFileSync(join(root, "scripts/deploy.sh"), join(dir, "scripts/deploy.sh"));
  writeFileSync(join(dir, "version.txt"), "1.2.3\n");
  writeFileSync(join(dir, "env"), "TUNNEL_TOKEN=abc\nPOSTGRES_PASSWORD=pw\n");
  const log = join(dir, "calls.log");
  writeFileSync(
    join(dir, "scripts/backup.sh"),
    `#!/usr/bin/env bash\necho "backup" >> "${log}"\nexit ${backupExit}\n`,
  );
  writeFileSync(
    join(dir, "bin/docker"),
    `#!/usr/bin/env bash\necho "docker $*" >> "${log}"\nexit 0\n`,
  );
  for (const f of ["scripts/backup.sh", "bin/docker"])
    chmodSync(join(dir, f), 0o755);
  const result = spawnSync("bash", [join(dir, "scripts/deploy.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      COCKPIT_ENV_FILE: join(dir, "env"),
    },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n");
  } catch {}
  return { ...result, calls };
}

describe("scripts/deploy.sh", () => {
  it("given deploy.sh, when it runs, then it executes backup.sh before docker compose up", () => {
    const { calls } = runDeploy(0);
    const backup = calls.indexOf("backup");
    const up = calls.findIndex((c) => / up /.test(c));
    expect(backup).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(backup);
  });

  it("given backup.sh fails during a deploy, when deploy.sh continues, then it stops without deploying and says why", () => {
    const { status, stderr, calls } = runDeploy(1);
    expect(calls).toContain("backup");
    expect(calls.some((c) => / up /.test(c))).toBe(false);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/backup/i);
  });
});

describe("compose.yaml logging", () => {
  const compose = readFileSync(join(root, "compose.yaml"), "utf8");
  const block = (name: string) =>
    compose
      .split(new RegExp(`^ {2}${name}:\\n`, "m"))[1]
      ?.split(/^ {2}\S.*:\n|^\S/m)[0] ?? "";

  for (const service of ["app", "db"]) {
    it(`given compose.yaml, when reading service ${service}, then it has logging.options max-size and max-file`, () => {
      const b = block(service);
      expect(b).toMatch(
        /^ {4}logging:\n(?: {6,}.*\n)*? {6}options:\n(?: {8}.*\n)*?/m,
      );
      expect(b).toMatch(/^ {8}max-size: .+$/m);
      expect(b).toMatch(/^ {8}max-file: .+$/m);
    });
  }
});
