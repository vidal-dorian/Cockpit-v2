export const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The agent names of `.claude/team.md` (decision 029 B), in order; null when the file cannot be read. */
// shortcut: a line-based reader of a fixed format (front matter, `steps:`, one `- agent: <name>` per step), not YAML; replace it with a YAML library if the format grows.
export function parseTeam(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;
  const front = lines.slice(1, end);
  const start = front.findIndex((l) => l.trim() === "steps:");
  if (start === -1) return null;
  const agents: string[] = [];
  for (const l of front.slice(start + 1)) {
    if (/^\s*#/.test(l)) continue; // a comment
    if (/^\S/.test(l)) break; // the next top-level key
    if (!/^\s*-\s/.test(l)) continue; // does, loop_to, until, blank lines
    const name = /^\s*-\s+agent:\s*(.*?)\s*$/.exec(l)?.[1];
    if (name === undefined || !AGENT_NAME.test(name)) return null;
    agents.push(name);
  }
  return agents.length > 0 ? agents : null;
}
