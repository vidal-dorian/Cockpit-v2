import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { chip } from "./ProjectTeam.tsx";
import { Dot, StateSentence, useHome } from "./Shell.tsx";
import { STARTER_LEVELS, type StarterLevel } from "./starter-levels.ts";
import {
  alertBox,
  badge,
  button,
  card,
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
              live={project.id !== first && states.get(project.id) === "claude"}
            />
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

const GLOW: Record<string, string> = {
  premium: "shadow-[0_0_24px_var(--color-claude-glow)]",
  max: "shadow-[0_0_32px_var(--color-claude-glow-strong)]",
};

/** Decision 072 A: the level of the starter team is chosen in a carousel, once the repo is picked. */
function ImportDialog({
  fullName,
  pending,
  error,
  onImport,
  onCancel,
}: {
  fullName: string;
  pending: boolean;
  error: Error | null;
  onImport: (level: StarterLevel) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(1); // Standard
  useEffect(() => {
    // Unmounting an open modal skips the native close steps: give the focus back by hand.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => opener?.focus();
  }, []);
  const carousel = useRef<HTMLDivElement>(null);
  // A move can disable the focused arrow or unmount the focused side card: the focus goes to the current dot, so the keys keep working.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every move of the carousel
  useEffect(() => {
    const focused = document.activeElement;
    if (
      !focused ||
      focused === document.body ||
      (focused instanceof HTMLButtonElement && focused.disabled)
    )
      carousel.current
        ?.querySelector<HTMLElement>('[aria-current="true"]')
        ?.focus();
  }, [at]);
  const go = (to: number) =>
    setAt(Math.min(STARTER_LEVELS.length - 1, Math.max(0, to)));
  const level = STARTER_LEVELS[at] as (typeof STARTER_LEVELS)[number];
  const side = (to: number) => {
    const other = STARTER_LEVELS[to];
    return other ? (
      <button
        type="button"
        onClick={() => go(to)}
        className={`${card} hidden w-1/4 scale-90 p-3 text-left opacity-50 sm:block ${GLOW[other.id] ?? ""} ${focusRing}`}
      >
        <span className="block font-semibold">{other.name}</span>
        <span className="block text-[12.5px] text-muted-foreground">
          {other.sentence}
        </span>
      </button>
    ) : (
      <span className="hidden w-1/4 sm:block" />
    );
  };
  const arrow = `${button} w-11 flex-none px-0`;
  return (
    // Escape closes the dialog natively, which is « Annuler ».
    <dialog
      ref={ref}
      aria-labelledby="import-title"
      onClose={onCancel}
      // Escape while the import is sent would hide its error.
      onCancel={(e) => pending && e.preventDefault()}
      className="m-auto w-[min(48rem,calc(100%-2rem))] rounded-xl border border-border-strong bg-background p-4 text-foreground backdrop:bg-background/80"
    >
      <h3 id="import-title" className="font-heading text-lg font-bold">
        Quelle équipe pour {fullName} ?
      </h3>
      <p className="mt-1 text-muted-foreground">
        Une équipe, c'est les agents qui développent tes US, l'un après l'autre.
        Plus elle relit, plus elle consomme. Tu pourras la changer ensuite.
      </p>
      {/* The keys are read here: keydown bubbles from the buttons inside. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the arrow keys are a shortcut of the buttons */}
      <div
        ref={carousel}
        className="mt-4"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(at + 1);
          if (e.key === "ArrowLeft") go(at - 1);
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Équipe précédente"
            disabled={at === 0}
            onClick={() => go(at - 1)}
            className={arrow}
          >
            ←
          </button>
          {side(at - 1)}
          <div className={`${card} min-w-0 flex-1 p-4 ${GLOW[level.id] ?? ""}`}>
            <p className="text-lg font-semibold">{level.name}</p>
            <p className="text-muted-foreground">{level.sentence}</p>
            <p className="mt-3 font-mono text-[12.5px]">
              {level.agents.map((a) => `${a.name} · ${a.model}`).join(" → ")}
            </p>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Consommation : {level.use}
            </p>
          </div>
          {side(at + 1)}
          <button
            type="button"
            aria-label="Équipe suivante"
            disabled={at === STARTER_LEVELS.length - 1}
            onClick={() => go(at + 1)}
            className={arrow}
          >
            →
          </button>
        </div>
        <div className="mt-3 flex justify-center gap-1.5">
          {STARTER_LEVELS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              aria-current={i === at ? "true" : undefined}
              onClick={() => go(i)}
              className={chip(i === at)}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorAlert error={error} />}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onImport(level.id)}
          className={primaryButton}
        >
          Importer avec {level.name}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className={button}
        >
          Annuler
        </button>
      </div>
    </dialog>
  );
}

function Importable() {
  const queryClient = useQueryClient();
  const repositories = useQuery({
    queryKey: ["repositories"],
    queryFn: fetchRepositories,
  });
  // The repo whose level is being chosen.
  const [choosing, setChoosing] = useState<{
    githubRepoId: number;
    fullName: string;
  } | null>(null);
  const importRepo = useMutation({
    mutationFn: async (sent: {
      githubRepoId: number;
      starterTeam: StarterLevel;
    }) => {
      const res = await client.api.projects.$post({ json: sent });
      if (!res.ok) throw await failure(res);
    },
    onSuccess: () => setChoosing(null),
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
                  onClick={() => {
                    importRepo.reset();
                    setChoosing(repo);
                  }}
                  className={button}
                >
                  Importer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {choosing && (
        <ImportDialog
          fullName={choosing.fullName}
          pending={importRepo.isPending}
          error={importRepo.error}
          onImport={(starterTeam) =>
            importRepo.mutate({
              githubRepoId: choosing.githubRepoId,
              starterTeam,
            })
          }
          onCancel={() => setChoosing(null)}
        />
      )}
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
