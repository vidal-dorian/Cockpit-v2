import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Shared by the tests of slice 11.6 (decision 063): the four starter teams as the decision lists them, and the helpers that read the catalogue.
//
// Pinned where the decision leaves it open (the developer follows these):
// - `catalog/teams/<level>.md` is a team.md (decision 029 B) in which every step also has a line `    model: <model>` right after its `  - agent:` line.
//   `parseTeam` ignores that key (029 B: the other keys are ignored), but the team editor (`readTeam`, decision 031 G) does not read it: so the file written to
//   `.claude/team.md` is the catalogue file WITHOUT its model lines (`withoutModels`), and the models travel with the agents (the `model:` line of each agent file).
// - The text of an agent written for a level is the catalogue text of the agent with its `model:` line replaced by the level's model (`withModel`).
// - The step wording (`does`, `until`) is free, but a loop has a non-empty `until` that mentions « ready » (« the verdict is ready »).

export type Level = "eco" | "standard" | "premium" | "max";
export type Step = {
  agent: string;
  model: string;
  loopTo?: string;
};

const dev = (model: string): Step => ({ agent: "developer", model });
const loops = (agent: string, model: string, to: string): Step => ({
  agent,
  model,
  loopTo: to,
});

/** Decision 063 A, in the order of the steps. */
export const LEVELS: Record<Level, Step[]> = {
  eco: [{ agent: "test-writer", model: "haiku" }, dev("sonnet")],
  standard: [
    { agent: "test-writer", model: "sonnet" },
    dev("sonnet"),
    loops("reviewer", "opus", "developer"),
  ],
  premium: [
    { agent: "test-writer", model: "sonnet" },
    dev("sonnet"),
    loops("reviewer", "opus", "developer"),
    { agent: "doc-writer", model: "sonnet" },
    loops("doc-reviewer", "sonnet", "doc-writer"),
  ],
  max: [
    { agent: "test-writer", model: "opus" },
    dev("opus"),
    loops("reviewer", "opus", "developer"),
    loops("security-reviewer", "opus", "developer"),
    { agent: "doc-writer", model: "opus" },
    loops("doc-reviewer", "opus", "doc-writer"),
  ],
};
export const LEVEL_IDS = Object.keys(LEVELS) as Level[];

export const fromCatalog = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
    "utf8",
  );
export const agentCatalog = (name: string) => fromCatalog(`agents/${name}.md`);

/** The text of an agent with the `model:` line of the level (the line already in the catalogue text is replaced). */
export const withModel = (text: string, model: string) =>
  text.replace(/^model:.*$/m, `model: ${model}`);
/** What `.claude/team.md` holds when a level is written: the catalogue file without the model lines. */
export const withoutModels = (text: string) =>
  text.replace(/^ {4}model: .*\r?\n/gm, "");
export const teamCatalog = (level: Level) => fromCatalog(`teams/${level}.md`);
/** The team.md a level writes into a repo. */
export const teamWritten = (level: Level) => withoutModels(teamCatalog(level));
export const modelOf = (text: string) =>
  /^model:\s*(\S+)\s*$/m.exec(text)?.[1] ?? null;
