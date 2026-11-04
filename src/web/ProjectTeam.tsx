import { useMutation } from "@tanstack/react-query";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { parseAgent } from "./agent-file.ts";
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

const SESSION_MODEL = "Celui de la session";
const TDD_AGENTS = ["test-writer", "reviewer"];
const COLUMN = 280;

type Agent = { name: string; text: string | null };
type Draft = { steps: TeamStep[]; body: string };
type Done = { url: string; pullRequest: boolean };
type CardData = {
  step: TeamStep;
  model: string | null;
  absent: boolean;
  onOpen: () => void;
};
type CardNode = Node<CardData, "card">;

function StepCard({ data }: NodeProps<CardNode>) {
  const { step, model, absent, onOpen } = data;
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Bottom} id="loop-in" />
      <Handle type="source" position={Position.Bottom} id="loop-out" />
      <button
        type="button"
        data-testid={`team-card-${step.agent}`}
        onClick={onOpen}
        className={`${card} block w-60 p-3 text-left ${focusRing}`}
      >
        <span className="block font-mono font-semibold">{step.agent}</span>
        <span className="block text-sm text-muted-foreground">
          {absent ? "Agent absent du repo" : (model ?? SESSION_MODEL)}
        </span>
        <span className="mt-1 block text-sm">{step.does}</span>
      </button>
    </>
  );
}

const nodeTypes = { card: StepCard };

function edgesOf(steps: TeamStep[], selected: string | null): Edge[] {
  return steps.flatMap((s, i) => [
    ...(i > 0
      ? [
          {
            id: `next-${s.agent}`,
            source: steps[i - 1]?.agent as string,
            target: s.agent,
            sourceHandle: "out",
            targetHandle: "in",
            label: "puis",
            selectable: false,
          },
        ]
      : []),
    ...(s.loopTo !== null
      ? [
          {
            id: `loop-${s.agent}`,
            source: s.agent,
            target: s.loopTo,
            sourceHandle: "loop-out",
            targetHandle: "loop-in",
            label: `boucle : ${s.until}`,
            style: { strokeDasharray: "6 4" },
            selected: selected === s.agent,
          },
        ]
      : []),
  ]);
}

function StepGraph({
  steps,
  agents,
  selectedLoop,
  onOpen,
  onLink,
  onSelectLoop,
}: {
  steps: TeamStep[];
  agents: Agent[];
  selectedLoop: string | null;
  onOpen: (agent: string) => void;
  onLink: (from: string, to: string) => void;
  onSelectLoop: (agent: string | null) => void;
}) {
  const laidOut = useMemo(
    () =>
      steps.map((step, i): CardNode => {
        const text = agents.find((a) => a.name === step.agent)?.text;
        return {
          id: step.agent,
          type: "card",
          position: { x: i * COLUMN, y: 0 },
          // Known size: React Flow draws the card without waiting for a measure.
          width: 240,
          height: 110,
          data: {
            step,
            model: (text && parseAgent(text)?.model) || null,
            absent: !agents.some((a) => a.name === step.agent),
            onOpen: () => onOpen(step.agent),
          },
        };
      }),
    [steps, agents, onOpen],
  );
  // A card moved by hand is only for reading: any change of the draft puts them back in place.
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  useEffect(() => setNodes(laidOut), [laidOut, setNodes]);
  return (
    <div className="mt-3 hidden h-72 sm:block">
      <ReactFlow
        nodes={nodes}
        edges={edgesOf(steps, selectedLoop)}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={({ source, target }: Connection) => onLink(source, target)}
        onEdgeClick={(_, edge) =>
          onSelectLoop(edge.id.startsWith("loop-") ? edge.source : null)
        }
        onPaneClick={() => onSelectLoop(null)}
        nodesConnectable
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function StepPanel({
  step,
  index,
  steps,
  freeAgents,
  onChange,
  onRemove,
  onEditAgent,
}: {
  step: TeamStep;
  index: number;
  steps: TeamStep[];
  freeAgents: string[];
  onChange: (next: TeamStep) => void;
  onRemove: () => void;
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
        <button type="button" onClick={onEditAgent} className={button}>
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
  const [showDiff, setShowDiff] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // A new text read (after a commit or a conflict) starts a new draft; a re-read of the same text keeps the edits.
  if (seen !== team) {
    setSeen(team);
    setDraft(initial);
    setOpen(null);
    setShowDiff(false);
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
  const setSteps = (next: TeamStep[]) => setDraft({ steps: next, body });
  const free = agents
    .map((a) => a.name)
    .filter((name) => !steps.some((s) => s.agent === name));
  const openStep = steps.find((s) => s.agent === open);
  const after = writeTeam(steps, body);
  const unchanged = after === (team ?? "");
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
  const select = (agent: string) => {
    setAdding(false);
    setOpen(agent);
  };

  return (
    <section className="mt-6" aria-labelledby="team" hidden={hidden}>
      {heading}
      <StepGraph
        steps={steps}
        agents={agents}
        selectedLoop={selectedLoop}
        onOpen={select}
        onLink={link}
        onSelectLoop={setSelectedLoop}
      />
      {selectedLoop !== null && (
        <button
          type="button"
          onClick={() => {
            setSteps(
              steps.map((s) =>
                s.agent === selectedLoop
                  ? { ...s, loopTo: null, until: "" }
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
          <label htmlFor="link-until" className="block">
            Condition de la boucle
          </label>
          <input
            id="link-until"
            className={field}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
          <button
            type="button"
            disabled={until.trim() === ""}
            onClick={() => {
              setSteps(linkSteps(steps, pending.from, pending.to, until));
              setPending(null);
            }}
            className={`mt-3 ${button}`}
          >
            Ajouter la boucle
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
                disabled={i === 0}
                onClick={() => setSteps(moveStep(steps, s.agent, "up"))}
                className={button}
              >
                Monter
              </button>
              <button
                type="button"
                disabled={i === steps.length - 1}
                onClick={() => setSteps(moveStep(steps, s.agent, "down"))}
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
      {warn && (
        <p className="mt-3">
          Le TDD du CLAUDE.md du projet s'appuie sur cette étape
        </p>
      )}
      {openStep && (
        <StepPanel
          // One panel per step, so its fields never show another step's values.
          key={openStep.agent}
          step={openStep}
          index={steps.indexOf(openStep)}
          steps={steps}
          freeAgents={free}
          onChange={(next) => {
            setSteps(
              steps.map((s) =>
                s === openStep
                  ? next
                  : s.loopTo === openStep.agent
                    ? { ...s, loopTo: next.agent }
                    : s,
              ),
            );
            setOpen(next.agent);
          }}
          onRemove={() => {
            setWarn(TDD_AGENTS.includes(openStep.agent));
            setSteps(removeStep(steps, openStep.agent));
            setOpen(null);
          }}
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
