import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { Dot, StateSentence, useHome } from "./Shell.tsx";
import {
  alertBox,
  badge,
  button,
  dangerButton,
  focusRing,
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
async function fetchRepositories() {
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
  const states = new Map(useHome().data?.projects.map((p) => [p.id, p.state]));
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
  return (
    <>
      <ul className={listCard}>
        {projects.data.map((project) => (
          <li
            key={project.id}
            className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
          >
            <Dot
              tone={
                states.get(project.id) === "for_you"
                  ? "you"
                  : states.get(project.id) === "claude"
                    ? "claude"
                    : "none"
              }
            />
            <Link
              to={`/projets/${project.id}`}
              className={`font-semibold hover:underline ${focusRing}`}
            >
              {project.fullName.split("/").pop()}
            </Link>
            <span className="font-mono text-[11.5px] text-dim">
              {project.fullName}
            </span>
            <span className="text-[13px] text-muted-foreground">
              {STATE_TEXT[states.get(project.id) ?? "idle"]}
            </span>
            <span className="flex gap-2 sm:ml-auto">
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
                <button
                  type="button"
                  onClick={() => setConfirming(project.id)}
                  className={button}
                >
                  Archiver
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {archive.error && <ErrorAlert error={archive.error} />}
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
  const importRepo = useMutation({
    mutationFn: async (githubRepoId: number) => {
      const res = await client.api.projects.$post({ json: { githubRepoId } });
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
        <ul className={listCard}>
          {repos.map((repo) => (
            <li
              key={repo.githubRepoId}
              className="flex min-h-[50px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2"
            >
              <span className="font-semibold">{repo.fullName}</span>
              <span className="text-[13px] text-muted-foreground">
                {repo.defaultBranch}
              </span>
              {repo.imported ? (
                <span className={`${badge} sm:ml-auto`}>Déjà importé</span>
              ) : (
                <button
                  type="button"
                  onClick={() => importRepo.mutate(repo.githubRepoId)}
                  disabled={importRepo.isPending}
                  className={`${button} sm:ml-auto`}
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
  const total = projects.data?.length ?? 0;
  const waiting = (home?.projects ?? []).filter(
    (p) => p.state === "for_you",
  ).length;
  return (
    <main className="pb-6">
      <StateSentence
        title={
          projects.data
            ? `${total} ${total === 1 ? "projet" : "projets"}. ${waiting} ${waiting === 1 ? "a" : "ont"} besoin de toi.`
            : "Projets"
        }
        rest="Les autres avancent seuls ou dorment."
      />
      <section className="mx-[26px] mt-6" aria-labelledby="mes-projets">
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
