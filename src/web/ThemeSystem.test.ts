import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Decision 073 G: « Comme le système » is the light theme under prefers-color-scheme: the two copies of the values must not drift apart.
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
const declarations = (selector: string) => {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
};

it("given styles.css, when I read the light and system themes, then they hold the same declarations", () => {
  const light = declarations(':root[data-theme="light"]');
  expect(light.length).toBeGreaterThan(30);
  expect(declarations(':root[data-theme="system"]')).toEqual(light);
});
