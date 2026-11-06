import { AGENT_NAME } from "../server/team.ts";

export type TeamStep = {
  agent: string;
  does: string;
  loopTo: string | null;
  until: string;
};

/** The `dataTransfer` type of an agent dragged from the right column onto the graph (decision 042 C). */
export const DRAGGED_AGENT = "application/x-cockpit-agent";

/** The team of a repo without `.claude/team.md` (decision 029 C). */
export const DEFAULT_STEPS: TeamStep[] = [
  {
    agent: "test-writer",
    does: "writes the acceptance tests from the criteria; they must fail, for the right reason",
    loopTo: null,
    until: "",
  },
  {
    agent: "developer",
    does: "implements until those tests pass, without touching them",
    loopTo: null,
    until: "",
  },
  {
    agent: "reviewer",
    does: "reviews the diff with a fresh context",
    loopTo: "developer",
    until: "the verdict is ready",
  },
];

const STEP = /^ {2}- agent: (\S+)$/;
const KEY = /^ {4}(does|loop_to|until): (.*)$/;

/** The steps and the text after the front matter of a `team.md` (decision 031 G); null when Cockpit cannot write it back without loss. */
// shortcut: line-based like `parseTeam`, exactly the format `writeTeam` writes (LF, two and four spaces, bare agent names, `does` and `until` as JSON strings or as plain text) plus blank lines; a comment, another key, a multi-line value, a single-quoted one or CRLF make the file unrewritable. Replace it with a YAML library if hand-written files must be edited.
export function readTeam(
  text: string,
): { steps: TeamStep[]; body: string } | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l === "---");
  if (end === -1) return null;
  const front = lines.slice(1, end).filter((l) => l !== "");
  if (front[0] !== "steps:") return null;
  const steps: TeamStep[] = [];
  const seen = new Set<string>();
  for (const line of front.slice(1)) {
    const agent = STEP.exec(line)?.[1];
    if (agent !== undefined) {
      // Twice the same agent: `loop_to` would be ambiguous (decision 031 E).
      if (!AGENT_NAME.test(agent) || steps.some((t) => t.agent === agent))
        return null;
      steps.push({ agent, does: "", loopTo: null, until: "" });
      seen.clear();
      continue;
    }
    const [, key = "", raw = ""] = KEY.exec(line) ?? [];
    const step = steps.at(-1);
    if (!key || !step || seen.has(key)) return null;
    seen.add(key);
    if (key === "loop_to") {
      if (!AGENT_NAME.test(raw)) return null;
      step.loopTo = raw;
      continue;
    }
    let value = raw;
    if (raw.startsWith('"'))
      try {
        value = JSON.parse(raw);
      } catch {
        return null;
      }
    // A YAML indicator or a comment: the value would not be read as plain text.
    else if (/^[#[{&*!|>'%@`]|\s#/.test(raw)) return null;
    if (typeof value !== "string") return null;
    if (key === "does") step.does = value;
    else step.until = value;
  }
  // An `until` without its loop, or a loop that does not go back, would be dropped by a rewrite.
  return steps.length > 0 &&
    steps.every(
      (s, i) =>
        (s.loopTo ? steps.findIndex((t) => t.agent === s.loopTo) : 0) <= i &&
        (s.loopTo || !s.until) &&
        (s.loopTo === null || steps.some((t) => t.agent === s.loopTo)),
    )
    ? { steps, body: lines.slice(end + 1).join("\n") }
    : null;
}

/** The whole file: the front matter of decision 031 G, then `body` as it is. */
export function writeTeam(steps: TeamStep[], body: string): string {
  const lines = steps.flatMap((s) => [
    `  - agent: ${s.agent}`,
    `    does: ${JSON.stringify(s.does)}`,
    ...(s.loopTo === null
      ? []
      : [`    loop_to: ${s.loopTo}`, `    until: ${JSON.stringify(s.until)}`]),
  ]);
  return `---\nsteps:\n${lines.join("\n")}\n---\n${body}`;
}

/** Decision 042 B: the condition a loop gets when it is made, until its author changes it. */
export const defaultUntil = (target: string) =>
  `l'étape ${target} valide le travail`;

/** A loop only goes back (or to its own step): the others are removed. */
const keepBackLoops = (steps: TeamStep[]): TeamStep[] =>
  steps.map((s, i) => {
    const target = steps.findIndex((t) => t.agent === s.loopTo);
    return s.loopTo !== null && (target === -1 || target > i)
      ? { ...s, loopTo: null, until: "" }
      : s;
  });

/** Decision 031 C: a link from `from` to an earlier step (or itself) is a loop with the condition `until`; to a later step, that step moves right after `from`. */
export function linkSteps(
  steps: TeamStep[],
  from: string,
  to: string,
  until = "",
): TeamStep[] {
  const i = steps.findIndex((s) => s.agent === from);
  const j = steps.findIndex((s) => s.agent === to);
  if (i === -1 || j === -1) return steps;
  if (j <= i)
    return steps.map((s, k) => (k === i ? { ...s, loopTo: to, until } : s));
  const moved = steps.filter((_, k) => k !== j);
  moved.splice(i + 1, 0, steps[j] as TeamStep);
  return keepBackLoops(moved);
}

export function moveStep(
  steps: TeamStep[],
  agent: string,
  direction: "up" | "down",
): TeamStep[] {
  const i = steps.findIndex((s) => s.agent === agent);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= steps.length) return steps;
  const moved = [...steps];
  [moved[i], moved[j]] = [moved[j] as TeamStep, moved[i] as TeamStep];
  return keepBackLoops(moved);
}

/** The step goes, and the loops that pointed to it. */
export function removeStep(steps: TeamStep[], agent: string): TeamStep[] {
  return keepBackLoops(steps.filter((s) => s.agent !== agent));
}

/** A new last step; nothing when the agent is already in the team (`loop_to` would be ambiguous). */
export function addStep(
  steps: TeamStep[],
  agent: string,
  does = "",
): TeamStep[] {
  return steps.some((s) => s.agent === agent)
    ? steps
    : [...steps, { agent, does, loopTo: null, until: "" }];
}
