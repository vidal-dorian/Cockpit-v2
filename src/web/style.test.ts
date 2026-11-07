import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Decision 028 A, E: a dark page, no color outside styles.css (the values of the tokens: Tokens.test.ts, decision 045).

const dir = import.meta.dirname;
const css = readFileSync(join(dir, "styles.css"), "utf8");
const main = readFileSync(join(dir, "main.tsx"), "utf8");

describe("the style (decision 028 A)", () => {
  it("given styles.css, when it is read, then the page is color-scheme: dark", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it("given styles.css and main.tsx, when they are read, then neither Bricolage Grotesque nor Figtree is there", () => {
    expect(css + main).not.toMatch(/figtree|bricolage/i);
  });
});

describe("no hard-coded color (decision 028 A)", () => {
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f) && !/(^|\/)test-[^/]*$/.test(f));

  it("given the components, when src/web is read, then there are some to read", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)(
    "given %s, when it is read, then it holds no #rgb, #rrggbb, rgb( or rgba( color",
    (file) => {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/);
    },
  );
});
