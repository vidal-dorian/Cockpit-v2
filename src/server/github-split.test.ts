import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const read = (f: string) => readFileSync(`${dir}/${f}`, "utf8");
const sources = readdirSync(dir).filter(
  (f) => f.startsWith("github") && f.endsWith(".ts") && !f.endsWith(".test.ts"),
);

// One marker per domain: the REST path only that domain calls.
const DOMAINS = {
  repos: "/contents/",
  pulls: "/pulls",
  issues: "/issues",
  alerts: "secret-scanning",
  workflows: "actions/workflows",
};

describe("github.ts split by domain", () => {
  it("given the GitHub client, when it is split, then repo contents, PRs, issues, alerts and workflows live in separate files", () => {
    const owners = Object.entries(DOMAINS).map(([name, marker]) => ({
      name,
      files: sources.filter(
        (f) =>
          f !== "github.ts" &&
          f !== "github-alerts.ts" &&
          read(f).includes(marker),
      ),
    }));
    for (const o of owners) expect(o.files, o.name).not.toHaveLength(0);
    const first = owners.map((o) => o.files[0]);
    expect(new Set(first).size).toBe(owners.length);
  });

  it("given the GitHub client, when it is split, then githubClient is no longer a function of about 1 350 lines", () => {
    const lines = read("github.ts").split("\n");
    const start = lines.findIndex((l) =>
      l.startsWith("export function githubClient"),
    );
    const end = lines.findIndex((l, i) => i > start && l === "}");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end - start).toBeLessThan(300);
  });

  it("given the split, when callers import github.ts, then githubClient and its types are still exported from it", async () => {
    const mod = await import("./github.ts");
    for (const name of [
      "githubClient",
      "githubReader",
      "checkWriteFiles",
      "ALERT_TOOLS",
    ])
      expect(mod).toHaveProperty(name);
  });
});
