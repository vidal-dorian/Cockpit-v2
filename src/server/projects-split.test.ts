import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const sources = readdirSync(dir)
  .filter(
    (f) => f.endsWith(".ts") && !f.includes(".test.") && !f.startsWith("test-"),
  )
  .map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
const fileOf = (path: string) =>
  sources.filter((s) => s.text.includes(`"${path}"`)).map((s) => s.f);

describe("projects.ts is split by domain (story 63)", () => {
  it("given projectRoutes, when split, then prepare/catalog, workflows, plugins and health live in separate files outside projects.ts", () => {
    const domains = [
      "/api/projects/:id/prepare",
      "/api/projects/:id/catalog/plan",
      "/api/projects/:id/workflows",
      "/api/projects/:id/plugins/apply",
      "/api/projects/:id/health",
    ];
    const files = domains.map((d) => fileOf(d));
    for (const owners of files) {
      expect(owners.length).toBeGreaterThan(0);
      expect(owners).not.toContain("projects.ts");
    }
    // Four domains: prepare+catalog may share a file, the others are apart.
    expect(new Set(files.map((o) => o[0])).size).toBeGreaterThanOrEqual(4);
  });

  it("given the split, when app.ts builds the app, then it mounts every new route file", () => {
    const app = sources.find((s) => s.f === "app.ts")?.text ?? "";
    const split = new Set(
      [
        "/api/projects/:id/prepare",
        "/api/projects/:id/workflows",
        "/api/projects/:id/plugins/apply",
        "/api/projects/:id/health",
      ].flatMap(fileOf),
    );
    expect(split.size).toBeGreaterThanOrEqual(3);
    for (const f of split) {
      expect(app).toContain(`./${f}`);
    }
  });
});
