import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Slice 15.3 (decision 073 G): the light palette. Pinned choices:
// - The light theme is the rule `[data-theme="light"] { ... }` of styles.css; it redefines the --color-* tokens of the dark @theme block (the same names, no more, no fewer).
// - Every colour of both blocks is #rrggbb (the rgba tokens, glow and line, are not text or ground and are left out of the check).
// - WCAG AA, 4.5:1: the text tokens (foreground, muted-foreground, and each -text token of idea, you, claude, done) on the grounds they are drawn on:
//   background, card, sunken and raised (the pages, the cards, the fields and the panel, the buttons and badges); the -text token of a colour also on its -soft ground;
//   primary-foreground on primary. Muted-foreground and the -text tokens are held to the four grounds; foreground too.
// The dark theme is checked too, for the dim text (--color-dim) on the page, card and raised grounds (ticket #44).

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
const block = (opening: RegExp) => {
  const start = opening.exec(css);
  if (!start) return null;
  const from = start.index + start[0].length;
  return css.slice(from, css.indexOf("\n}", from));
};
const colors = (body: string | null) =>
  new Map(
    [...(body ?? "").matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim().toLowerCase(),
    ]),
  );
const dark = colors(block(/@theme\s*\{/));
const light = colors(block(/\[data-theme="light"\]\s*\{/));

const channel = (hex: string, at: number) => {
  const v = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) +
  0.7152 * channel(hex, 3) +
  0.0722 * channel(hex, 5);
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
};

const TEXTS = [
  "foreground",
  "muted-foreground",
  "idea-text",
  "you-text",
  "claude-text",
  "done-text",
];
const GROUNDS = ["background", "card", "sunken", "raised"];
const PAIRS: [string, string][] = [
  ...TEXTS.flatMap((t) => GROUNDS.map((g): [string, string] => [t, g])),
  ["idea-text", "idea-soft"],
  ["you-text", "you-soft"],
  ["claude-text", "claude-soft"],
  ["done-text", "done-soft"],
  ["primary-foreground", "primary"],
];

describe("slice 15.3 G: the palettes", () => {
  it("given styles.css, when I read the light theme, then it redefines exactly the colour tokens of the dark theme", () => {
    expect(
      light.size,
      "a [data-theme=light] block with --color tokens",
    ).toBeGreaterThan(0);
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it("given the light theme, when I count each text/ground pair, then every pair reaches 4.5:1", () => {
    expect(light.size, "a [data-theme=light] block").toBeGreaterThan(0);
    const failing = PAIRS.filter(([text, ground]) => {
      const a = light.get(text);
      const b = light.get(ground);
      return !a || !b || ratio(a, b) < 4.5;
    }).map(([t, g]) => `${t} on ${g}`);
    expect(failing).toEqual([]);
  });
});

describe("ticket #44: dim text in the dark theme", () => {
  it("given the dark theme, when I count --color-dim on the page, card and raised grounds, then each ratio is at least 4.5:1", () => {
    const dim = dark.get("dim") as string;
    expect(
      ["background", "card", "raised"]
        .map((g) => [g, ratio(dim, dark.get(g) as string)] as const)
        .filter(([, r]) => r < 4.5)
        .map(([g, r]) => `dim on ${g}: ${r.toFixed(2)}`),
    ).toEqual([]);
  });

  it("given the dark theme, when I compare dim and muted-foreground, then dim stays dimmer", () => {
    const on = (t: string) =>
      ratio(dark.get(t) as string, dark.get("background") as string);
    expect(on("dim")).toBeLessThan(on("muted-foreground"));
  });

  it("given Contrast.test.ts, when I read its header, then it no longer says the dark theme already passes", () => {
    const self = readFileSync(import.meta.filename, "utf8");
    expect(self).not.toMatch(/dark theme already\s+reach/i);
    expect(self).toMatch(/dark/i);
  });
});

// Review of slice 15.3 (decision 073 G): the strong borders reach 3:1, and the dim and destructive texts 4.5:1.
describe("slice 15.3 G: more pairs of the light palette", () => {
  it("given the light theme, when I count border-strong, dim and destructive, then they reach their ratios", () => {
    const at = (a: string, b: string) =>
      ratio(light.get(a) as string, light.get(b) as string);
    expect(
      ["background", "card"].filter((g) => at("border-strong", g) < 3),
    ).toEqual([]);
    expect(
      ["dim", "destructive"].flatMap((t) =>
        GROUNDS.filter((g) => at(t, g) < 4.5).map((g) => `${t} on ${g}`),
      ),
    ).toEqual([]);
  });
});
