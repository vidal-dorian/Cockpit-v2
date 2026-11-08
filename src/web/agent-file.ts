const KEY_VALUE = /^([A-Za-z][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/;

type Header = {
  lines: string[];
  /** Index of the closing `---` line. */
  end: number;
  /** The first line of each key: its index and its value, a double-quoted one read as the JSON string it is. */
  keys: Map<string, { index: number; value: string }>;
};

// shortcut: a line-based reader of the header (`key: value` at column 0, blank lines, `#` comments), not YAML: no lists, no single quotes, no multi-line values, LF line breaks; replace it with a YAML library if agents need more (decision 030 C).
function readHeader(text: string): Header | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (end === -1) return null;
  const keys: Header["keys"] = new Map();
  for (let index = 1; index < end; index++) {
    const line = lines[index] as string;
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const found = KEY_VALUE.exec(line);
    if (!found) return null;
    const [, key = "", raw = ""] = found;
    let value = raw;
    if (raw.startsWith('"'))
      try {
        value = JSON.parse(raw);
      } catch {
        // Not a JSON string (YAML escapes JSON lacks): shown as written.
      }
    if (!keys.has(key)) keys.set(key, { index, value });
  }
  return { lines, end, keys };
}

export type AgentFields = {
  description: string;
  tools: string;
  model: string;
  prompt: string;
};

/** The form fields of an agent file (decision 030 C), null when its header cannot be read. An absent key reads "". */
export function parseAgent(
  text: string,
): (AgentFields & { name: string }) | null {
  const header = readHeader(text);
  if (!header) return null;
  const get = (key: string) => header.keys.get(key)?.value ?? "";
  return {
    name: get("name"),
    description: get("description"),
    tools: get("tools"),
    model: get("model"),
    prompt: header.lines.slice(header.end + 1).join("\n"),
  };
}

/** `text` with the fields written: only the line of a key whose value changed is rewritten (description and tools as JSON strings, the model bare), removed when `tools` or `model` is emptied, appended to the header when the key was absent; the prompt only when it differs. The text must be readable by `parseAgent`. */
export function writeAgent(text: string, fields: AgentFields): string {
  const header = readHeader(text);
  if (!header) throw new Error("Unreadable header");
  const { lines, keys } = header;
  const prompt = lines.slice(header.end + 1).join("\n");
  const edits = (["description", "tools", "model"] as const).flatMap((key) => {
    const found = keys.get(key);
    if (fields[key] === (found?.value ?? "")) return [];
    const line =
      fields[key] === "" && key !== "description"
        ? null
        : `${key}: ${key === "model" ? fields[key] : JSON.stringify(fields[key])}`;
    return [{ index: found?.index ?? header.end, found: !!found, line }];
  });
  // From the bottom up, so an edit does not move the lines above it; appended lines go before the closing `---`.
  for (const { index, found, line } of edits
    .reverse()
    .sort((a, b) => b.index - a.index)) {
    if (line === null) lines.splice(index, 1);
    else lines.splice(index, found ? 1 : 0, line);
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  return fields.prompt === prompt
    ? lines.join("\n")
    : [...lines.slice(0, end + 1), fields.prompt].join("\n");
}

export type SkillFields = { description: string; tools: string; body: string };

/** The form fields of a skill file (decision 065 F), null when its header cannot be read. The blank line after the header is not part of the body. */
export function parseSkill(text: string): SkillFields | null {
  const header = readHeader(text);
  if (!header) return null;
  const get = (key: string) => header.keys.get(key)?.value ?? "";
  return {
    description: get("description"),
    tools: get("allowed-tools"),
    body: header.lines
      .slice(header.end + 1)
      .join("\n")
      .replace(/^\n/, ""),
  };
}

/** The file of a skill as decision 065 F writes it: `allowed-tools` only when not empty, a blank line before the instruction. */
export const writeSkill = (name: string, f: SkillFields) =>
  [
    "---",
    `name: ${name}`,
    `description: ${f.description}`,
    ...(f.tools ? [`allowed-tools: ${f.tools}`] : []),
    "---",
    "",
    f.body,
  ].join("\n");
