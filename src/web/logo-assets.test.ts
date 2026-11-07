import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Decision 046: the logo's tokens and hover vortex in styles.css, the favicon.
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "styles.css"), "utf8");
const html = readFileSync(join(dir, "index.html"), "utf8");
const faviconPath = join(dir, "public", "favicon.svg");

const tokens = {
  "--logo-idea": "#f5c542",
  "--logo-you": "#ff5d6e",
  "--logo-claude": "#7c8cff",
  "--logo-done": "#34d399",
};

describe("logo styles", () => {
  it.each(Object.entries(tokens))(
    "given styles.css, when it is read, then the token %s is %s",
    (name, value) => {
      const m = css.match(new RegExp(`${name}[ ]*:[ ]*([^;]+);`));
      expect(m?.[1]?.trim().toLowerCase()).toBe(value);
    },
  );

  it("given styles.css, when it is read, then the vortex targets the loop and the core on hover, only without reduced motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(start).toBeGreaterThanOrEqual(0);
    // The block of the media query: from its opening brace to the matching one.
    let depth = 0;
    let end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const block = css.slice(start, end);
    expect(block).toContain(".logo:hover .logo-loop");
    expect(block).toContain(".logo:hover .logo-core");
  });

  it("given styles.css, when it is read, then no rule hides the logo core at rest", () => {
    // Every rule whose selector list is exactly `.logo-core` (not the hover ones).
    const rules = [...css.matchAll(/(?:^|[}\n])\s*\.logo-core\s*\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r[1]).not.toMatch(/opacity\s*:\s*0\s*(;|$)/);
  });

  it("given the logo-core keyframes, when they are read, then the core never fades out, swells above 1 and ends at scale(1)", () => {
    const start = css.indexOf("@keyframes logo-core");
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = css.slice(css.indexOf("{", start) + 1, end);
    expect(body).not.toMatch(/opacity\s*:\s*0\s*(;|$|\n)/);
    expect(body).not.toMatch(/scale\(\s*0(\.0+)?\s*\)/);
    const scales = [...body.matchAll(/scale\(\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...scales)).toBeGreaterThan(1);
    const lastBlock = body.slice(body.lastIndexOf("100%"));
    expect(lastBlock).toMatch(/scale\(\s*1\s*\)/);
  });

  it("given styles.css, when it is read, then it no longer mentions the handshake", () => {
    for (const old of [
      "logo-human",
      "logo-hand",
      "logo-finger",
      "logo-wire",
      "logo-dot",
      "--logo-coral",
    ])
      expect(css).not.toContain(old);
  });
});

describe("favicon", () => {
  it("given index.html, when it is read, then its head declares the svg icon", () => {
    const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? "";
    expect(head).toMatch(
      /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"\s*\/?>/,
    );
  });

  it("given src/web/public/favicon.svg, when it is read, then it is the logo with four filled paths", () => {
    expect(existsSync(faviconPath)).toBe(true);
    const svg = readFileSync(faviconPath, "utf8");
    expect(svg).toMatch(/<svg[^>]*viewBox="0 0 120 120"/);
    const fills = [...svg.matchAll(/<path\b[^>]*\bfill="([^"]+)"/g)].map((m) =>
      m[1]?.toLowerCase(),
    );
    expect(fills).toEqual(Object.values(tokens));
  });

  it("given src/web/public/favicon.svg, when it is read, then it has a centre circle in the dark text colour, turned dark by a light-scheme rule", () => {
    const svg = readFileSync(faviconPath, "utf8");
    const circle = svg.match(/<circle\b[^>]*>/)?.[0] ?? "";
    expect(circle).toMatch(/\bcx="60"/);
    expect(circle).toMatch(/\bcy="60"/);
    expect(circle).toMatch(/\br="7"/);
    expect(circle.toLowerCase()).toContain('fill="#f2f4f8"');
    const media = svg.match(/@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)[\s\S]*$/)?.[0];
    expect(media).toBeDefined();
    expect(media?.toLowerCase()).toContain("#0e1015");
    expect(media).toMatch(/fill\s*:/);
  });
});
