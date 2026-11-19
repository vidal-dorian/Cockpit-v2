import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { fetchAgents } from "./ProjectAgents.tsx";
import {
  type Done,
  DoneBox,
  type Failure,
  failure,
  ProblemAlert,
} from "./ProjectPrepare.tsx";
import { fetchProjects } from "./Projects.tsx";
import { starterQuery } from "./ProjectTeam.tsx";
import { TEAM_QUOTA_REFUSAL } from "./roles.ts";
import { StateSentence } from "./Shell.tsx";
import { fetchPlan } from "./Subscription.tsx";
import { catalogAgents, TeamCanvas } from "./TeamCanvas.tsx";
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

export async function fetchAgentTeams(): Promise<Team[]> {
  const res = await client.api["agent-teams"].$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).teams;
}

const stepsOf = (text: string) =>
  readTeam(text)
    ?.steps.map((s) => s.agent)
    .join(" → ") ?? "Texte illisible par Cockpit";

type Added = { done: Done } | { upToDate: true } | { failure: Failure };
/** What one commit adds: the team text and the catalog files of the agents the repo lacks. */
type Plan = {
  name: string;
  before: string | null;
  after: string;
  agents: { name: string; before: null; after: string }[];
};
type Planned = { plan: Plan } | { upToDate: true } | { failure: Failure };

/** Reads the project: what the commit of a team would change (decision 074 B, shown first by decision 084 N). */
async function planAdd(
  queryClient: QueryClient,
  project: { id: number },
  team: { name: string; text: string },
): Promise<Planned> {
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
  return {
    plan: { name: team.name, before, after: team.text, agents: missing },
  };
}

async function applyPlan(
  project: { id: number; fullName: string },
  plan: Plan,
): Promise<Added> {
  const res = await client.api.projects[":id"].team.apply.$post(
    { param: { id: String(project.id) } },
    {
      init: {
        body: JSON.stringify(plan),
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

/** Adds a team to a project with one click, no preview (the window « Développer »). */
async function addTeam(
  queryClient: QueryClient,
  project: { id: number; fullName: string },
  team: { name: string; text: string },
): Promise<Added> {
  const planned = await planAdd(queryClient, project, team);
  return "plan" in planned ? applyPlan(project, planned.plan) : planned;
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

/** Decision 084 N: the add in two steps, what it changes first (`preview`), then the commit (`commit`). */
function useAddPreview() {
  const queryClient = useQueryClient();
  const preview = useMutation({
    mutationFn: (sent: {
      project: { id: number; fullName: string };
      team: { name: string; text: string };
    }) => planAdd(queryClient, sent.project, sent.team),
  });
  const commit = useMutation({
    mutationFn: (sent: {
      project: { id: number; fullName: string };
      plan: Plan;
    }) => applyPlan(sent.project, sent.plan),
    onSettled: (_added, _error, { project }) =>
      queryClient.invalidateQueries({
        queryKey: ["agents", String(project.id)],
      }),
  });
  return {
    preview,
    commit,
    start: (project: { id: number; fullName: string }, team: Team) => {
      commit.reset();
      preview.mutate({ project, team });
    },
    reset: () => {
      preview.reset();
      commit.reset();
    },
  };
}

/** What an add will change (the diff, the agents added), then its result, under the row of the team. */
function AddPanel({
  add,
  project,
  link = false,
  onCommitted,
}: {
  add: ReturnType<typeof useAddPreview>;
  project?: { id: number; fullName: string };
  /** Offers the way to the project once added (/equipes). */
  link?: boolean;
  onCommitted?: () => void;
}) {
  const listId = useId();
  const { preview, commit } = add;
  if (commit.data || commit.isError)
    return (
      <AddResult
        added={commit.data}
        failed={commit.isError}
        project={link ? commit.variables?.project : undefined}
      />
    );
  if (preview.isPending)
    return (
      <p role="status" className="mt-3">
        Lecture du projet…
      </p>
    );
  if (preview.isError) return <AddResult failed />;
  const planned = preview.data;
  if (!planned) return null;
  if (!("plan" in planned)) return <AddResult added={planned} failed={false} />;
  const { plan } = planned;
  const lines = diffLines(plan.before ?? "", plan.after);
  return (
    <div className="mt-3 grid basis-full gap-2">
      <h3 className={sectionLabel}>Ce qui change</h3>
      {lines ? (
        <DiffList lines={lines} />
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
          {plan.after}
        </pre>
      )}
      {plan.agents.length > 0 && (
        <>
          <h3 id={listId} className={sectionLabel}>
            Agents ajoutés
          </h3>
          <ul aria-labelledby={listId} className="font-mono text-[12.5px]">
            {plan.agents.map((a) => (
              <li key={a.name}>{a.name}</li>
            ))}
          </ul>
        </>
      )}
      <div>
        <button
          type="button"
          disabled={!project || commit.isPending}
          aria-busy={commit.isPending}
          onClick={() =>
            project &&
            commit.mutate({ project, plan }, { onSuccess: onCommitted })
          }
          className={button}
        >
          Faire le commit
        </button>
      </div>
      {commit.isPending && (
        <p role="status" className="mt-1">
          Ajout en cours…
        </p>
      )}
    </div>
  );
}

/** What an add answered: the commit, « Déjà à jour » or the refusal. */
export function AddResult({
  added,
  failed,
  project,
}: {
  added?: Added;
  failed: boolean;
  /** Where the team now lives: offered after a success (decision 084 C). */
  project?: { id: number; fullName: string };
}) {
  if (failed) return <ProblemAlert problem={{ code: "", status: 0 }} />;
  if (!added) return null;
  if ("failure" in added) return <ProblemAlert problem={added.failure} />;
  if ("upToDate" in added)
    return <p className="mt-3">Déjà à jour dans ce projet</p>;
  // The link is the only text naming the pull request: one element says it.
  const result = added.done.pullRequest ? (
    <p className="mt-3">
      La branche par défaut est protégée :{" "}
      <a href={added.done.url} className={`underline ${focusRing}`}>
        une pull request
      </a>{" "}
      est ouverte
    </p>
  ) : (
    <DoneBox done={added.done} />
  );
  if (!project) return result;
  return (
    <>
      {result}
      <Link
        to={`/projets/${project.id}/agents`}
        className={`mt-2 inline-block underline ${focusRing}`}
      >
        Ouvrir dans {project.fullName} › Agents
      </Link>
    </>
  );
}

function TeamRow({
  team,
  projects,
  onEdit,
  deleting,
  onDelete,
  startAdding,
}: {
  team: Team;
  projects: { id: number; fullName: string }[];
  onEdit: () => void;
  deleting: boolean;
  onDelete: () => void;
  /** The team was just created: its row opens on the project to add it to (decision 084 C). */
  startAdding: boolean;
}) {
  const [mode, setMode] = useState<"delete" | "add" | null>(
    startAdding ? "add" : null,
  );
  const [projectId, setProjectId] = useState("");
  const add = useAddPreview();
  const project = projects.find((p) => String(p.id) === projectId);
  // The agents of each project, read once the panel is open: what it already has of this team.
  const repos = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["agents", String(p.id)],
      queryFn: () => fetchAgents(String(p.id)),
      retry: false,
      enabled: mode === "add",
    })),
  });
  const there = (i: number) =>
    repos[i]?.data?.data?.teams?.find((t) => t.name === team.name);
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
                {projects.map((p, i) => {
                  const found = there(i);
                  const same = found?.text === team.text;
                  return (
                    <option key={p.id} value={p.id} disabled={same}>
                      {p.fullName}
                      {found &&
                        (same
                          ? " · déjà dans ce projet"
                          : " · à mettre à jour")}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              type="button"
              disabled={
                !project || add.preview.isPending || add.commit.isPending
              }
              aria-busy={add.preview.isPending || add.commit.isPending}
              onClick={() => project && add.start(project, team)}
              className={button}
            >
              Ajouter
            </button>
          </div>
          <AddPanel
            add={add}
            project={project}
            link
            onCommitted={() => setProjectId("")}
          />
        </>
      )}
    </li>
  );
}

function GlobalTeamRow({
  team,
  project,
  archived,
  there,
}: {
  team: Team;
  project: { id: number; fullName: string };
  archived: boolean;
  there?: { text: string };
}) {
  const add = useAddPreview();
  return (
    <li className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2">
      <span className="min-w-0 flex-1 basis-48">
        <span className="block font-mono font-semibold">{team.name}</span>
        <span className="block text-[12.5px] text-muted-foreground">
          {stepsOf(team.text)}
        </span>
      </span>
      {there?.text === team.text ? (
        <span className="text-muted-foreground">Déjà dans le projet</span>
      ) : (
        <button
          type="button"
          disabled={archived || add.preview.isPending || add.commit.isPending}
          aria-busy={add.preview.isPending || add.commit.isPending}
          onClick={() => add.start(project, team)}
          className={button}
        >
          {there ? "Mettre à jour dans le projet" : "Ajouter au projet"}
        </button>
      )}
      <div className="basis-full empty:hidden">
        <AddPanel add={add} project={project} />
      </div>
    </li>
  );
}

/** Decision 074 B: « Tes équipes » on the tab « Agents » of a project, each added (or updated) after the diff and the agents added are shown (decision 084 N). */
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
  if (!teams.data?.length) return null;
  const project = { id: Number(projectId), fullName };
  return (
    <section className="lg:col-span-2" aria-labelledby="global-teams">
      <h2 id="global-teams" className={sectionLabel}>
        Tes équipes
      </h2>
      <ul className={`mt-2 ${listCard}`}>
        {teams.data.map((team) => (
          <GlobalTeamRow
            key={team.id}
            team={team}
            project={project}
            archived={archived}
            there={repoTeams.find((t) => t.name === team.name)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Decision 074 B: « Équipes d'agents », the teams of the user, created once and added to projects. */
export function AgentTeams() {
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: fetchAgentTeams });
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const starters = useQuery(starterQuery);
  const plan = useQuery({ queryKey: ["plan"], queryFn: fetchPlan });
  // The dialog: a new team (`name` absent) or the one being edited.
  const [dialog, setDialog] = useState<{ name?: string; text: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<Failure | null>(null);
  // The team just created: its row opens on « Ajouter à un projet » (decision 084 C).
  const [created, setCreated] = useState<string | null>(null);
  const reload = () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY });
  const save = useMutation({
    mutationFn: async (sent: { name: string; text: string }) => {
      const res = await client.api["agent-teams"][":name"].$put({
        param: { name: sent.name },
        json: { text: sent.text },
      });
      if (res.ok) return null;
      const refused = await failure(res);
      return refused.code === "plan"
        ? { ...refused, code: "team_quota" }
        : refused;
    },
    onSuccess: (refused, sent) => {
      setProblem(refused);
      if (refused) return;
      if (!dialog?.name) setCreated(sent.name);
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
  const full =
    plan.data?.teamLimit != null && list.length >= plan.data.teamLimit;
  const open = projects.data?.filter((p) => !p.archived) ?? [];
  const start = dialog && readTeam(dialog.text);
  const catalog = useMemo(
    () => (starters.data ? catalogAgents(starters.data) : new Map()),
    [starters.data],
  );

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
              disabled={!starters.data || full}
              aria-describedby={full ? "team-quota" : undefined}
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
      {full && (
        <p id="team-quota" className="mx-[26px] mt-3">
          {TEAM_QUOTA_REFUSAL}{" "}
          <Link to="/reglages/abonnement" className={`underline ${focusRing}`}>
            Abonnement
          </Link>
        </p>
      )}
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
                startAdding={team.name === created}
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
        <TeamCanvas
          back="‹ Équipes d'agents"
          edit={dialog.name}
          start={start}
          taken={list.map((t) => t.name)}
          catalog={catalog}
          archived={false}
          pending={save.isPending}
          problem={problem}
          onSave={(name, draft) =>
            save.mutate({ name, text: writeTeam(draft.steps, draft.body) })
          }
          onCancel={() => setDialog(null)}
        />
      )}
    </main>
  );
}
