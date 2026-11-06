import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Decision 028 A, B, E: « Crème sombre » by the tokens of styles.css, Geist fonts, no color outside styles.css.

const dir = import.meta.dirname;
const css = readFileSync(join(dir, "styles.css"), "utf8");
const main = readFileSync(join(dir, "main.tsx"), "utf8");

/** The value a token of styles.css is given, in lower case, or undefined. */
function token(name: string) {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  return match?.[1]?.trim().toLowerCase();
}

const TOKENS: Record<string, string> = {
  "color-background": "#1c1917",
  "color-card": "#262220",
  "color-border": "#3a3430",
  "color-foreground": "#f6eee6",
  "color-muted-foreground": "#a99e94",
  "color-primary": "#ff8a57",
  "color-primary-foreground": "#1c1917",
  "color-you-soft": "#3d2a20",
  "color-you-text": "#ffab85",
  "color-claude": "#e9dfd5",
  "color-claude-soft": "#36302c",
  "color-claude-text": "#f6eee6",
  "color-done": "#7a716a",
  "color-done-soft": "#2f2a27",
  "color-done-text": "#c9bfb4",
  "color-destructive": "#f0905f",
  "color-destructive-soft": "#3a2219",
};

describe("the style (decision 028 A, B)", () => {
  it.each(Object.entries(TOKENS))(
    "given styles.css, when it is read, then the token --%s is %s",
    (name, value) => {
      expect(token(name)).toBe(value);
    },
  );

  it("given styles.css, when it is read, then the page is color-scheme: dark", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it("given styles.css, when it is read, then the fonts are Geist for the text and the titles and Geist Mono for the code", () => {
    expect(token("font-sans")).toContain("geist variable");
    expect(token("font-heading")).toContain("geist variable");
    expect(token("font-mono")).toContain("geist mono variable");
    expect(css).not.toMatch(/figtree|bricolage/i);
  });

  it("given main.tsx, when it is read, then it imports Geist and Geist Mono and neither Bricolage Grotesque nor Figtree", () => {
    expect(main).toContain('import "@fontsource-variable/geist";');
    expect(main).toContain('import "@fontsource-variable/geist-mono";');
    expect(main).not.toMatch(/bricolage|figtree/i);
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
