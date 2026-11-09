import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { Dot, StateSentence, useHome } from "./Shell.tsx";
import { STARTER_LEVELS, type StarterLevel } from "./starter-levels.ts";
import {
  alertBox,
  badge,
  button,
  card,
  chipLink,
  dangerButton,
  focusRing,
  ghostButton,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** The message the server put in an error answer, or the status when there is none. */
async function failure(res: Response) {
  const body: unknown = await res.json().catch(() => null);
  const message = (body as { error?: unknown } | null)?.error;
  return new Error(
    typeof message === "string" ? message : `HTTP ${res.status}`,
  );
}

/** The caller's projects, or null when the server answers 401. */
export async function fetchProjects() {
  const res = await client.api.projects.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw await failure(res);
  return (await res.json()).projects;
}

/** What the App can see on GitHub, or null when the server answers 401. */
export async function fetchRepositories() {
  const res = await client.api.github.repositories.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw await failure(res);
  return res.json();
}

const STATE_TEXT = {
  for_you: "Claude t'attend",
  claude: "Claude travaille",
  idle: "rien en cours",
} as Record<string, string>;

function ErrorAlert({ error }: { error: Error }) {
  return (
    <p role="alert" className={`mt-3 ${alertBox}`}>
      {error.message}
    </p>
  );
}

function ProjectList() {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const home = useHome().data;
  const states = new Map(home?.projects.map((p) => [p.id, p.state]));
  // Red only for the project of the first thing to do (decision 045 C).
  const first = home?.forYou[0]?.project.id;
  // The project waiting for its confirmation; there is no unarchive yet, so we ask on the spot (decision 003, rule 4).
  const [confirming, setConfirming] = useState<number | null>(null);
  const archive = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.projects[":id"].archive.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw await failure(res);
    },
    onSettled: () => {
      setConfirming(null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["repositories"] }),
      ]);
    },
  });

  const star = useMutation({
    mutationFn: async ({ id, favorite }: { id: number; favorite: boolean }) => {
      const res = await client.api.projects[":id"].favorite.$put({
        param: { id: String(id) },
        json: { favorite },
      });
      if (!res.ok) throw await failure(res);
    },
    // The sidebar lists the favourites from the home.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
      ]),
  });
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  if (projects.isPending)
    return <p className="text-muted-foreground">Chargement…</p>;
  if (projects.isError) {
    return (
      <div role="alert" className={alertBox}>
        <p>Impossible de lire tes projets : {projects.error.message}</p>
        <button
          type="button"
          onClick={() => projects.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (projects.data === null) return <LoginLink />;
  if (projects.data.length === 0)
    return (
      <p className="text-muted-foreground">Aucun projet pour l'instant.</p>
    );
  const favorites = projects.data.filter((p) => p.favorite).length;
  const error = archive.error ?? star.error;
  return (
    <>
      <button
        type="button"
        aria-pressed={onlyFavorites}
        onClick={() => setOnlyFavorites(!onlyFavorites)}
        className={`mb-3 ${chipLink({ isActive: onlyFavorites })}`}
      >
        Favoris · {favorites}
      </button>
      <ul className={listCard}>
        {projects.data
          .filter((p) => p.favorite || !onlyFavorites)
          .map((project) => (
            <li
              key={project.id}
              className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2"
            >
              <Dot
                tone={
                  project.id === first
                    ? "you"
                    : states.get(project.id) === "claude"
                      ? "claude"
                      : "none"
                }
                live={
                  project.id !== first && states.get(project.id) === "claude"
                }
              />
              <button
                type="button"
                aria-pressed={project.favorite}
                aria-label={
                  project.favorite
                    ? "Retirer des favoris"
                    : "Ajouter aux favoris"
                }
                onClick={() =>
                  star.mutate({ id: project.id, favorite: !project.favorite })
                }
                className={`grid size-8 place-items-center rounded-lg hover:text-foreground ${project.favorite ? "text-foreground" : "text-dim"} ${focusRing}`}
              >
                {project.favorite ? "★" : "☆"}
              </button>
              <span className="min-w-0 flex-1 basis-48">
                <Link
                  to={`/projets/${project.id}`}
                  className={`block truncate font-semibold hover:underline ${focusRing}`}
                >
                  {project.fullName.split("/").pop()}
                </Link>
                <span className="block font-mono text-[11.5px] text-muted-foreground">
                  {project.fullName}
                </span>
              </span>
              <span
                className={`flex-1 basis-40 text-[13px] ${project.id === first ? "text-you-text" : "text-muted-foreground"}`}
              >
                {STATE_TEXT[states.get(project.id) ?? "idle"]}
              </span>
              <span className="flex gap-2">
                {project.archived ? (
                  <span className={badge}>Archivé</span>
                ) : confirming === project.id ? (
                  <>
                    <span className="basis-full">
                      Archiver {project.fullName} ? Il n'y a pas encore de
                      désarchivage.
                    </span>
                    <button
                      type="button"
                      onClick={() => archive.mutate(project.id)}
                      disabled={archive.isPending}
                      className={dangerButton}
                    >
                      Confirmer l'archivage
                    </button>
                    <button
                      type="button"
                      // The Archiver button is gone: keep the keyboard focus on the safe choice.
                      // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                      autoFocus
                      onClick={() => setConfirming(null)}
                      className={button}
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  // The mockup has no slot for it: a quiet button before the row's end.
                  <button
                    type="button"
                    onClick={() => setConfirming(project.id)}
                    className={ghostButton}
                  >
                    Archiver
                  </button>
                )}
              </span>
            </li>
          ))}
      </ul>
      {error && <ErrorAlert error={error} />}
    </>
  );
}

function LoginLink() {
  return (
    <a href="/api/auth/login" className={primaryButton}>
      Se connecter avec GitHub
    </a>
  );
}

function Importable() {
  const queryClient = useQueryClient();
  const repositories = useQuery({
    queryKey: ["repositories"],
    queryFn: fetchRepositories,
  });
  const [starterTeam, setStarterTeam] = useState<StarterLevel>("standard");
  const importRepo = useMutation({
    mutationFn: async (githubRepoId: number) => {
      const res = await client.api.projects.$post({
        json: { githubRepoId, starterTeam },
      });
      if (!res.ok) throw await failure(res);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["repositories"] }),
      ]),
  });

  if (repositories.isPending)
    return <p className="text-muted-foreground">Chargement…</p>;
  if (repositories.isError) {
    return (
      <div role="alert" className={alertBox}>
        <p>
          Impossible de lire tes repos GitHub : {repositories.error.message}
        </p>
        <button
          type="button"
          onClick={() => repositories.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  }
  // Not logged in: the project list already offers the login.
  if (repositories.data === null) return null;
  const { installUrl, installed, repositories: repos } = repositories.data;
  return (
    <>
      {!installed && (
        <>
          <p className="text-muted-foreground">
            Cockpit ne voit aucun repo : installe l'App sur ceux que tu veux
            suivre.
          </p>
          <a href={installUrl} className={`mt-3 ${primaryButton}`}>
            Installer l'App sur mes repos
          </a>
        </>
      )}
      {installed && repos.length === 0 && (
        <p className="text-muted-foreground">
          L'App est installée, mais sur aucun repo.{" "}
          <a href={installUrl} className={`underline ${focusRing}`}>
            Choisir des repos
          </a>
        </p>
      )}
      {repos.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Quelle équipe pour ce projet ?"
          className="mb-4 grid gap-2 sm:grid-cols-4"
        >
          <p className="font-semibold sm:col-span-4">
            Quelle équipe pour ce projet ?
          </p>
          {STARTER_LEVELS.map((level) => (
            <label
              key={level.id}
              className={`${card} flex cursor-pointer items-start gap-2 p-3 has-[:checked]:border-foreground`}
            >
              <input
                type="radio"
                name="starter-team"
                checked={starterTeam === level.id}
                onChange={() => setStarterTeam(level.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold">{level.name}</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {level.sentence}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {repos.length > 0 && (
        <ul className={listCard}>
          {repos.map((repo) => (
            <li
              key={repo.githubRepoId}
              className="flex min-h-[50px] flex-wrap items-center gap-x-4 gap-y-2 px-[18px] py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[13px] font-semibold">
                  {repo.fullName}
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {repo.defaultBranch}
                </span>
              </span>
              {repo.imported ? (
                <span className={badge}>Déjà importé</span>
              ) : (
                <button
                  type="button"
                  onClick={() => importRepo.mutate(repo.githubRepoId)}
                  disabled={importRepo.isPending}
                  className={button}
                >
                  Importer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {importRepo.error && <ErrorAlert error={importRepo.error} />}
    </>
  );
}

export function Projects() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const home = useHome().data;
  // The sidebar counts the same projects: the archived ones are out.
  const total = projects.data?.filter((p) => !p.archived).length ?? 0;
  const waiting = (home?.projects ?? []).filter(
    (p) => p.state === "for_you",
  ).length;
  return (
    <main className="pb-6">
      <StateSentence
        title={
          projects.data
            ? `${total} ${total === 1 ? "projet" : "projets"}. ${waiting === 0 ? "Aucun n'a" : waiting === 1 ? "1 a" : `${waiting} ont`} besoin de toi.`
            : "Projets"
        }
        rest="Les autres avancent seuls ou dorment."
        actions={
          <span className="mt-1 flex gap-2">
            <Link to="/projets/nouveau" className={button}>
              Nouveau depuis un modèle
            </Link>
            <a href="#importer" className={button}>
              + Importer un repo
            </a>
          </span>
        }
      />
      <section className="mx-[26px] mt-5" aria-labelledby="mes-projets">
        <h2 id="mes-projets" className={`mb-2 ${sectionLabel}`}>
          Mes projets
        </h2>
        <div aria-live="polite">
          <ProjectList />
        </div>
      </section>
      <section className="mx-[26px] mt-8" aria-labelledby="importer">
        <h2 id="importer" className={`mb-2 ${sectionLabel}`}>
          Importer depuis GitHub
        </h2>
        <div aria-live="polite">
          <Importable />
        </div>
      </section>
    </main>
  );
}
