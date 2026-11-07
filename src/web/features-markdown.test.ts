// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { describe, expect, it } from "vitest";
import { featuresMarkdown } from "./features-markdown.ts";
import { API_MODULE, SHA_API, WEB_MODULE } from "./test-conception.tsx";
import { FACTURER, FILE, RELANCER, SHA_B } from "./test-features.tsx";

// Slice R3 (decision 048 I): the Markdown of the features, built in the browser. A pure function:
// featuresMarkdown(features, modules, fullName) -> string, with `features` as GET /api/projects/:id/features gives them, `modules` as GET /code-map gives them
// and `fullName` « owner/repo ». Pinned: a line `#`, `##`... holding the title of each feature; its actors; each rule's summary, its state in the words of the screen
// (« à trancher », « voulue »), its Étant donné / Quand / Alors texts; one permalink per source, `https://github.com/<full>/blob/<sha>/<path>#L<start>-L<end>`
// (`#L<n>` for one line); each object touched once with its fields as « name type », or « non cartographié ».

const modules = [API_MODULE, WEB_MODULE];
const md = (features = [FACTURER]) =>
  featuresMarkdown(features, modules, "octocat/hello");

describe("decision 048 I: featuresMarkdown", () => {
  it("given a feature, when the Markdown is built, then its title is a heading and its actors are listed", () => {
    const text = md();

    expect(text).toMatch(/^#+ Facturer$/m);
    expect(text).toContain("Client");
    expect(text).toContain("Comptable");
  });

  it("given three rules, when the Markdown is built, then each has its summary, its state and its given, when and then", () => {
    const text = md();

    for (const r of FACTURER.rules)
      for (const part of [r.summary, r.given, r.when, r.then])
        expect(text).toContain(part);
    expect(text.match(/à trancher/g)).toHaveLength(2);
    expect(text.match(/voulue/g)).toHaveLength(1);
  });

  it("given sources of one range and of one line, when the Markdown is built, then each source is one permalink at its own commit", () => {
    const text = md();

    expect(text).toContain(
      `https://github.com/octocat/hello/blob/${SHA_API}/${FILE}#L40-L58`,
    );
    expect(text).toContain(
      `https://github.com/octocat/hello/blob/${SHA_B}/src/Model/Order.php#L5`,
    );
    expect(text).not.toContain("src/Model/Order.php#L5-L5");
    expect(
      text.match(/https:\/\/github\.com\/octocat\/hello\/blob\//g),
    ).toHaveLength(4);
  });

  it("given a mapped and an unmapped object, when the Markdown is built, then the mapped one has its fields from the map, once, and the other says « non cartographié »", () => {
    const text = md();

    expect(text).toContain("Order");
    expect(text).toMatch(/total\W+integer/);
    expect(text.match(/total/g)).toHaveLength(1);
    expect(text).toContain("Ghost");
    expect(text.match(/non cartographié/g)).toHaveLength(1);
    expect(text).not.toContain("Session");
  });

  it("given two features, when the Markdown is built, then both are in it, in order", () => {
    const text = md([FACTURER, RELANCER]);

    expect(text).toMatch(/^#+ Relancer les impayés$/m);
    expect(text.indexOf("Facturer")).toBeLessThan(
      text.indexOf("Relancer les impayés"),
    );
    expect(text).toMatch(/token\W+string/);
  });

  it("given no feature, when the Markdown is built, then it is a string with no title of a feature", () => {
    expect(typeof md([])).toBe("string");
    expect(md([])).not.toContain("Facturer");
  });
});
