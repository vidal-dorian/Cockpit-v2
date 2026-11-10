import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ProjectGlobalTeams } from "./AgentTeams.tsx";
import { type AgentFields, parseAgent, writeAgent } from "./agent-file.ts";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import {
  ClaudeChips,
  FILES,
  fetchClaudeConfig,
  ProjectClaudeConfig,
} from "./ProjectClaudeConfig.tsx";
import { type Failure, failure, message } from "./ProjectPrepare.tsx";
import { ProjectTeam } from "./ProjectTeam.tsx";
import {
  alertBox,
  button,
  card,
  dangerButton,
  field,
  focusRing,
  ghostButton,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const SESSION_MODEL = "Celui de la session";
const MODELS = ["sonnet", "opus", "haiku", "fable"];
// The name must fit `.claude/agents/<name>.md` in 255 characters (decision 026 D).
const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAME = 237;

// Decision 051 L: the agents of the analysis have their own section, in this order.
const ANALYSIS_AGENTS = [
  "cartographer",
  "rules-analyst",
  "bug-hunter",
  "security-reviewer",
  "architect",
  "upgrade-advisor",
];

/** An agent being edited: `before` is the text read (null for an addition), `base` the text the form starts from. */
export type Editing = { name: string; before: string | null; base: string };
type Done = { url: string; pullRequest: boolean };

export async function fetchAgents(id: string) {
  const res = await client.api.projects[":id"].agents.$get({ param: { id } });
  if (!res.ok) return { failure: await failure(res) };
  return { data: await res.json() };
}

export function AgentForm({
  editing,
  path,
  archived,
  pending,
  onCommit,
  onClose,
}: {
  editing: Editing;
  /** The file the form writes, shown beside the diff. */
  path: string;
  archived: boolean;
  pending: boolean;
  onCommit: (after: string | null) => void;
  onClose: () => void;
}) {
  const { name, before, base } = editing;
  const initial = parseAgent(base);
  const [fields, setFields] = useState<AgentFields | null>(initial);
  const [confirming, setConfirming] = useState(false);
  const after = useMemo(
    () => (fields ? writeAgent(base, fields) : base),
    [base, fields],
  );
  const lines = useMemo(() => diffLines(before ?? "", after), [before, after]);
  const set = (key: keyof AgentFields) => (value: string) =>
    setFields((current) => current && { ...current, [key]: value });

  const label = "block text-[13px] font-semibold";
  return (
    <div className="mt-2">
      <h3 className="font-mono font-semibold">{name}</h3>
      {fields && initial ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3.5">
            <div>
              <label htmlFor="agent-description" className={label}>
                Description
              </label>
              <input
                id="agent-description"
                className={`${field} min-h-[38px]`}
                value={fields.description}
                onChange={(e) => set("description")(e.target.value)}
              />
              <small className="text-[12.5px] text-muted-foreground">
                Claude s'en sert pour choisir quand appeler cet agent.
              </small>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="agent-model" className={label}>
                  Modèle
                </label>
                <select
                  id="agent-model"
                  className={`${field} min-h-[38px]`}
                  value={fields.model}
                  onChange={(e) => set("model")(e.target.value)}
                >
                  <option value="">{SESSION_MODEL}</option>
                  {[
                    ...MODELS,
                    ...(initial.model && !MODELS.includes(initial.model)
                      ? [initial.model]
                      : []),
                  ].map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="agent-tools" className={label}>
                  Outils
                </label>
                <input
                  id="agent-tools"
                  className={`${field} min-h-[38px]`}
                  value={fields.tools}
                  onChange={(e) => set("tools")(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="agent-prompt" className={label}>
                Consigne
              </label>
              <textarea
                id="agent-prompt"
                rows={10}
                className={`${field} min-h-[230px] font-mono text-[12.5px] leading-[1.6]`}
                value={fields.prompt}
                onChange={(e) => set("prompt")(e.target.value)}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className={sectionLabel}>Le fichier qui sera écrit</span>
            {lines ? (
              <DiffList lines={lines} />
            ) : (
              <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                {after}
              </pre>
            )}
            <span className="text-[12.5px] text-muted-foreground">{path}</span>
          </div>
        </div>
      ) : (
        <p className="mt-2">
          L'en-tête de ce fichier n'est pas lisible par Cockpit : modifie-le sur
          GitHub
        </p>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {fields && initial && (
          <button
            type="button"
            disabled={
              archived ||
              pending ||
              fields.description.trim() === "" ||
              after === before
            }
            aria-busy={pending}
            onClick={() => onCommit(after)}
            className={primaryButton}
          >
            Faire le commit
          </button>
        )}
        <button type="button" onClick={onClose} className={ghostButton}>
          Annuler
        </button>
        {before !== null && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <p id="delete-agent-warning">
                  Le fichier sera retiré du repo par un commit
                </p>
                <button
                  type="button"
                  aria-describedby="delete-agent-warning"
                  disabled={archived || pending}
                  aria-busy={pending}
                  onClick={() => onCommit(null)}
                  className={dangerButton}
                >
                  Confirmer la suppression
                </button>
                <button
                  type="button"
                  aria-describedby="delete-agent-warning"
                  // The button that asked is gone: keep the keyboard focus on the safe choice.
                  // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                  autoFocus
                  onClick={() => setConfirming(false)}
                  className={button}
                >
                  Annuler
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={archived || pending}
                aria-busy={pending}
                onClick={() => setConfirming(true)}
                className={ghostButton}
              >
                Supprimer l'agent
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function AddAgent({
  taken,
  catalog,
  onContinue,
}: {
  taken: string[];
  catalog: { name: string; text: string }[];
  onContinue: (name: string, start: string) => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const isTaken = taken.includes(name);
  const validName = AGENT_NAME.test(name) && name.length <= MAX_NAME;
  const valid = validName && !isTaken;
  return (
    <div className={`${card} mt-4 p-4`}>
      <label htmlFor="agent-name" className="block">
        Nom de l'agent
      </label>
      <input
        id="agent-name"
        className={field}
        value={name}
        maxLength={MAX_NAME}
        onChange={(e) => setName(e.target.value)}
      />
      {isTaken && <p className="mt-1">Ce nom est déjà pris</p>}
      {name !== "" && !validName && (
        <p className="mt-1">
          Le nom ne contient que a-z, 0-9 et -, et ne commence pas par -
        </p>
      )}
      <label htmlFor="agent-start" className="mt-3 block">
        Point de départ
      </label>
      <select
        id="agent-start"
        className={field}
        value={start}
        onChange={(e) => setStart(e.target.value)}
      >
        <option value="">Vide</option>
        {catalog.map((agent) => (
          <option key={agent.name}>{agent.name}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          const text = catalog.find((a) => a.name === start)?.text;
          onContinue(
            name,
            text?.replace(/^name:.*$/m, `name: ${name}`) ??
              `---\nname: ${name}\ndescription: ""\n---\n`,
          );
        }}
        className={`mt-3 ${button}`}
      >
        Continuer
      </button>
    </div>
  );
}

/** Decision 030: the tab « Agents », the files of `.claude/agents` listed, edited, added and removed, each save being a commit shown before as a diff. */
export function ProjectAgents({
  projectId,
  fullName,
  archived,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => fetchAgents(projectId),
    retry: false,
  });
  // Decision 065 D: the chips of what Claude reads; Agents, the tab as it was, is the one without parameter.
  const config = useQuery({
    queryKey: ["claude-config", projectId],
    queryFn: () => fetchClaudeConfig(projectId),
    retry: false,
  });
  const param = useSearchParams()[0].get("fichier");
  const fichier = FILES.find((f) => f === param) ?? null;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ["agents", projectId] });

  const commit = useMutation({
    mutationFn: async (sent: {
      before: string | null;
      after: string | null;
    }) => {
      const res = await client.api.projects[":id"].agents.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({ name: editing?.name, ...sent }),
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
      setEditing(null);
      return reload();
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });

  const failed =
    agents.data?.failure ??
    (agents.isError ? { code: "", status: 0 } : undefined);
  const list = agents.data?.data;
  const agentRow = (agent: { name: string; text: string | null }) => {
    const fields = agent.text === null ? null : parseAgent(agent.text);
    return (
      <li key={agent.name} className="min-h-[50px]">
        <button
          type="button"
          aria-label={`Ouvrir ${agent.name}`}
          disabled={agent.text === null}
          onClick={() => {
            setProblem(null);
            setDone(null);
            setAdding(false);
            setEditing(
              agent.text === null
                ? null
                : {
                    name: agent.name,
                    before: agent.text,
                    base: agent.text,
                  },
            );
          }}
          className={`flex min-h-[50px] w-full flex-col justify-center px-[18px] py-2 text-left hover:bg-raised disabled:opacity-50 ${focusRing}`}
        >
          <span className="font-semibold">{agent.name}</span>
          <span className="text-[12.5px] text-muted-foreground">
            <span className="capitalize">
              {agent.text === null
                ? "Fichier trop gros"
                : (fields?.model ?? "En-tête illisible") || SESSION_MODEL}
            </span>
            {fields && ` · ${fields.tools.trim() || "tous les outils"}`}
          </span>
        </button>
      </li>
    );
  };
  const analysis = ANALYSIS_AGENTS.flatMap(
    (name) => list?.agents.find((a) => a.name === name) ?? [],
  );
  const team = (list?.agents ?? []).filter(
    (a) => !ANALYSIS_AGENTS.includes(a.name),
  );
  const chips = (
    <ClaudeChips
      projectId={projectId}
      fichier={fichier}
      counts={{
        rules: config.data?.data?.rules.length,
        skills: config.data?.data?.skills.length,
        agents: list?.agents.length,
      }}
    />
  );
  if (fichier)
    return (
      <>
        {chips}
        <ProjectClaudeConfig
          // Each chip starts from nothing: no open rule, form or message of the previous one.
          key={fichier}
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          fichier={fichier}
          config={config}
        />
      </>
    );
  return (
    <>
      {chips}
      {/* Team (graph) on the left, repo agents on the right from `lg` (decision 042 B); the agents take the full width while a form is open and the team steps aside. */}
      <div className="mx-[26px] mt-4 grid gap-x-3.5 gap-y-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        {list && (
          <ProjectTeam
            projectId={projectId}
            fullName={fullName}
            archived={archived}
            hidden={editing !== null}
            agents={list.agents}
            team={list.team ?? null}
            teams={list.teams ?? []}
            onSaved={reload}
            onEditAgent={(name) => {
              const text = list.agents.find((a) => a.name === name)?.text;
              if (text === undefined || text === null) return;
              setProblem(null);
              setDone(null);
              setAdding(false);
              setEditing({ name, before: text, base: text });
            }}
          />
        )}
        <section
          className={list && !editing ? undefined : "lg:col-span-2"}
          aria-labelledby="agents"
        >
          <h2 id="agents" className={editing ? "sr-only" : sectionLabel}>
            Les agents du repo
          </h2>
          {agents.isPending && (
            <p className="loading mt-3 text-muted-foreground">Chargement…</p>
          )}
          {failed && (
            <div role="alert" className={`mt-3 ${alertBox}`}>
              <p>{message(failed)}</p>
            </div>
          )}
          {problem && (
            <div role="alert" className={`mt-3 ${alertBox}`}>
              <p>{message(problem)}</p>
              {problem.settingsUrl && (
                <a
                  href={problem.settingsUrl}
                  className={`underline ${focusRing}`}
                >
                  Réglages de l'App sur GitHub
                </a>
              )}
            </div>
          )}
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
          {list && !editing && (
            <>
              <ul className={`mt-2 ${listCard}`}>{team.map(agentRow)}</ul>
              <button
                type="button"
                disabled={archived}
                onClick={() => {
                  setEditing(null);
                  setAdding(true);
                }}
                className={`mt-2 ${button}`}
              >
                + Nouvel agent
              </button>
              {adding && (
                <AddAgent
                  taken={list.agents.map((agent) => agent.name)}
                  catalog={list.catalog}
                  onContinue={(name, base) => {
                    setProblem(null);
                    setDone(null);
                    setAdding(false);
                    setEditing({ name, before: null, base });
                  }}
                />
              )}
            </>
          )}
          {editing && (
            <AgentForm
              // The text too: opening an agent again after a re-read starts from the new text, not from stale fields.
              key={`${editing.name}\n${editing.before}`}
              editing={editing}
              path={`.claude/agents/${editing.name}.md`}
              archived={archived}
              pending={commit.isPending}
              onClose={() => setEditing(null)}
              onCommit={(after) => {
                setProblem(null);
                commit.mutate({ before: editing.before, after });
              }}
            />
          )}
        </section>
        {list && !editing && (
          <ProjectGlobalTeams
            projectId={projectId}
            fullName={fullName}
            archived={archived}
            repoTeams={list.teams ?? []}
          />
        )}
        {list && !editing && analysis.length > 0 && (
          <section className="lg:col-span-2" aria-labelledby="analysis-agents">
            <h2 id="analysis-agents" className={sectionLabel}>
              Agents d'analyse
            </h2>
            <ul className={`mt-2 ${listCard}`}>{analysis.map(agentRow)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
