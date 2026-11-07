// Decision 047 F: the Shiki language of a file comes from its extension; any other stays plain text.
const LANGUAGES = new Map([
  ["php", "php"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["jsx", "jsx"],
  ["py", "python"],
  ["json", "json"],
  ["sql", "sql"],
  ["md", "markdown"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["css", "css"],
  ["html", "html"],
]);

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0
    ? null
    : (LANGUAGES.get(name.slice(dot + 1).toLowerCase()) ?? null);
}
