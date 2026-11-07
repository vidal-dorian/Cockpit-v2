// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeView } from "./CodeView.tsx";
import { languageOf } from "./code-language.ts";

// Slice R2 (decision 047 F and G): the one component that shows code, for the takeover screen and the panel of an object of the map.
//
// Pinned where the decision leaves it open (the developer follows these):
// - `src/web/CodeView.tsx` exports `CodeView({ path, firstLine, lines, start, end })`: `lines` are the texts from line `firstLine`, `start`..`end` the cited lines (included).
// - Every line is an element with `data-line="<n>"` that holds its number and its text; a cited line also has the attribute `data-cited` (an uncited one has not).
// - `src/web/code-language.ts` exports `languageOf(path): string | null`, the name of a Shiki language from the extension (case-insensitive), null when unknown.
// - `src/web/highlight.ts` exports `highlightLines(lines: string[], language: string): Promise<string[]>`: the inner HTML of each line, with the spans of the tokens.
//   CodeView loads it with a dynamic import() only when it has code to show, and calls it only for a known language; it shows the plain text first, the tokens when
//   they arrive, and the plain text for good when the highlighter fails. These tests mock this module: they never assert Shiki's own output.

const highlightLines = vi.hoisted(() => vi.fn());
vi.mock("./highlight.ts", () => ({ highlightLines }));

beforeEach(() => {
  highlightLines.mockImplementation(async (lines: string[]) =>
    lines.map((l) => `<span class="tok">${l}</span>`),
  );
});
afterEach(() => {
  cleanup();
  highlightLines.mockReset();
});

const rows = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>("[data-line]"),
];

describe("decision 047 G: the cited lines are marked", () => {
  it("given the lines 37 to 61 and a citation of 40 to 58, when it is rendered, then every line has its number and text and exactly the lines 40 to 58 are data-cited", () => {
    const lines = Array.from(
      { length: 25 },
      (_, i) => `ligne de code ${37 + i}`,
    );

    const { container } = render(
      <CodeView
        path="notes.xyz"
        firstLine={37}
        lines={lines}
        start={40}
        end={58}
      />,
    );

    const found = rows(container);
    expect(found.map((r) => r.dataset.line)).toEqual(
      Array.from({ length: 25 }, (_, i) => String(37 + i)),
    );
    for (const row of found) {
      const n = Number(row.dataset.line);
      expect(row.textContent).toContain(String(n));
      expect(row.textContent).toContain(`ligne de code ${n}`);
      expect(row.hasAttribute("data-cited"), `line ${n}`).toBe(
        n >= 40 && n <= 58,
      );
    }
  });

  it("given a citation of one line, when it is rendered, then only that line is data-cited", () => {
    const { container } = render(
      <CodeView
        path="a.xyz"
        firstLine={1}
        lines={["a", "b", "c", "d"]}
        start={2}
        end={2}
      />,
    );

    expect(
      rows(container)
        .filter((r) => r.hasAttribute("data-cited"))
        .map((r) => r.dataset.line),
    ).toEqual(["2"]);
  });
});

describe("decision 047 F: the language comes from the extension", () => {
  it.each([
    ["src/Service/FactureService.php", "php"],
    ["api/src/db.ts", "typescript"],
    ["web/src/App.tsx", "tsx"],
    ["a/b.js", "javascript"],
    ["a/b.jsx", "jsx"],
    ["tools/run.py", "python"],
    ["package.json", "json"],
    ["db/schema.sql", "sql"],
    ["README.md", "markdown"],
    ["ci.yml", "yaml"],
    ["ci.yaml", "yaml"],
    ["styles.css", "css"],
    ["index.html", "html"],
    ["Main.PHP", "php"],
  ])(
    "given the path %s, when its language is asked, then it is %s",
    (path, language) => {
      expect(languageOf(path)).toBe(language);
    },
  );

  it.each(["notes.xyz", "Makefile", "archive.tar.zzz", "dir.d/file"])(
    "given the path %s with an extension Cockpit does not know, when its language is asked, then null",
    (path) => {
      expect(languageOf(path)).toBeNull();
    },
  );

  it("given a PHP file, when it is rendered, then the highlighter is asked for php with the lines, and the tokens replace the plain text", async () => {
    const { container } = render(
      <CodeView
        path="src/Service/FactureService.php"
        firstLine={10}
        lines={["<?php", "echo 1;"]}
        start={10}
        end={11}
      />,
    );

    await waitFor(() =>
      expect(container.querySelectorAll(".tok")).toHaveLength(2),
    );
    expect(highlightLines).toHaveBeenCalledWith(["<?php", "echo 1;"], "php");
    expect(rows(container)[1]?.textContent).toContain("echo 1;");
    expect(rows(container)[1]?.textContent).toContain("11");
  });

  it("given a TypeScript file, when it is rendered, then the language is typescript", async () => {
    render(
      <CodeView
        path="api/src/db.ts"
        firstLine={1}
        lines={["const a = 1;"]}
        start={1}
        end={1}
      />,
    );

    await waitFor(() => expect(highlightLines).toHaveBeenCalled());
    expect(highlightLines.mock.calls[0]?.[1]).toBe("typescript");
  });

  it("given an unknown extension, when it is rendered, then the code is plain text and the highlighter is never asked", async () => {
    const { container } = render(
      <CodeView
        path="notes.xyz"
        firstLine={1}
        lines={["un texte <b>brut</b>"]}
        start={1}
        end={1}
      />,
    );

    expect(screen.getByText(/un texte/)).toBeDefined();
    // Never read as HTML.
    expect(container.querySelector("b")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(highlightLines).not.toHaveBeenCalled();
  });

  it("given a highlighter that fails, when a PHP file is rendered, then the plain text stays, nothing is thrown", async () => {
    highlightLines.mockRejectedValue(new Error("grammar failed to load"));

    const { container } = render(
      <CodeView
        path="a.php"
        firstLine={1}
        lines={["echo 1;"]}
        start={1}
        end={1}
      />,
    );

    await waitFor(() => expect(highlightLines).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(rows(container)[0]?.textContent).toContain("echo 1;");
  });

  it("given the lines of another file after a first render, when the props change, then the new lines are shown (a tab of another source)", async () => {
    const { container, rerender } = render(
      <CodeView
        path="a.php"
        firstLine={1}
        lines={["première source"]}
        start={1}
        end={1}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".tok")).toHaveLength(1),
    );

    rerender(
      <CodeView
        path="b.php"
        firstLine={5}
        lines={["seconde source"]}
        start={5}
        end={5}
      />,
    );

    await waitFor(() =>
      expect(container.textContent).toContain("seconde source"),
    );
    expect(container.textContent).not.toContain("première source");
    expect(rows(container)[0]?.dataset.line).toBe("5");
  });
});
