import { AGENT_NAME } from "../server/team.ts";

/** Decision 079 A: `id`, `parallel`, `wait` and `max` are absent (undefined) unless the file says them. */
export type TeamStep = {
  agent: string;
  id?: string;
  does: string;
  parallel?: boolean;
  wait?: "first" | "all";
  loopTo: string | null;
  until: string;
  max?: number;
};

/** What a palette agent carries when it is dragged onto the canvas. */
export const DRAG_TYPE = "application/x-cockpit-agent";

/** The key of a step is its `id`, or its agent: `loopTo` and the draft functions name a key. */
export const keyOf = (s: TeamStep) => s.id ?? s.agent;

/** The group index of each step: a `parallel` step is in the group of the step before it. */
function groupIndexes(steps: TeamStep[]): number[] {
  const out: number[] = [];
  for (const [i, s] of steps.entries())
    out.push(i === 0 ? 0 : (out[i - 1] ?? 0) + (s.parallel ? 0 : 1));
  return out;
}

/** The steps cut in groups: most are alone, a group has two or more steps. */
export function groupsOf(steps: TeamStep[]): TeamStep[][] {
  const at = groupIndexes(steps);
  return Array.from({ length: (at.at(-1) ?? -1) + 1 }, (_, g) =>
    steps.filter((_s, i) => at[i] === g),
  );
}

/** Decision 079 A2: a loop goes to the step itself or to a step of a previous group. */
const loopIsValid = (steps: TeamStep[], i: number, groups: number[]) => {
  const target = steps.findIndex((t) => keyOf(t) === steps[i]?.loopTo);
  return (
    target !== -1 && (target === i || (groups[target] ?? 0) < (groups[i] ?? 0))
  );
};

/** The label of a step: its agent, then its `id` when it has one. */
export const stepLabel = (s: TeamStep) =>
  s.id !== undefined && s.id !== s.agent ? `${s.agent} · ${s.id}` : s.agent;

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
    max: 3,
  },
];

const STEP = /^ {2}- agent: (\S+)$/;
const KEY = /^ {4}(does|id|parallel|wait|loop_to|until|max): (.*)$/;

/** The steps and the text after the front matter of a `team.md` (decisions 031 G and 079 A2); null when Cockpit cannot write it back without loss. */
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
      if (!AGENT_NAME.test(agent)) return null;
      steps.push({ agent, does: "", loopTo: null, until: "" });
      seen.clear();
      continue;
    }
    const [, key = "", raw = ""] = KEY.exec(line) ?? [];
    const step = steps.at(-1);
    if (!key || !step || seen.has(key)) return null;
    seen.add(key);
    if (key === "loop_to" || key === "id") {
      if (!AGENT_NAME.test(raw)) return null;
      if (key === "id") step.id = raw;
      else step.loopTo = raw;
      continue;
    }
    if (key === "parallel") {
      if (raw !== "true") return null;
      step.parallel = true;
      continue;
    }
    if (key === "wait") {
      if (raw !== "first" && raw !== "all") return null;
      step.wait = raw;
      continue;
    }
    if (key === "max") {
      if (!/^[1-9]$/.test(raw)) return null;
      step.max = Number(raw);
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
  const groups = groupIndexes(steps);
  // An `until` or a `max` without its loop, or a loop that does not go back, would be dropped by a rewrite.
  return steps.length > 0 &&
    new Set(steps.map(keyOf)).size === steps.length &&
    steps.every(
      (s, i) =>
        !(i === 0 && s.parallel) &&
        (s.wait === undefined ||
          (!s.parallel && steps[i + 1]?.parallel === true)) &&
        (s.loopTo ? loopIsValid(steps, i, groups) : !s.until && !s.max),
    )
    ? { steps, body: lines.slice(end + 1).join("\n") }
    : null;
}

/** The whole file: the front matter of decisions 031 G and 079 A, then `body` as it is. */
export function writeTeam(steps: TeamStep[], body: string): string {
  const lines = steps.flatMap((s) => [
    `  - agent: ${s.agent}`,
    ...(s.id === undefined || s.id === s.agent ? [] : [`    id: ${s.id}`]),
    `    does: ${JSON.stringify(s.does)}`,
    ...(s.parallel ? ["    parallel: true"] : []),
    ...(s.wait === undefined ? [] : [`    wait: ${s.wait}`]),
    ...(s.loopTo === null
      ? []
      : [
          `    loop_to: ${s.loopTo}`,
          `    until: ${JSON.stringify(s.until)}`,
          ...(s.max === undefined ? [] : [`    max: ${s.max}`]),
        ]),
  ]);
  return `---\nsteps:\n${lines.join("\n")}\n---\n${body}`;
}

/** What a reorder or a removal can break: `parallel` on the first step, `wait` outside a group head, a loop that does not go back (its `until` and `max` go with it). */
export const tidy = (steps: TeamStep[]): TeamStep[] => {
  const fixed = steps.map((s, i) => ({
    ...s,
    parallel: i === 0 ? undefined : s.parallel,
    wait: steps[i + 1]?.parallel && !s.parallel ? s.wait : undefined,
  }));
  const groups = groupIndexes(fixed);
  return fixed.map((s, i) =>
    s.loopTo === null || loopIsValid(fixed, i, groups)
      ? s
      : { ...s, loopTo: null, until: "", max: undefined },
  );
};

/** Takes the step `i` out; when it headed a group, the next step of the group becomes the head. */
const detach = (steps: TeamStep[], i: number): TeamStep[] => {
  const head = steps[i];
  const next = steps[i + 1];
  const rest = steps.filter((_, k) => k !== i);
  if (head?.parallel || !next?.parallel) return rest;
  rest[i] = { ...next, parallel: undefined, wait: head?.wait };
  return rest;
};

/** Decision 031 C: a link from `from` to an earlier step (or itself) is a loop with the condition `until`; to a later step, that step moves right after `from`. */
export function linkSteps(
  steps: TeamStep[],
  from: string,
  to: string,
  until = "",
  max?: number,
): TeamStep[] {
  const i = steps.findIndex((s) => keyOf(s) === from);
  const j = steps.findIndex((s) => keyOf(s) === to);
  if (i === -1 || j === -1) return steps;
  if (j <= i)
    return steps.map((s, k) =>
      k === i ? { ...s, loopTo: to, until, max } : s,
    );
  const moved = steps.filter((_, k) => k !== j);
  moved.splice(i + 1, 0, steps[j] as TeamStep);
  return tidy(moved);
}

/** Decision 079 D5, the gesture on the canvas: a link to an earlier step (or itself) is a loop; to a step further, that step joins in parallel the step that follows `from`. */
export function linkOnCanvas(
  steps: TeamStep[],
  from: string,
  to: string,
  until = "the verdict is ready",
  max = 3,
): TeamStep[] {
  const i = steps.findIndex((s) => keyOf(s) === from);
  const j = steps.findIndex((s) => keyOf(s) === to);
  if (i === -1 || j === -1) return steps;
  const groups = groupIndexes(steps);
  const [gi, gj] = [groups[i] ?? 0, groups[j] ?? 0];
  // A loop into another step of its own group, or a link to a step of the next group (or of its own), changes nothing.
  if (j <= i)
    return gj === gi && j !== i
      ? steps
      : steps.map((s, k) => (k === i ? { ...s, loopTo: to, until, max } : s));
  if (gj <= gi + 1) return steps;
  const rest = detach(steps, j);
  // Right after the last step of the group that follows `from`.
  const at = groupIndexes(rest).lastIndexOf(gi + 1) + 1;
  rest.splice(at, 0, {
    ...(steps[j] as TeamStep),
    parallel: true,
    wait: undefined,
  });
  return tidy(rest);
}

export function moveStep(
  steps: TeamStep[],
  key: string,
  direction: "up" | "down",
): TeamStep[] {
  const i = steps.findIndex((s) => keyOf(s) === key);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= steps.length) return steps;
  // The shape of the groups stays: the two steps swap their content, not their `parallel` and `wait`.
  const [a, b] = [steps[i] as TeamStep, steps[j] as TeamStep];
  const moved = [...steps];
  moved[i] = { ...b, parallel: a.parallel, wait: a.wait };
  moved[j] = { ...a, parallel: b.parallel, wait: b.wait };
  return tidy(moved);
}

/** The step goes, and the loops that pointed to it. */
export function removeStep(steps: TeamStep[], key: string): TeamStep[] {
  const i = steps.findIndex((s) => keyOf(s) === key);
  return i === -1 ? steps : tidy(detach(steps, i));
}

/** A step for `agent`: an agent already in the team gets the free `id` 2, 3... (decision 079 D5). */
function newStep(steps: TeamStep[], agent: string, does: string): TeamStep {
  const taken = steps.some((s) => s.agent === agent || keyOf(s) === agent);
  let n = 2;
  while (steps.some((s) => keyOf(s) === String(n))) n++;
  return {
    agent,
    ...(taken && { id: String(n) }),
    does,
    loopTo: null,
    until: "",
  };
}

/** A new last step. */
export function addStep(
  steps: TeamStep[],
  agent: string,
  does = "",
): TeamStep[] {
  return [...steps, newStep(steps, agent, does)];
}

/** Decision 079 D5, the « + » of a link: the agent is a step alone, after the group of the step `key`. */
export function insertStepAfter(
  steps: TeamStep[],
  key: string,
  agent: string,
  does = "",
): TeamStep[] {
  const i = steps.findIndex((s) => keyOf(s) === key);
  if (i === -1) return steps;
  const at = groupIndexes(steps).lastIndexOf(groupIndexes(steps)[i] ?? 0) + 1;
  return [
    ...steps.slice(0, at),
    newStep(steps, agent, does),
    ...steps.slice(at),
  ];
}

/** Feedback on E6, a drop between groups: the agent is a step alone at group `group` (past the last group: the last step). */
export function insertAtGroup(
  steps: TeamStep[],
  group: number,
  agent: string,
  does = "",
): TeamStep[] {
  const at = groupIndexes(steps).indexOf(group);
  const i = at === -1 ? steps.length : at;
  return [...steps.slice(0, i), newStep(steps, agent, does), ...steps.slice(i)];
}

/** Feedback on E6, a drop on a card: the agent joins the group of the step `key`, as its last step. */
export function addParallelTo(
  steps: TeamStep[],
  key: string,
  agent: string,
  does = "",
): TeamStep[] {
  const i = steps.findIndex((s) => keyOf(s) === key);
  if (i === -1) return steps;
  const at = groupIndexes(steps).lastIndexOf(groupIndexes(steps)[i] ?? 0) + 1;
  return [
    ...steps.slice(0, at),
    { ...newStep(steps, agent, does), parallel: true },
    ...steps.slice(at),
  ];
}

/** The number of a « Au plus » field (decision 079 C): 1 to 9, undefined when empty or not a number. */
export const parseMax = (value: string): number | undefined => {
  const n = Math.round(Number(value));
  return value.trim() === "" || Number.isNaN(n)
    ? undefined
    : Math.min(9, Math.max(1, n));
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/** Decision 079 D2: « 5 étapes · 2 en parallèle · 1 boucle », a nil count is not written. */
export function teamSummary(steps: TeamStep[]): string {
  const groups = groupsOf(steps).filter((g) => g.length > 1);
  const loops = steps.filter((s) => s.loopTo !== null).length;
  return [
    plural(steps.length, "étape", "étapes"),
    groups.length === 0
      ? ""
      : groups.length === 1
        ? `${groups[0]?.length} en parallèle`
        : `${groups.length} fois en parallèle`,
    loops === 0 ? "" : plural(loops, "boucle", "boucles"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Decision 079 D6: what Cockpit says it checks, a refused check (`ok` false) blocks the save. */
export function teamChecks(steps: TeamStep[]): { ok: boolean; text: string }[] {
  const groups = groupsOf(steps);
  return [
    ...groups.flatMap((g, i) => {
      if (g.length < 2) return [];
      const labels = g.map(stepLabel);
      const last = labels.pop();
      const next = groups[i + 1]?.[0];
      return [
        {
          ok: true,
          text: `Les branches ${labels.join(", ")} et ${last} se rejoignent avant ${next ? stepLabel(next) : "Fin"}`,
        },
      ];
    }),
    ...steps
      .filter((s) => s.loopTo !== null)
      .flatMap((s) => {
        const of = `La boucle de ${stepLabel(s)}`;
        return [
          ...(s.until.trim() === ""
            ? [{ ok: false, text: `${of} n'a pas de condition` }]
            : []),
          s.max === undefined
            ? { ok: false, text: `${of} n'a pas de limite` }
            : { ok: true, text: `${of} a une limite : ${s.max} fois` },
        ];
      }),
  ];
}

/** Decision 079 C: the choice of « Quand suivre ce lien » that an `until` makes. */
export function untilChoice(until: string, agent: string): string {
  if (until === "the verdict is ready") return `Si le ${agent} bloque`;
  if (until === "the tests pass") return "Si les tests échouent";
  return until === "always" ? "Toujours" : "Une condition à toi";
}
