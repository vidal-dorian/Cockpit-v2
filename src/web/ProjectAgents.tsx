import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { type AgentFields, parseAgent, writeAgent } from "./agent-file.ts";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { type Failure, failure, message } from "./ProjectPrepare.tsx";
import { ProjectTeam } from "./ProjectTeam.tsx";
import {
  alertBox,
  button,
  card,
  dangerButton,
  field,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const SESSION_MODEL = "Celui de la session";
const MODELS = ["sonnet", "opus", "haiku", "fable"];
// The name must fit `.claude/agents/<name>.md` in 255 characters (decision 026 D).
const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAME = 237;

/** An agent being edited: `before` is the text read (null for an addition), `base` the text the form starts from. */
type Editing = { name: string; before: string | null; base: string };
type Done = { url: string; pullRequest: boolean };

async function fetchAgents(id: string) {
  const res = await client.api.projects[":id"].agents.$get({ param: { id } });
  if (!res.ok) return { failure: await failure(res) };
  return { data: await res.json() };
}

function AgentForm({
  editing,
  archived,
  pending,
  onCommit,
}: {
  editing: Editing;
  archived: boolean;
  pending: boolean;
  onCommit: (after: string | null) => void;
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

  return (
    <div className={`${card} mt-4 p-4`}>
      <h3 className="font-mono font-semibold">{name}</h3>
      {fields && initial ? (
        <>
          <label htmlFor="agent-description" className="mt-3 block">
            Description
          </label>
          <input
            id="agent-description"
            className={field}
            value={fields.description}
            onChange={(e) => set("description")(e.target.value)}
          />
          <label htmlFor="agent-tools" className="mt-3 block">
            Outils
          </label>
          <input
            id="agent-tools"
            className={field}
            value={fields.tools}
            onChange={(e) => set("tools")(e.target.value)}
          />
          <label htmlFor="agent-model" className="mt-3 block">
            Modèle
          </label>
          <select
            id="agent-model"
            className={field}
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
          <label htmlFor="agent-prompt" className="mt-3 block">
            Prompt
          </label>
          <textarea
            id="agent-prompt"
            rows={8}
            className={`${field} font-mono`}
            value={fields.prompt}
            onChange={(e) => set("prompt")(e.target.value)}
          />
          {lines ? (
            <DiffList lines={lines} />
          ) : (
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm">
              {after}
            </pre>
          )}
          <button
            type="button"
            disabled={
              archived ||
              pending ||
              fields.description.trim() === "" ||
              after === before
            }
            onClick={() => onCommit(after)}
            className={`mt-3 ${primaryButton}`}
          >
            Faire le commit
          </button>
        </>
      ) : (
        <p className="mt-2">
          L'en-tête de ce fichier n'est pas lisible par Cockpit : modifie-le sur
          GitHub
        </p>
      )}
      {before !== null && (
        <div className="mt-3">
          {confirming ? (
            <>
              <p id="delete-agent-warning">
                Le fichier sera retiré du repo par un commit
              </p>
              <button
                type="button"
                aria-describedby="delete-agent-warning"
                disabled={archived || pending}
                onClick={() => onCommit(null)}
                className={`mt-2 ${dangerButton}`}
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
                className={`mt-2 ml-2 ${button}`}
              >
                Annuler
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={archived || pending}
              onClick={() => setConfirming(true)}
              className={button}
            >
              Supprimer l'agent
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddAgent({
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
  return (
    // Team (graph) on the left, repo agents on the right from `lg` (decision 042 B); the agents take the full width while a form is open and the team steps aside.
    <div className="mx-[26px] mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
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
        <h2 id="agents" className={sectionLabel}>
          Agents
        </h2>
        {agents.isPending && (
          <p className="mt-3 text-muted-foreground">Chargement…</p>
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
        {list && (
          <>
            <ul className={`mt-3 ${listCard}`}>
              {list.agents.map((agent) => (
                <li
                  key={agent.name}
                  className="flex min-h-[50px] items-center gap-x-4 px-4 py-2"
                >
                  <span className="font-mono font-semibold">{agent.name}</span>
                  <span className="text-muted-foreground">
                    {agent.text === null
                      ? "Fichier trop gros"
                      : (parseAgent(agent.text)?.model ??
                          "En-tête illisible") ||
                        SESSION_MODEL}
                  </span>
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
                    className={`sm:ml-auto ${button}`}
                  >
                    Ouvrir
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={archived}
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
              className={`mt-3 ${button}`}
            >
              Ajouter un agent
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
            archived={archived}
            pending={commit.isPending}
            onCommit={(after) => {
              setProblem(null);
              commit.mutate({ before: editing.before, after });
            }}
          />
        )}
      </section>
    </div>
  );
}
