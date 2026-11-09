import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { type Failure, failure, message } from "./ProjectPrepare.tsx";
import { STARTER_LEVELS } from "./starter-levels.ts";
import { catalogAgents, StepList, TeamCanvas } from "./TeamCanvas.tsx";
import {
  addStep,
  DEFAULT_STEPS,
  linkSteps,
  moveStep,
  parseMax,
  readTeam,
  removeStep,
  type TeamStep,
  writeTeam,
} from "./team-file.ts";
import {
  alertBox,
  button,
  card,
  dangerButton,
  field,
  focusRing,
  ghostButton,
  primaryButton,
} from "./ui.ts";

// React Flow stays out of the main bundle, as react-markdown does (App.tsx); the list below works while it loads.
const StepGraph = lazy(() => import("./ProjectTeamGraph.tsx"));

/** A pill of a row of choices (« Par défaut », « Graphe », a module): the chosen one is outlined. */
export const chip = (on: boolean) =>
  `inline-flex h-7 items-center whitespace-nowrap rounded-full border px-2.5 text-[12.5px] font-semibold disabled:opacity-50 ${focusRing} ${on ? "border-foreground bg-raised text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`;

const TDD_AGENTS = ["test-writer", "reviewer"];

type Agent = { name: string; text: string | null };
type Draft = { steps: TeamStep[]; body: string };
type Done = { url: string; pullRequest: boolean };
type StarterAgent = { name: string; text: string };
export type StarterTeams = {
  teams: { id: string; team: string; agents: StarterAgent[] }[];
};
const STARTER_KEY = ["starter-teams"];
export const starterQuery = {
  queryKey: STARTER_KEY,
  queryFn: async (): Promise<StarterTeams> => {
    const res = await client.api["starter-teams"].$get();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};
type AgentChange = { name: string; before: string | null; after: string };

const MODEL = /^model:.*$/m;
const FRONT = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/;
// Only the front matter counts: a `model:` line in the body is text.
const modelOf = (text: string) =>
  /^model:\s*(.*?)\s*$/m.exec(FRONT.exec(text)?.[0] ?? "")?.[1];

/** The agent files a starter team adds (its catalogue text) or changes (only the `model:` line, decision 063 F). */
function starterChanges(
  starter: StarterAgent[],
  steps: TeamStep[],
  repo: Agent[],
): AgentChange[] {
  const changes: AgentChange[] = [];
  for (const { name, text } of starter) {
    if (!steps.some((s) => s.agent === name)) continue;
    const before = repo.find((a) => a.name === name)?.text;
    if (before === undefined) changes.push({ name, before: null, after: text });
    else if (before !== null && modelOf(before) !== modelOf(text)) {
      const line = `model: ${modelOf(text)}`;
      // No `model:` line: it goes last in the front matter; no front matter: one is added.
      const head = FRONT.exec(before)?.[0];
      const eol = /\r?\n/.exec(head ?? before)?.[0] ?? "\n";
      // Function replacers: the file's text is never a replacement pattern.
      const after = !head
        ? `---${eol}${line}${eol}---${eol}${before}`
        : (MODEL.test(head)
            ? head.replace(MODEL, () => line)
            : head.replace(
                /---(\r?\n|$)$/,
                (fence) => `${line}${eol}${fence}`,
              )) + before.slice(head.length);
      changes.push({ name, before, after });
    }
  }
  return changes;
}
function StepPanel({
  uid,
  step,
  index,
  steps,
  freeAgents,
  onChange,
  onRemove,
  canEditAgent,
  onEditAgent,
}: {
  uid: string;
  step: TeamStep;
  index: number;
  steps: TeamStep[];
  freeAgents: string[];
  onChange: (next: TeamStep) => void;
  onRemove: () => void;
  canEditAgent: boolean;
  onEditAgent?: () => void;
}) {
  return (
    <div className={`${card} mt-4 p-4`}>
      <h3 className="font-mono font-semibold">{step.agent}</h3>
      <label htmlFor={`${uid}-step-agent`} className="mt-3 block">
        Agent
      </label>
      <select
        id={`${uid}-step-agent`}
        className={field}
        value={step.agent}
        onChange={(e) => onChange({ ...step, agent: e.target.value })}
      >
        {[step.agent, ...freeAgents].map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <label htmlFor={`${uid}-step-does`} className="mt-3 block">
        Ce qu'il fait
      </label>
      <input
        id={`${uid}-step-does`}
        className={field}
        value={step.does}
        onChange={(e) => onChange({ ...step, does: e.target.value })}
      />
      <label htmlFor={`${uid}-step-loop`} className="mt-3 block">
        Boucle
      </label>
      <select
        id={`${uid}-step-loop`}
        className={field}
        value={step.loopTo ?? ""}
        onChange={(e) =>
          onChange({
            ...step,
            loopTo: e.target.value || null,
            until: e.target.value ? step.until : "",
            // A loop always has a limit (decision 079 C).
            max: e.target.value ? (step.max ?? 3) : undefined,
          })
        }
      >
        <option value="">Aucune</option>
        {steps.slice(0, index + 1).map((s) => (
          <option key={s.agent} value={s.agent}>
            {s.agent}
          </option>
        ))}
      </select>
      {step.loopTo !== null && (
        <>
          <label htmlFor={`${uid}-step-until`} className="mt-3 block">
            Condition
          </label>
          <input
            id={`${uid}-step-until`}
            className={field}
            value={step.until}
            onChange={(e) => onChange({ ...step, until: e.target.value })}
          />
          <label htmlFor={`${uid}-step-max`} className="mt-3 block">
            Au plus
          </label>
          <input
            id={`${uid}-step-max`}
            type="number"
            min={1}
            max={9}
            className={field}
            value={step.max ?? ""}
            onChange={(e) =>
              onChange({ ...step, max: parseMax(e.target.value) })
            }
          />
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onRemove} className={button}>
          Retirer l'étape
        </button>
        {onEditAgent && (
          <button
            type="button"
            disabled={!canEditAgent}
            onClick={onEditAgent}
            className={button}
          >
            Modifier l'agent
          </button>
        )}
      </div>
    </div>
  );
}

/** The graph, the list of steps, the panel of one step and « Ajouter une étape » on a draft owned by the caller (the team shown, or the new one in its dialog). */
function StepEditor({
  steps,
  onSteps,
  agents,
  archived,
  view,
  onEditAgent,
}: {
  steps: TeamStep[];
  onSteps: (next: TeamStep[]) => void;
  agents: Agent[];
  archived: boolean;
  /** The dialog shows both: it has no switch. */
  view: "graph" | "list" | "both";
  /** Absent in the dialog: the agent form would open behind it. */
  onEditAgent?: (name: string) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState("");
  const [pending, setPending] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [until, setUntil] = useState("");
  const [limit, setLimit] = useState(3);
  const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  // Any change other than the pending link itself drops the link prompt: it was about the old order.
  const setSteps = (next: TeamStep[]) => {
    setPending(null);
    onSteps(next);
  };
  const free = agents
    .map((a) => a.name)
    .filter((name) => !steps.some((s) => s.agent === name));
  const openStep = steps.find((s) => s.agent === open);
  const link = (from: string, to: string) => {
    const toIndex = steps.findIndex((s) => s.agent === to);
    if (toIndex <= steps.findIndex((s) => s.agent === from)) {
      setUntil("");
      setLimit(3);
      setPending({ from, to });
    } else setSteps(linkSteps(steps, from, to));
  };
  // A selection is only kept while its loop exists.
  const loopShown = steps.some((s) => s.agent === selectedLoop && s.loopTo)
    ? selectedLoop
    : null;
  const select = (agent: string) => {
    setAdding(false);
    setOpen(agent);
  };

  const addButton = (
    <button
      type="button"
      disabled={archived}
      onClick={() => {
        setOpen(null);
        setAdding(true);
      }}
      className={
        view === "graph"
          ? `absolute bottom-4 left-4 h-[30px] ${button}`
          : `mt-3 ${button}`
      }
    >
      + Ajouter une étape
    </button>
  );

  return (
    <>
      {view !== "list" && (
        <div
          className={`${card} relative h-16 sm:h-80 ${view === "both" ? "mt-3" : ""}`}
        >
          <Suspense
            fallback={
              <p
                role="status"
                className="hidden text-muted-foreground sm:block"
              >
                Chargement du graphe…
              </p>
            }
          >
            <StepGraph
              id={uid}
              steps={steps}
              agents={agents}
              selectedLoop={loopShown}
              onOpen={select}
              onLink={link}
              onSelectLoop={setSelectedLoop}
            />
          </Suspense>
          {view === "graph" && addButton}
        </div>
      )}
      {loopShown !== null && (
        <button
          type="button"
          onClick={() => {
            setSteps(
              steps.map((s) =>
                s.agent === loopShown
                  ? { ...s, loopTo: null, until: "", max: undefined }
                  : s,
              ),
            );
            setSelectedLoop(null);
          }}
          className={`mt-3 ${button}`}
        >
          Retirer la boucle
        </button>
      )}
      {pending && (
        <div className={`${card} mt-3 p-4`}>
          <label htmlFor={`${uid}-link-until`} className="block">
            Condition de la boucle
          </label>
          <input
            id={`${uid}-link-until`}
            className={field}
            value={until}
            // The prompt just appeared after a link: the keyboard goes straight to its field.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the prompt the user just asked for
            autoFocus
            onChange={(e) => setUntil(e.target.value)}
          />
          <label htmlFor={`${uid}-link-max`} className="mt-3 block">
            Au plus
          </label>
          <input
            id={`${uid}-link-max`}
            type="number"
            min={1}
            max={9}
            className={field}
            value={limit || ""}
            onChange={(e) => setLimit(parseMax(e.target.value) ?? 0)}
          />
          <button
            type="button"
            disabled={until.trim() === "" || limit === 0}
            onClick={() => {
              setSteps(
                linkSteps(steps, pending.from, pending.to, until, limit),
              );
            }}
            className={`mt-3 ${button}`}
          >
            Ajouter la boucle
          </button>
          <button
            type="button"
            onClick={() => setPending(null)}
            className={`mt-3 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
      {/* Graph view: the list stays for the keyboard (visually hidden from sm up) and is the only view on a phone (decision 031 F). */}
      <StepList
        steps={steps}
        className={`mt-3 ${view === "graph" ? "sm:not-focus-within:sr-only" : ""}`}
        onMove={(key, dir) => setSteps(moveStep(steps, key, dir))}
        onSelect={select}
      />
      <p role="status" className="mt-3 empty:hidden">
        {warn && "Le TDD du CLAUDE.md du projet s'appuie sur cette étape"}
      </p>
      {openStep && (
        <StepPanel
          uid={uid}
          step={openStep}
          index={steps.indexOf(openStep)}
          steps={steps}
          freeAgents={free}
          onChange={(next) => {
            // A renamed agent keeps the loops that pointed to it, its own included.
            const rename = (name: string | null) =>
              name === openStep.agent ? next.agent : name;
            setSteps(
              steps.map((s) =>
                s === openStep
                  ? { ...next, loopTo: rename(next.loopTo) }
                  : { ...s, loopTo: rename(s.loopTo) },
              ),
            );
            setOpen(next.agent);
          }}
          onRemove={() => {
            setWarn(TDD_AGENTS.includes(openStep.agent));
            setSteps(removeStep(steps, openStep.agent));
            setOpen(null);
          }}
          canEditAgent={
            typeof agents.find((a) => a.name === openStep.agent)?.text ===
            "string"
          }
          onEditAgent={onEditAgent && (() => onEditAgent(openStep.agent))}
        />
      )}
      {view !== "graph" && addButton}
      {adding && (
        <div className={`${card} mt-3 p-4`}>
          <label htmlFor={`${uid}-step-add`} className="block">
            Agent à ajouter
          </label>
          <select
            id={`${uid}-step-add`}
            className={field}
            value={free.includes(picked) ? picked : (free[0] ?? "")}
            onChange={(e) => setPicked(e.target.value)}
          >
            {free.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={free.length === 0}
            onClick={() => {
              setSteps(
                addStep(
                  steps,
                  free.includes(picked) ? picked : (free[0] ?? ""),
                ),
              );
              setAdding(false);
            }}
            className={`mt-3 ${button}`}
          >
            Ajouter à l'équipe
          </button>
        </div>
      )}
    </>
  );
}

function Problem({ problem }: { problem: Failure }) {
  return (
    <div role="alert" className={`mt-3 ${alertBox}`}>
      <p>{message(problem)}</p>
      {problem.settingsUrl && (
        <a href={problem.settingsUrl} className={`underline ${focusRing}`}>
          Réglages de l'App sur GitHub
        </a>
      )}
    </div>
  );
}

/** Decisions 031 and 032: a team (`.claude/team.md` or `.claude/teams/<name>.md`) as a graph and a list sharing one draft, saved by a commit shown before as a diff. */
export function ProjectTeam({
  projectId,
  fullName,
  archived,
  hidden,
  agents,
  team,
  teams,
  onSaved,
  onEditAgent,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  /** While an agent form is open: the section steps aside, its draft is kept. */
  hidden: boolean;
  agents: Agent[];
  team: string | null;
  teams: { name: string; text: string }[];
  onSaved: () => void;
  onEditAgent: (name: string) => void;
}) {
  // The team shown: null is the default one. A named team that is not in `teams` yet is a new one, started from `copy`.
  const [name, setName] = useState<string | null>(null);
  const [copy, setCopy] = useState<Draft>({ steps: DEFAULT_STEPS, body: "" });
  const current =
    name === null ? team : (teams.find((t) => t.name === name)?.text ?? null);
  const initial = useMemo<Draft | null>(
    () =>
      current !== null
        ? readTeam(current)
        : name === null
          ? { steps: DEFAULT_STEPS, body: "" }
          : copy,
    [current, name, copy],
  );
  const [draft, setDraft] = useState(initial);
  const key = `${name ?? ""}:${current}`;
  const [seen, setSeen] = useState(key);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  // The canvas (decision 079) while it is open: a new team or the team shown, on its own draft started from the team as read.
  const [canvas, setCanvas] = useState<{
    draft: Draft;
    edit: boolean;
    /** The text read when the canvas opened: what a save is compared with, even after a re-read. */
    before: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // « Repartir d'une équipe de départ »: the level chosen, its agent files, and whether its buttons show.
  const queryClient = useQueryClient();
  const [starter, setStarter] = useState<{
    id: string;
    agents: StarterAgent[];
    /** Its steps: a loop already without `max` there, and unchanged, is kept (decision 079 C). */
    base: TeamStep[];
  } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const starters = useQuery(starterQuery);
  const catalog = useMemo(
    () => (starters.data ? catalogAgents(starters.data) : new Map()),
    [starters.data],
  );
  // The level asked for over unsaved changes, until « Confirmer le changement » or « Annuler ».
  const [levelSwitch, setLevelSwitch] = useState<string | null>(null);
  // Another team or a new text read (after a commit or a conflict) starts a new draft; a re-read of the same text keeps the edits.
  if (seen !== key) {
    setSeen(key);
    setDraft(initial);
    setShowDiff(false);
    setStarter(null);
  }

  const commit = useMutation({
    mutationFn: async (sent: {
      name: string | null;
      before: string | null;
      after: string | null;
      created?: Draft;
      starterTeam?: string;
      agents?: AgentChange[];
    }) => {
      const res = await client.api.projects[":id"].team.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({
              ...sent,
              name: sent.name ?? undefined,
              created: undefined,
            }),
            headers: { "content-type": "application/json" },
          },
        },
      );
      return res.ok
        ? { done: await res.json() }
        : { failure: await failure(res) };
    },
    onSuccess: (answer, { after, name: savedName, created }) => {
      if (answer.failure) {
        setProblem(answer.failure);
        if (answer.failure.code !== "repo_changed") return;
      } else {
        const { commitSha, pullRequest } = answer.done;
        setStarter(null);
        if (after === null) setName(null); // the team is gone: back to the default one
        if (created) {
          // Not in `teams` until the reload below answers: the picker and the draft start from what was sent.
          setCopy(created);
          setName(savedName);
        }
        setCanvas(null);
        setDone({
          url:
            pullRequest?.url ??
            `https://github.com/${fullName}/commit/${commitSha}`,
          pullRequest: pullRequest !== undefined,
        });
      }
      onSaved();
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });

  // A group or an id is edited on the canvas only (decision 079 F).
  const grouped = draft?.steps.some((st) => st.parallel || st.id !== undefined);
  const agentChanges =
    starter && draft ? starterChanges(starter.agents, draft.steps, agents) : [];
  const dirty =
    agentChanges.length > 0 ||
    (draft !== null &&
      initial !== null &&
      writeTeam(draft.steps, draft.body) !==
        writeTeam(initial.steps, initial.body));
  const goTo = (next: string | null) => {
    setName(next);
    setSwitchTo(null);
    setCanvas(null);
    setDeleting(false);
    setProblem(null);
    setDone(null);
    setStarter(null);
    setChoosing(false);
  };
  const chooseLevel = async (id: string) => {
    setLevelSwitch(null);
    setProblem(null);
    setDone(null);
    try {
      // Read ahead (below): the draft changes at once when the answer is already there.
      const answer =
        queryClient.getQueryData(STARTER_KEY) ??
        (await queryClient.fetchQuery(starterQuery));
      const { teams } = answer as StarterTeams;
      const chosen = teams.find((t) => t.id === id);
      const read = chosen && readTeam(chosen.team);
      if (!chosen || !read) throw new Error("starter team");
      setDraft(read);
      setStarter({
        id: chosen.id,
        agents: chosen.agents,
        base: read.steps,
      });
      setShowDiff(false);
      setChoosing(false);
    } catch {
      setProblem({ code: "", status: 0 });
    }
  };
  const viewSwitch = (
    <span className="ml-auto flex gap-1.5">
      {(["graph", "list"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => setView(v)}
          className={chip(view === v)}
        >
          {v === "graph" ? "Graphe" : "Liste"}
        </button>
      ))}
    </span>
  );
  const picker = (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <fieldset aria-label="Équipe" className="contents">
          {[
            null,
            ...(current === null && name !== null
              ? [...teams.map((t) => t.name), name]
              : teams.map((t) => t.name)),
          ].map((n) => (
            <button
              key={n ?? ""}
              type="button"
              aria-pressed={name === n}
              // A save or a removal in flight answers for the team it was sent for: no switching meanwhile.
              disabled={commit.isPending}
              onClick={() => {
                if (n === name) return;
                if (!dirty) return goTo(n);
                setCanvas(null);
                setDeleting(false);
                setLevelSwitch(null);
                setSwitchTo(n ?? "");
              }}
              className={chip(name === n)}
            >
              {n ?? "Par défaut"}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          disabled={archived || commit.isPending}
          onClick={() => {
            setSwitchTo(null);
            setDeleting(false);
            setProblem(null);
            setDone(null);
            setCanvas({
              draft: initial ?? { steps: DEFAULT_STEPS, body: "" },
              edit: false,
              before: null,
            });
          }}
          className={`${chip(false)} border-transparent`}
        >
          Nouvelle équipe
        </button>
        {initial && (
          <button
            type="button"
            disabled={archived || commit.isPending}
            onClick={() => {
              setSwitchTo(null);
              setDeleting(false);
              setProblem(null);
              setDone(null);
              setCanvas({
                draft: draft ?? initial,
                edit: true,
                before: current,
              });
            }}
            className={`${chip(false)} border-transparent`}
          >
            Modifier sur le canevas
          </button>
        )}
        {!grouped && viewSwitch}
      </div>
      {name === null && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={archived || commit.isPending}
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
            className={button}
          >
            Repartir d'une équipe de départ
          </button>
          {choosing && (
            <fieldset aria-label="Équipe de départ" className="contents">
              {STARTER_LEVELS.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  disabled={archived || commit.isPending}
                  title={level.sentence}
                  onClick={() => {
                    if (!dirty) return void chooseLevel(level.id);
                    setSwitchTo(null);
                    setLevelSwitch(level.id);
                  }}
                  className={chip(false)}
                >
                  {level.name}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {(switchTo !== null || levelSwitch !== null) && (
        <div className="mt-3">
          <p id="switch-team-warning">
            Les changements non enregistrés seront perdus
          </p>
          <button
            type="button"
            aria-describedby="switch-team-warning"
            disabled={commit.isPending}
            onClick={() =>
              levelSwitch !== null
                ? void chooseLevel(levelSwitch)
                : goTo(switchTo || null)
            }
            className={`mt-2 ${button}`}
          >
            Confirmer le changement
          </button>
          <button
            type="button"
            aria-describedby="switch-team-warning"
            // The select that asked keeps its value: focus goes to the safe choice.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
            autoFocus
            onClick={() => {
              setSwitchTo(null);
              setLevelSwitch(null);
            }}
            className={`mt-2 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
      {name !== null && current !== null && (
        <p className="mt-3">
          Pour la lancer :{" "}
          <code>
            /dev-us {"<US>"} --team {name}
          </code>
        </p>
      )}
      {canvas && (
        <TeamCanvas
          back={`‹ ${fullName} · Agents`}
          edit={canvas.edit ? (name ?? "par défaut") : undefined}
          defaultTeam={canvas.edit && name === null}
          start={canvas.draft}
          taken={teams.map((t) => t.name)}
          repo={agents}
          catalog={catalog}
          archived={archived}
          pending={commit.isPending}
          problem={problem}
          onSave={(newName, draft, added) =>
            commit.mutate(
              canvas.edit
                ? {
                    name,
                    before: canvas.before,
                    after: writeTeam(draft.steps, draft.body),
                    agents: added,
                  }
                : {
                    name: newName,
                    before: null,
                    after: writeTeam(draft.steps, draft.body),
                    created: draft,
                    agents: added,
                  },
            )
          }
          onCancel={() => {
            setCanvas(null);
            setProblem(null);
          }}
        />
      )}
    </>
  );
  const deleteBlock = (
    <>
      {deleting && (
        <div className="mt-3">
          <p id="delete-team-warning">
            L'équipe sera retirée du repo par un commit
          </p>
          <button
            type="button"
            aria-describedby="delete-team-warning"
            disabled={archived || commit.isPending}
            onClick={() => {
              setProblem(null);
              setDone(null);
              setDeleting(false);
              commit.mutate({ name, before: current, after: null });
            }}
            className={`mt-2 ${dangerButton}`}
          >
            Confirmer la suppression
          </button>
          <button
            type="button"
            aria-describedby="delete-team-warning"
            // The button that asked is gone: keep the keyboard focus on the safe choice.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
            autoFocus
            onClick={() => setDeleting(false)}
            className={`mt-2 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
    </>
  );
  const heading = (
    <h2 id="team" className="sr-only">
      Équipe
    </h2>
  );
  if (!draft)
    return (
      <section aria-labelledby="team" hidden={hidden} className="contents">
        {heading}
        <div className="lg:col-span-2">{picker}</div>
        <div className="min-w-0">
          {deleteBlock}
          <p className="mt-3">
            {name === null ? "Ce team.md contient" : "Cette équipe contient"}{" "}
            des lignes que Cockpit ne sait pas réécrire : modifie-le sur GitHub
          </p>
        </div>
      </section>
    );

  const { steps, body } = draft;
  const after = writeTeam(steps, body);
  // Compared with the draft as opened, not the file text: a file Cockpit would only reformat is not a change. Without a file the default steps are still worth a commit.
  const unchanged =
    current !== null &&
    initial !== null &&
    after === writeTeam(initial.steps, initial.body) &&
    agentChanges.length === 0;
  const lines = showDiff ? diffLines(current ?? "", after) : null;
  const canCommit =
    !archived &&
    !commit.isPending &&
    !unchanged &&
    steps.length > 0 &&
    steps.every((s) => s.loopTo === null || s.until.trim() !== "") &&
    // A loop without `max` stays only if the base has the same one: same place, same return, same condition (a renamed agent is the same step).
    steps.every((s, i) => {
      const base = starter?.base ?? initial?.steps ?? [];
      const target = (list: TeamStep[], t: TeamStep) =>
        list.findIndex((x) => x.agent === t.loopTo);
      const was = base[i];
      return (
        s.loopTo === null ||
        s.max !== undefined ||
        (was?.loopTo != null &&
          was.max === undefined &&
          was.until === s.until &&
          target(base, was) === target(steps, s))
      );
    });
  return (
    // `contents`: the chips span the page, the editor and the commit row are the left column of the grid of ProjectAgents.
    <section aria-labelledby="team" hidden={hidden} className="contents">
      {heading}
      <div className="lg:col-span-2">{picker}</div>
      <div className="min-w-0">
        {grouped ? (
          <p className="mt-3">
            Cette équipe a des étapes en parallèle : modifie-la sur le canevas.
          </p>
        ) : (
          <StepEditor
            key={key}
            steps={steps}
            onSteps={(next) => setDraft({ steps: next, body })}
            agents={agents}
            archived={archived}
            view={view}
            onEditAgent={onEditAgent}
          />
        )}
        {problem && !canvas && <Problem problem={problem} />}
        {done && (
          <div className="mt-3 rounded-[14px] border border-border bg-raised p-4 text-foreground">
            <p>
              {done.pullRequest
                ? "La branche par défaut est protégée : une pull request est ouverte"
                : "C'est fait"}
            </p>
            <a href={done.url} className={`underline ${focusRing}`}>
              {done.pullRequest ? "Voir la pull request" : "Voir le commit"}
            </a>
          </div>
        )}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canCommit}
            onClick={() => {
              setProblem(null);
              setDone(null);
              commit.mutate({
                name,
                before: current,
                after,
                ...(starter && {
                  starterTeam: starter.id,
                  agents: agentChanges,
                }),
              });
            }}
            className={primaryButton}
          >
            Faire le commit
          </button>
          <span className="text-[12.5px] text-muted-foreground">
            Écrit dans{" "}
            {name === null ? ".claude/team.md" : `.claude/teams/${name}.md`}
          </span>
          <button
            type="button"
            disabled={unchanged}
            onClick={() => setShowDiff(true)}
            className={ghostButton}
          >
            Voir les changements
          </button>
          {name !== null && current !== null && !deleting && (
            <button
              type="button"
              disabled={archived || commit.isPending}
              onClick={() => {
                setSwitchTo(null);
                setCanvas(null);
                setDeleting(true);
              }}
              className={ghostButton}
            >
              Supprimer l'équipe
            </button>
          )}
        </div>
        {deleteBlock}
        {showDiff &&
          (lines ? (
            <DiffList lines={lines} />
          ) : (
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm">
              {after}
            </pre>
          ))}
        {showDiff &&
          agentChanges.map((c) => (
            <div key={c.name}>
              <p className="mt-3 font-mono text-[12.5px]">
                .claude/agents/{c.name}.md
              </p>
              {(() => {
                const agentLines = diffLines(c.before ?? "", c.after);
                return agentLines ? (
                  <DiffList lines={agentLines} />
                ) : (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm">
                    {c.after}
                  </pre>
                );
              })()}
            </div>
          ))}
      </div>
    </section>
  );
}
