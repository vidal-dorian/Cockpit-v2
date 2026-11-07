import { expect, it } from "vitest";
import { highlightLines } from "./highlight.ts";

// The real Shiki (decision 047 F): CodeView.test.tsx mocks this module, so what it gives is pinned here.

it("given PHP lines cut out of a file, when they are highlighted, then each line gets its own tokens painted with CSS variables, never a colour", async () => {
  const html = await highlightLines(
    ["if ($a < 1) {", '    throw new Boom("x & y");', "}"],
    "php",
  );

  expect(html).toHaveLength(3);
  expect(html.join("")).toMatch(/color:var\(--shiki-token-keyword\)/);
  expect(html.join("")).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  // Markup of the code is escaped, so a line is never read as HTML.
  expect(html[0]).toContain("&lt;");
  expect(html[1]).toContain("&amp;");
});

it("given a language without grammar, when it is highlighted, then it rejects", async () => {
  await expect(highlightLines(["a"], "cobol")).rejects.toThrow();
});
