import { readFileSync } from "node:fs";
import { KNOWN_TEXTS } from "./catalog-update.ts";
import { STARTER_TEAMS } from "./db/schema.ts";

export type StarterTeam = (typeof STARTER_TEAMS)[number];
export { STARTER_TEAMS };

const TEAM_PATH = ".claude/team.md";
const agentPath = (name: string) => `.claude/agents/${name}.md`;

/** Decision 063 A, B: `catalog/teams/<level>.md` is a team.md with a `model:` line under each `- agent:` line. */
const read = (level: StarterTeam) =>
  readFileSync(
    new URL(`../../catalog/teams/${level}.md`, import.meta.url),
    "utf8",
  );
/** The text of an agent with the `model:` line of a level (the line already there is replaced). */
const withModel = (text: string, model: string) =>
  text.replace(/^model:.*$/m, `model: ${model}`);

/** The four levels in order: the team.md written to a repo (the catalogue file without its model lines, which the team editor does not read) and the agents of its steps with the level's model. */
export const STARTER_LEVELS = STARTER_TEAMS.map((id) => {
  const text = read(id);
  const agents = [
    ...text.matchAll(/^ {2}- agent: (\S+)\r?\n {4}model: (\S+)\s*$/gm),
  ].map(([, name, model]) => ({
    name: name as string,
    text: withModel(
      KNOWN_TEXTS.get(agentPath(name as string)) as string,
      model as string,
    ),
  }));
  return {
    id,
    team: text.replace(/^ {4}model: .*\r?\n/gm, ""),
    agents,
  };
});

/** What « Préparer pour Claude » may write for a level: the files of the catalogue, with the agents of the team in the level's model, and what the team adds (decision 063 E). Standard is today's team, so it adds nothing. */
export function levelFiles<T extends { path: string; content: string }>(
  base: T[],
  level: StarterTeam,
): (T | { path: string; content: string })[] {
  const found = STARTER_LEVELS.find((l) => l.id === level);
  if (!found) return base;
  const texts = new Map(found.agents.map((a) => [agentPath(a.name), a.text]));
  const files: (T | { path: string; content: string })[] = base.map((f) => ({
    ...f,
    content: texts.get(f.path) ?? f.content,
  }));
  for (const [path, content] of texts)
    if (!files.some((f) => f.path === path)) files.push({ path, content });
  if (level !== "standard")
    files.push({ path: TEAM_PATH, content: found.team });
  return files;
}
