import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const docs = new URL("../../docs/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, docs), "utf8");
const decisionNumbers = readdirSync(new URL("decisions/", docs)).map((f) =>
  f.slice(0, 3),
);

describe("docs/architecture.md (story: an architecture read in ten minutes)", () => {
  it("given docs/architecture.md, when read, then it holds in about 2 pages (under 1500 words)", () => {
    const words = read("architecture.md").split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThan(1500);
  });

  it("given docs/architecture.md, when read, then no « Fait (…) » progress line is left: they moved to decoupage.md", () => {
    expect(read("architecture.md")).not.toMatch(/\bFait\b/);
    expect(read("decoupage.md")).toMatch(/\bFait\b/);
  });

  it("given docs/architecture.md, when read, then it covers modules, data path and deployment", () => {
    const text = read("architecture.md").toLowerCase();
    expect(text).toMatch(/module/);
    expect(text).toMatch(/trajet|parcours/);
    expect(text).toMatch(/déploiement/);
  });
});

describe("docs/regles.md", () => {
  it("given a new page docs/regles.md, when read, then it exists with one rule per line", () => {
    expect(existsSync(new URL("regles.md", docs))).toBe(true);
    const rules = read("regles.md")
      .split("\n")
      .filter(
        (l) => /^\s*(-|\*|\|)/.test(l) && !/^\s*\|[\s|:-]+\|?\s*$/.test(l),
      );
    expect(rules.length).toBeGreaterThan(10);
  });

  it("given docs/regles.md, when read, then every rule line cites a decision that exists", () => {
    const rules = read("regles.md")
      .split("\n")
      .filter((l) => /^\s*(-|\*)/.test(l));
    expect(rules.length).toBeGreaterThan(10);
    for (const line of rules) {
      const cited = [
        ...line.matchAll(/decisions\/(\d{3})-|décisions? (\d{3})/gi),
      ].map((m) => m[1] ?? m[2]);
      expect(cited.length, line).toBeGreaterThan(0);
      for (const n of cited) expect(decisionNumbers, line).toContain(n);
    }
  });
});
