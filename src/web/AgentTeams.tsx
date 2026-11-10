import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import {
  type Done,
  DoneBox,
  type Failure,
  failure,
  ProblemAlert,
} from "./ProjectPrepare.tsx";
import { fetchProjects } from "./Projects.tsx";
import {
  NewTeamDialog,
  type StarterTeams,
  starterQuery,
} from "./ProjectTeam.tsx";
import { StateSentence } from "./Shell.tsx";
import { DEFAULT_STEPS, readTeam, writeTeam } from "./team-file.ts";
import { toast } from "./toast.tsx";
import {
  button,
  dangerButton,
  field,
  focusRing,
  ghostButton,
  listCard,
  sectionLabel,
} from "./ui.ts";

type Team = { id: number; name: string; text: string };
const TEAMS_KEY = ["agent-teams"];
// Decision 074 B: the text of an agent a team needs and the repo lacks comes from the starter teams, in this order.
const LEVEL_ORDER = ["standard", "premium", "max", "eco"];

export async function fetchAgentTeams(): Promise<Team[]> {
  const res = await client.api["agent-teams"].$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).teams;
}

/** The development agents of the catalog: those of the four starter teams, one text each. */
function catalogAgents({ teams }: StarterTeams) {
  const found = new Map<string, string>();
  for (const id of LEVEL_ORDER)
    for (const { name, text } of teams.find((t) => t.id === id)?.agents ?? [])
      if (!found.has(name)) found.set(name, text);
  return found;
}

const stepsOf = (text: string) =>
  readTeam(text)
    ?.steps.map((s) => s.agent)
    .join(" → ") ?? "Texte illisible par Cockpit";

type Added = { done: Done } | { upToDate: true } | { failure: Failure };

/** Adds a team to a project with one commit: its text, and the catalog files of the agents the repo does not have (decision 074 B). */
async function addTeam(
  queryClient: QueryClient,
  project: { id: number; fullName: string },
  team: { name: string; text: string },
): Promise<Added> {
  const param = { id: String(project.id) };
  const read = await client.api.projects[":id"].agents.$get({ param });
  if (!read.ok) return { failure: await failure(read) };
  const { agents, teams } = await read.json();
  const before = teams?.find((t) => t.name === team.name)?.text ?? null;
  const catalog = catalogAgents(await queryClient.fetchQuery(starterQuery));
  const missing = [
    ...new Set((readTeam(team.text)?.steps ?? []).map((s) => s.agent)),
  ]
    .filter((name) => !agents.some((a) => a.name === name))
    .flatMap((name) => {
      const after = catalog.get(name);
      return after === undefined ? [] : [{ name, before: null, after }];
    });
  if (before === team.text && missing.length === 0) return { upToDate: true };
  const res = await client.api.projects[":id"].team.apply.$post(
    { param },
    {
      init: {
        body: JSON.stringify({
          name: team.name,
          before,
          after: team.text,
          agents: missing,
        }),
        headers: { "content-type": "application/json" },
      },
    },
  );
  if (!res.ok) return { failure: await failure(res) };
  const { commitSha, pullRequest } = await res.json();
  return {
    done: {
      url:
        pullRequest?.url ??
        `https://github.com/${project.fullName}/commit/${commitSha}`,
      pullRequest: pullRequest !== undefined,
    },
  };
}

/** The add of a team to a project; the tab « Agents » of that project is read again after it. */
export function useAddTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sent: {
      project: { id: number; fullName: string };
      team: { name: string; text: string };
    }) => addTeam(queryClient, sent.project, sent.team),
    onSettled: (_added, _error, { project }) =>
      queryClient.invalidateQueries({
        queryKey: ["agents", String(project.id)],
      }),
  });
}

/** What an add answered: the commit, « Déjà à jour » or the refusal. */
export function AddResult({
  added,
  failed,
}: {
  added?: Added;
  failed: boolean;
}) {
  if (failed) return <ProblemAlert problem={{ code: "", status: 0 }} />;
  if (!added) return null;
  if ("failure" in added) return <ProblemAlert problem={added.failure} />;
  if ("upToDate" in added)
    return <p className="mt-3">Déjà à jour dans ce projet</p>;
  // The link is the only text naming the pull request: one element says it.
  if (added.done.pullRequest)
    return (
      <p className="mt-3">
        La branche par défaut est protégée :{" "}
        <a href={added.done.url} className={`underline ${focusRing}`}>
          une pull request
        </a>{" "}
        est ouverte
      </p>
    );
  return <DoneBox done={added.done} />;
}

function TeamRow({
  team,
  projects,
  onEdit,
  deleting,
  onDelete,
}: {
  team: Team;
  projects: { id: number; fullName: string }[];
  onEdit: () => void;
  deleting: boolean;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"delete" | "add" | null>(null);
  const [projectId, setProjectId] = useState("");
  const add = useAddTeam();
  const project = projects.find((p) => String(p.id) === projectId);
  return (
    <li className="px-[18px] py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 basis-48">
          <span className="block font-mono font-semibold">{team.name}</span>
          <span className="block text-[12.5px] text-muted-foreground">
            {stepsOf(team.text)}
          </span>
        </span>
        {mode !== "delete" && (
          <span className="flex flex-wrap gap-2">
            {readTeam(team.text) && (
              <button type="button" onClick={onEdit} className={ghostButton}>
                Modifier
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode("delete")}
              className={ghostButton}
            >
              Supprimer
            </button>
            <button
              type="button"
              aria-expanded={mode === "add"}
              onClick={() => setMode(mode === "add" ? null : "add")}
              className={button}
            >
              Ajouter à un projet
            </button>
          </span>
        )}
      </div>
      {mode === "delete" && (
        <div className="mt-3">
          <p id={`delete-${team.id}`}>
            Les projets qui l'ont gardent leur copie.
          </p>
          <button
            type="button"
            aria-describedby={`delete-${team.id}`}
            disabled={deleting}
            aria-busy={deleting}
            onClick={onDelete}
            className={`mt-2 ${dangerButton}`}
          >
            Confirmer la suppression
          </button>
          <button
            type="button"
            aria-describedby={`delete-${team.id}`}
            // The button that asked is gone: keep the keyboard focus on the safe choice.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
            autoFocus
            onClick={() => setMode(null)}
            className={`mt-2 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
      {mode === "add" && (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block min-w-48 flex-1">
              Projet
              <select
                className={field}
                value={projectId}
                onChange={(e) => {
                  add.reset();
                  setProjectId(e.target.value);
                }}
              >
                <option value="">Choisir un projet</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!project || add.isPending}
              aria-busy={add.isPending}
              onClick={() => project && add.mutate({ project, team })}
              className={button}
            >
              Ajouter
            </button>
          </div>
          <AddResult added={add.data} failed={add.isError} />
        </>
      )}
    </li>
  );
}

/** Decision 074 B: « Tes équipes » on the tab « Agents » of a project, each added (or updated) with one click. */
export function ProjectGlobalTeams({
  projectId,
  fullName,
  archived,
  repoTeams,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  repoTeams: { name: string; text: string }[];
}) {
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: fetchAgentTeams });
  const add = useAddTeam();
  if (!teams.data?.length) return null;
  const project = { id: Number(projectId), fullName };
  return (
    <section className="lg:col-span-2" aria-labelledby="global-teams">
      <h2 id="global-teams" className={sectionLabel}>
        Tes équipes
      </h2>
      <ul className={`mt-2 ${listCard}`}>
        {teams.data.map((team) => {
          const there = repoTeams.find((t) => t.name === team.name);
          return (
            <li
              key={team.id}
              className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2"
            >
              <span className="min-w-0 flex-1 basis-48">
                <span className="block font-mono font-semibold">
                  {team.name}
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {stepsOf(team.text)}
                </span>
              </span>
              {there?.text === team.text ? (
                <span className="text-muted-foreground">
                  Déjà dans le projet
                </span>
              ) : (
                <button
                  type="button"
                  disabled={archived || add.isPending}
                  aria-busy={add.isPending}
                  onClick={() => add.mutate({ project, team })}
                  className={button}
                >
                  {there ? "Mettre à jour dans le projet" : "Ajouter au projet"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <AddResult added={add.data} failed={add.isError} />
    </section>
  );
}

/** Decision 074 B: « Équipes d'agents », the teams of the user, created once and added to projects. */
export function AgentTeams() {
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: fetchAgentTeams });
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const starters = useQuery(starterQuery);
  // The dialog: a new team (`name` absent) or the one being edited.
  const [dialog, setDialog] = useState<{ name?: string; text: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<Failure | null>(null);
  const reload = () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY });
  const save = useMutation({
    mutationFn: async (sent: { name: string; text: string }) => {
      const res = await client.api["agent-teams"][":name"].$put({
        param: { name: sent.name },
        json: { text: sent.text },
      });
      return res.ok ? null : failure(res);
    },
    onSuccess: (refused) => {
      setProblem(refused);
      if (refused) return;
      setDialog(null);
      toast("Équipe enregistrée.");
      return reload();
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });
  const remove = useMutation({
    mutationFn: async (name: string) => {
      const res = await client.api["agent-teams"][":name"].$delete({
        param: { name },
      });
      return res.ok ? null : failure(res);
    },
    // A refusal comes back as data (shown by ProblemAlert): confirm only a real deletion.
    onSuccess: (refused) => {
      if (!refused) toast("Équipe supprimée.");
    },
    onSettled: reload,
  });
  const list = teams.data ?? [];
  const open = projects.data?.filter((p) => !p.archived) ?? [];
  const start = dialog && readTeam(dialog.text);

  return (
    <main className="pb-6">
      <StateSentence
        title="Tes équipes d'agents."
        rest="Crée-les une fois, ajoute-les à tes projets, choisis-en une quand tu lances Claude."
        actions={
          <span className="mt-1 flex gap-2">
            <Link to="/equipes/commun" className={button}>
              Agents et skills communs
            </Link>
            <button
              type="button"
              disabled={!starters.data}
              onClick={() => {
                setProblem(null);
                setDialog({ text: writeTeam(DEFAULT_STEPS, "") });
              }}
              className={button}
            >
              Nouvelle équipe
            </button>
          </span>
        }
      />
      <section className="mx-[26px] mt-5" aria-labelledby="mes-equipes">
        <h2 id="mes-equipes" className={`mb-2 ${sectionLabel}`}>
          Mes équipes
        </h2>
        {teams.isPending && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
        {teams.isError && (
          <p role="alert">Impossible de lire tes équipes d'agents.</p>
        )}
        {teams.data && list.length === 0 && (
          <p className="text-muted-foreground">Aucune équipe pour l'instant.</p>
        )}
        {list.length > 0 && (
          <ul className={listCard}>
            {list.map((team) => (
              <TeamRow
                key={team.id}
                team={team}
                projects={open}
                onEdit={() => {
                  setProblem(null);
                  setDialog(team);
                }}
                deleting={remove.isPending}
                onDelete={() => remove.mutate(team.name)}
              />
            ))}
          </ul>
        )}
        {(remove.data || remove.isError) && (
          <ProblemAlert problem={remove.data ?? { code: "", status: 0 }} />
        )}
        {starters.isError && <ProblemAlert problem={{ code: "", status: 0 }} />}
      </section>
      {dialog && start && starters.data && (
        <NewTeamDialog
          edit={dialog.name}
          start={start}
          taken={list.map((t) => t.name)}
          agents={[...catalogAgents(starters.data)].map(([name, text]) => ({
            name,
            text,
          }))}
          archived={false}
          pending={save.isPending}
          problem={problem}
          onCreate={(name, draft) =>
            save.mutate({ name, text: writeTeam(draft.steps, draft.body) })
          }
          onCancel={() => setDialog(null)}
        />
      )}
    </main>
  );
}
