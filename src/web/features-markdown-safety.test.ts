// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then rule (decision 017)
import { describe, expect, it } from "vitest";
import { featuresMarkdown } from "./features-markdown.ts";
import { FACTURER, featureRule } from "./test-features.tsx";

// Decision 048 I: the text of the user and of Claude cannot change the structure of the document.
const md = (
  over: Parameters<typeof featureRule>[1],
  fields: { name: string; type: string }[] = [],
) =>
  featuresMarkdown(
    [
      {
        ...FACTURER,
        rules: [
          featureRule(1, {
            objects: [{ name: "Order", inMap: true }],
            ...over,
          }),
        ],
      },
    ],
    [{ data: { objects: [{ name: "Order", fields }] } }],
    "octocat/hello",
  );

describe("featuresMarkdown: text that looks like Markdown", () => {
  it("given a type with angle brackets, then it stays inside a code span", () => {
    expect(md({}, [{ name: "lines", type: "Array<Order>" }])).toContain(
      "` Array<Order> `",
    );
  });

  it("given a backtick in a field name, then the fence is longer than the run", () => {
    expect(md({}, [{ name: "a`b", type: "string" }])).toContain("`` a`b ``");
  });

  it("given a summary with a newline and a # line, then it is one heading", () => {
    const text = md({ summary: "Une règle\n# injecté" });

    expect(text).toContain("## Une règle # injecté\n");
    expect(text).not.toMatch(/^# injecté/m);
  });

  it("given a summary ending in #, then the # is kept, escaped", () => {
    expect(md({ summary: "Numéro #" })).toContain("## Numéro \\#\n");
  });

  it("given a then text with a blank line, then the next lines stay in the list item", () => {
    const text = md({ then: "premier\n\nsecond" });

    expect(text).toContain("- **Alors** premier\n  \n  second");
  });
});
