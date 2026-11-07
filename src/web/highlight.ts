import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Decision 047 F: Shiki's fine-grained core, with each grammar in a chunk of its own, loaded the first time a file of that language is shown.
// The theme paints with the `--shiki-…` variables of styles.css, never with a colour of its own.
const GRAMMARS = {
  php: () => import("shiki/langs/php.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
} as const;

let highlighter: Promise<HighlighterCore> | undefined;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The inner HTML of each line, its tokens in spans coloured by a CSS variable. Rejects when Shiki or the grammar cannot load. */
export async function highlightLines(
  lines: string[],
  language: string,
): Promise<string[]> {
  const grammar = GRAMMARS[language as keyof typeof GRAMMARS];
  if (!grammar) throw new Error(`No grammar for ${language}`);
  highlighter ??= createHighlighterCore({
    themes: [createCssVariablesTheme()],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  try {
    const shiki = await highlighter;
    await shiki.loadLanguage(grammar());
    // A snippet of PHP starts inside the code, but the grammar starts in HTML until `<?php`: open it for the grammar.
    const open = language === "php" && !lines.some((l) => l.includes("<?"));
    const tokens = shiki.codeToTokensBase(
      (open ? ["<?php", ...lines] : lines).join("\n"),
      { lang: language, theme: "css-variables" },
    );
    return (open ? tokens.slice(1) : tokens).map((line) =>
      line
        .map((t) =>
          t.color
            ? `<span style="color:${t.color}">${escapeHtml(t.content)}</span>`
            : escapeHtml(t.content),
        )
        .join(""),
    );
  } catch (error) {
    // A failed load is tried again on the next code shown.
    highlighter = undefined;
    throw error;
  }
}
