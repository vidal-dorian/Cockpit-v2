import { useMutation } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { type Failure, failure, message } from "./ProjectPrepare.tsx";
import {
  addStep,
  DEFAULT_STEPS,
  linkSteps,
  moveStep,
  readTeam,
  removeStep,
  type TeamStep,
  writeTeam,
} from "./team-file.ts";
import {
  alertBox,
  button,
  card,
  field,
  focusRing,
  primaryButton,
} from "./ui.ts";

// React Flow stays out of the main bundle, as react-markdown does (App.tsx); the list below works while it loads.
const StepGraph = lazy(() => import("./ProjectTeamGraph.tsx"));

const TDD_AGENTS = ["test-writer", "reviewer"];

type Agent = { name: string; text: string | null };
type Draft = { steps: TeamStep[]; body: string };
type Done = { url: string; pullRequest: boolean };
function StepPanel({
  step,
  index,
  steps,
  freeAgents,
  onChange,
  onRemove,
  canEditAgent,
  onEditAgent,
}: {
  step: TeamStep;
  index: number;
  steps: TeamStep[];
  freeAgents: string[];
  onChange: (next: TeamStep) => void;
  onRemove: () => void;
  canEditAgent: boolean;
  onEditAgent: () => void;
}) {
  return (
    <div className={`${card} mt-4 p-4`}>
      <h3 className="font-mono font-semibold">{step.agent}</h3>
      <label htmlFor="step-agent" className="mt-3 block">
        Agent
      </label>
      <select
        id="step-agent"
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
      <label htmlFor="step-does" className="mt-3 block">
        Ce qu'il fait
      </label>
      <input
        id="step-does"
        className={field}
        value={step.does}
        onChange={(e) => onChange({ ...step, does: e.target.value })}
      />
      <label htmlFor="step-loop" className="mt-3 block">
        Boucle
      </label>
      <select
        id="step-loop"
        className={field}
        value={step.loopTo ?? ""}
        onChange={(e) =>
          onChange({
            ...step,
            loopTo: e.target.value || null,
            until: e.target.value ? step.until : "",
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
          <label htmlFor="step-until" className="mt-3 block">
            Condition
          </label>
          <input
            id="step-until"
            className={field}
            value={step.until}
            onChange={(e) => onChange({ ...step, until: e.target.value })}
          />
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onRemove} className={button}>
          Retirer l'étape
        </button>
        <button
          type="button"
          disabled={!canEditAgent}
          onClick={onEditAgent}
          className={button}
        >
          Modifier l'agent
        </button>
      </div>
    </div>
  );
}

/** Decision 031: the team of `.claude/team.md` as a graph and a list sharing one draft, saved by a commit shown before as a diff. */
export function ProjectTeam({
  projectId,
  fullName,
  archived,
  hidden,
  agents,
  team,
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
  onSaved: () => void;
  onEditAgent: (name: string) => void;
}) {
  const initial = useMemo<Draft | null>(
    () => (team === null ? { steps: DEFAULT_STEPS, body: "" } : readTeam(team)),
    [team],
  );
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(team);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState("");
  const [pending, setPending] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [until, setUntil] = useState("");
  const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [moved, setMoved] = useState<{ agent: string; dir: "up" | "down" }>();
  const [showDiff, setShowDiff] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // A new text read (after a commit or a conflict) starts a new draft; a re-read of the same text keeps the edits.
  if (seen !== team) {
    setSeen(team);
    setDraft(initial);
    setOpen(null);
    setShowDiff(false);
    setPending(null);
    setSelectedLoop(null);
    setAdding(false);
    setWarn(false);
  }

  const commit = useMutation({
    mutationFn: async (after: string) => {
      const res = await client.api.projects[":id"].team.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({ before: team, after }),
            headers: { "content-type": "application/json" },
          },
        },
      );
      return res.ok
        ? { done: await res.json() }
        : { failure: await failure(res) };
    },
    onSuccess: (answer) => {
      if (answer.failure) {
        setProblem(answer.failure);
        if (answer.failure.code !== "repo_changed") return;
      } else {
        const { commitSha, pullRequest } = answer.done;
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

  // A moved row's DOM node is reinserted, which drops the focus: put it back on the button that was used (or its sibling at the end of the list).
  useEffect(() => {
    if (!moved) return;
    const at = (dir: string) =>
      document.getElementById(
        `move-${dir}-${moved.agent}`,
      ) as HTMLButtonElement | null;
    const other = moved.dir === "up" ? "down" : "up";
    const target = at(moved.dir)?.disabled ? at(other) : at(moved.dir);
    target?.focus();
  }, [moved]);

  const heading = (
    <h2 id="team" className="font-heading text-xl font-bold">
      Équipe
    </h2>
  );
  if (!draft)
    return (
      <section className="mt-6" aria-labelledby="team" hidden={hidden}>
        {heading}
        <p className="mt-3">
          Ce team.md contient des lignes que Cockpit ne sait pas réécrire :
          modifie-le sur GitHub
        </p>
      </section>
    );

  const { steps, body } = draft;
  // Any change other than the pending link itself drops the link prompt: it was about the old order.
  const setSteps = (next: TeamStep[]) => {
    setPending(null);
    setDraft({ steps: next, body });
  };
  const free = agents
    .map((a) => a.name)
    .filter((name) => !steps.some((s) => s.agent === name));
  const openStep = steps.find((s) => s.agent === open);
  const after = writeTeam(steps, body);
  // Compared with the draft as opened, not the file text: a file Cockpit would only reformat is not a change. Without a file the default steps are still worth a commit.
  const unchanged =
    team !== null &&
    initial !== null &&
    after === writeTeam(initial.steps, initial.body);
  const lines = showDiff ? diffLines(team ?? "", after) : null;
  const canCommit =
    !archived &&
    !commit.isPending &&
    !unchanged &&
    steps.length > 0 &&
    steps.every((s) => s.loopTo === null || s.until.trim() !== "");
  const link = (from: string, to: string) => {
    const toIndex = steps.findIndex((s) => s.agent === to);
    if (toIndex <= steps.findIndex((s) => s.agent === from)) {
      setUntil("");
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

  return (
    <section className="mt-6" aria-labelledby="team" hidden={hidden}>
      {heading}
      <Suspense
        fallback={
          <p role="status" className="hidden text-muted-foreground sm:block">
            Chargement du graphe…
          </p>
        }
      >
        <StepGraph
          steps={steps}
          agents={agents}
          selectedLoop={loopShown}
          onOpen={select}
          onLink={link}
          onSelectLoop={setSelectedLoop}
        />
      </Suspense>
      {loopShown !== null && (
        <button
          type="button"
          onClick={() => {
            setSteps(
              steps.map((s) =>
                s.agent === loopShown ? { ...s, loopTo: null, until: "" } : s,
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
          <label htmlFor="link-until" className="block">
            Condition de la boucle
          </label>
          <input
            id="link-until"
            className={field}
            value={until}
            // The prompt just appeared after a link: the keyboard goes straight to its field.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the prompt the user just asked for
            autoFocus
            onChange={(e) => setUntil(e.target.value)}
          />
          <button
            type="button"
            disabled={until.trim() === ""}
            onClick={() => {
              setDraft({
                steps: linkSteps(steps, pending.from, pending.to, until),
                body,
              });
              setPending(null);
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
      <ul className="mt-3 grid gap-2">
        {steps.map((s, i) => (
          <li
            key={s.agent}
            className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 p-4`}
          >
            <span className="font-semibold">{i + 1}</span>{" "}
            <span className="font-mono font-semibold">{s.agent}</span>{" "}
            <span>{s.does}</span>
            {s.loopTo !== null && (
              <span className="text-muted-foreground">
                Boucle vers {s.loopTo} : {s.until}
              </span>
            )}
            <span className="flex gap-2 sm:ml-auto">
              <button
                type="button"
                id={`move-up-${s.agent}`}
                disabled={i === 0}
                onClick={() => {
                  setSteps(moveStep(steps, s.agent, "up"));
                  setMoved({ agent: s.agent, dir: "up" });
                }}
                className={button}
              >
                Monter
              </button>
              <button
                type="button"
                id={`move-down-${s.agent}`}
                disabled={i === steps.length - 1}
                onClick={() => {
                  setSteps(moveStep(steps, s.agent, "down"));
                  setMoved({ agent: s.agent, dir: "down" });
                }}
                className={button}
              >
                Descendre
              </button>
              <button
                type="button"
                onClick={() => select(s.agent)}
                className={button}
              >
                Modifier
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-3 empty:hidden">
        {warn && "Le TDD du CLAUDE.md du projet s'appuie sur cette étape"}
      </p>
      {openStep && (
        <StepPanel
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
          onEditAgent={() => onEditAgent(openStep.agent)}
        />
      )}
      <button
        type="button"
        disabled={archived}
        onClick={() => {
          setOpen(null);
          setAdding(true);
        }}
        className={`mt-3 ${button}`}
      >
        Ajouter une étape
      </button>
      {adding && (
        <div className={`${card} mt-3 p-4`}>
          <label htmlFor="step-add" className="block">
            Agent à ajouter
          </label>
          <select
            id="step-add"
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
      {problem && (
        <div role="alert" className={`mt-3 ${alertBox}`}>
          <p>{message(problem)}</p>
          {problem.settingsUrl && (
            <a href={problem.settingsUrl} className={`underline ${focusRing}`}>
              Réglages de l'App sur GitHub
            </a>
          )}
        </div>
      )}
      {done && (
        <div className="mt-3 rounded-xl bg-done-soft p-4 text-done-text">
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
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={unchanged}
          onClick={() => setShowDiff(true)}
          className={button}
        >
          Voir les changements
        </button>
        <button
          type="button"
          disabled={!canCommit}
          onClick={() => {
            setProblem(null);
            setDone(null);
            commit.mutate(after);
          }}
          className={primaryButton}
        >
          Faire le commit
        </button>
      </div>
      {showDiff &&
        (lines ? (
          <DiffList lines={lines} />
        ) : (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm">
            {after}
          </pre>
        ))}
    </section>
  );
}
