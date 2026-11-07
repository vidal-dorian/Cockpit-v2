import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Slice 9.3 (decision 045): the tokens and fonts of « Quatre temps ».
const dir = import.meta.dirname;
const css = readFileSync(join(dir, "styles.css"), "utf8");
const main = readFileSync(join(dir, "main.tsx"), "utf8");

const token = (name: string) =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim().toLowerCase();

describe("tokens and fonts of decision 045", () => {
  it.each([
    ["color-background", "#0e1015"],
    ["color-foreground", "#f2f4f8"],
    ["color-primary", "#f2f4f8"],
    ["color-you", "#ff5d6e"],
    ["color-claude", "#7c8cff"],
    ["color-idea", "#f5c542"],
    ["color-done", "#34d399"],
    ["color-border", "#262b35"],
  ])("given styles.css, when I read %s, then it is %s", (name, value) => {
    expect(token(name)).toBe(value);
  });

  it("given styles.css, when I read the fonts, then they are Urbanist and JetBrains Mono, not Geist", () => {
    expect(token("font-sans")).toContain("urbanist variable");
    expect(token("font-mono")).toContain("jetbrains mono variable");
    expect(css.toLowerCase()).not.toContain("geist");
  });

  it("given main.tsx, when I read its imports, then it loads Urbanist and JetBrains Mono and no Geist", () => {
    expect(main).toContain('import "@fontsource-variable/urbanist"');
    expect(main).toContain('import "@fontsource-variable/jetbrains-mono"');
    expect(main.toLowerCase()).not.toContain("geist");
  });
});
