import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { atLeast, QUOTA_REFUSAL, ROLE_LABELS } from "./roles.ts";
import { Dot, repoName, StateSentence, useHome } from "./Shell.tsx";
import { STARTER_LEVELS, type StarterLevel } from "./starter-levels.ts";
import {
  alertBox,
  badge,
  button,
  chipLink,
  dangerButton,
  field,
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
    meta: { done: "Projet archivé." },
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
    return <p className="loading text-muted-foreground">Chargement…</p>;
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
      {onlyFavorites && favorites === 0 && (
        <p className="text-muted-foreground">
          Aucun favori : l'étoile d'une ligne en ajoute un.
        </p>
      )}
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
                {project.sharedBy && (
                  <span className="block text-[12.5px] text-muted-foreground">
                    partagé par @{project.sharedBy} ·{" "}
                    {ROLE_LABELS[project.role]}
                  </span>
                )}
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
                      aria-busy={archive.isPending}
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
                  // The mockup has no slot for it: a quiet button before the row's end; archiving is the owner's (decision 076 A).
                  atLeast(project.role, "owner") && (
                    <button
                      type="button"
                      onClick={() => setConfirming(project.id)}
                      className={ghostButton}
                    >
                      Archiver
                    </button>
                  )
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

/** The glow of the expensive levels (decision 074 A3): soft on Premium, strong and breathing on Max. */
const GLOW: Record<string, string> = {
  premium: "border-claude/40 shadow-[0_0_36px_var(--color-claude-glow)]",
  max: "border-claude/70 shadow-[0_0_56px_var(--color-claude-glow-strong)] glow-breathe",
};

const MODEL_PILL: Record<string, string> = {
  opus: "bg-claude-soft text-claude-text",
  sonnet: "bg-raised text-foreground",
  haiku: "bg-raised text-muted-foreground",
};

function Chevron({ left }: { left?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`size-5 ${left ? "rotate-180" : ""}`}
    >
      <path
        d="M7.5 4.5 13 10l-5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One level of the carousel: its name, its pipeline of agents and its consumption gauge. */
function LevelCard({
  level,
  rank,
}: {
  level: (typeof STARTER_LEVELS)[number];
  rank: number;
}) {
  const agents = level.agents.map((a) => `${a.name} · ${a.model}`).join(" → ");
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-2xl font-bold">{level.name}</p>
        <span className="font-mono text-[11px] text-dim">
          {level.agents.length} agents
        </span>
      </div>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        {level.sentence}
      </p>
      <p className="sr-only">{agents}</p>
      <ol aria-hidden="true" className="mt-4 grid gap-1.5">
        {level.agents.map((a, i) => (
          <li key={a.name} className="relative flex items-center gap-2.5">
            {i > 0 && (
              <span className="absolute -top-1.5 left-[9.5px] h-1.5 w-px bg-border-strong" />
            )}
            <span className="grid size-5 flex-none place-items-center rounded-full border border-border-strong bg-sunken font-mono text-[10px] text-muted-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
              {a.name}
            </span>
            <span
              className={`rounded-full px-2 py-px font-mono text-[11px] ${MODEL_PILL[a.model] ?? MODEL_PILL.sonnet}`}
            >
              {a.model}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-auto pt-4">
        <div aria-hidden="true" className="flex gap-1">
          {STARTER_LEVELS.map((l, i) => (
            <span
              key={l.id}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= rank ? (rank === STARTER_LEVELS.length - 1 ? "bg-claude shadow-[0_0_8px_var(--color-claude-glow-strong)]" : "bg-claude") : "bg-raised"}`}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Consommation : {level.use}
        </p>
      </div>
    </>
  );
}

/** Decision 074 A: the level of the starter team is chosen in a carousel, once the repo is picked. */
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
  const swipe = useRef<number | null>(null);
  useEffect(() => {
    // Unmounting an open modal skips the native close steps: give the focus back by hand.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => opener?.focus();
  }, []);
  const carousel = useRef<HTMLDivElement>(null);
  // A move can disable the focused arrow or hide the focused side card: the focus goes to the current dot, so the keys keep working.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every move of the carousel
  useEffect(() => {
    const focused = document.activeElement;
    if (
      !focused ||
      focused === document.body ||
      (focused instanceof HTMLButtonElement && focused.disabled) ||
      focused.closest("[inert]")
    )
      carousel.current
        ?.querySelector<HTMLElement>('[aria-current="true"]')
        ?.focus();
  }, [at]);
  const go = (to: number) =>
    setAt(Math.min(STARTER_LEVELS.length - 1, Math.max(0, to)));
  const level = STARTER_LEVELS[at] as (typeof STARTER_LEVELS)[number];
  const arrow = `absolute top-1/2 z-20 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-raised/80 text-foreground backdrop-blur transition hover:bg-raised-hover disabled:pointer-events-none disabled:opacity-0 ${focusRing}`;
  return (
    // Escape closes the dialog natively, which is « Annuler ».
    <dialog
      ref={ref}
      aria-labelledby="import-title"
      onClose={onCancel}
      // Escape while the import is sent would hide its error.
      onCancel={(e) => pending && e.preventDefault()}
      className="dialog-in m-auto max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100%-2rem))] overflow-x-hidden overflow-y-auto rounded-[20px] border border-border-strong bg-background bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,var(--color-claude-glow),transparent)] p-0 text-foreground backdrop:bg-background/70 backdrop:backdrop-blur-sm"
    >
      <div className="px-6 pt-6">
        <p className={sectionLabel}>Importer depuis GitHub</p>
        <h3 id="import-title" className="mt-1.5 font-heading text-xl font-bold">
          Quelle équipe pour {fullName} ?
        </h3>
        <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-muted-foreground">
          Une équipe, c'est les agents qui développent tes US, l'un après
          l'autre. Plus elle relit, plus elle consomme.
        </p>
      </div>
      {/* The keys are read here: keydown bubbles from the buttons inside; a swipe moves it on a phone. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the arrow keys and the swipe are shortcuts of the buttons */}
      <div
        ref={carousel}
        className="mt-2"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(at + 1);
          if (e.key === "ArrowLeft") go(at - 1);
        }}
        // A swipe is a finger (or a pen): a mouse drag selects text, and its click would land on a card that has just moved.
        onPointerDown={(e) => {
          swipe.current = e.pointerType === "mouse" ? null : e.clientX;
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerLeave={() => {
          swipe.current = null;
        }}
        onPointerUp={(e) => {
          if (swipe.current === null) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1));
        }}
      >
        <div className="relative">
          {/* The edges fade out, the arrows stay outside the fade. */}
          <div className="relative -my-10 h-[452px] touch-pan-y [--shift:64%] [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)] [perspective:1200px] sm:[--shift:58%]">
            {STARTER_LEVELS.map((l, i) => {
              const offset = i - at;
              const far = Math.abs(offset) > 1;
              const style = {
                transform: `translateX(calc(-50% + ${offset} * var(--shift))) rotateY(${offset * -22}deg) scale(${offset === 0 ? 1 : far ? 0.7 : 0.82})`,
                zIndex: 10 - Math.abs(offset),
              };
              return (
                <div
                  key={l.id}
                  inert={far}
                  aria-hidden={far || undefined}
                  style={style}
                  className={`absolute top-16 bottom-16 left-1/2 flex w-[78%] flex-col rounded-[18px] border bg-card p-5 transition-[transform,opacity,box-shadow,border-color] duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none sm:w-[46%] overflow-hidden ${offset === 0 ? "border-border-strong opacity-100" : far ? "border-border opacity-0" : "border-border opacity-40 has-[:focus-visible]:opacity-100"} ${far ? "" : (GLOW[l.id] ?? "")}`}
                >
                  <div
                    aria-hidden={offset !== 0 || undefined}
                    className="flex h-full flex-col"
                  >
                    <LevelCard level={l} rank={i} />
                  </div>
                  {offset !== 0 && (
                    <button
                      type="button"
                      aria-label={`Voir ${l.name} : ${l.sentence}`}
                      onClick={() => go(i)}
                      // The card clips its overflow: the ring is drawn inside it.
                      className="absolute inset-0 rounded-[18px] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Équipe précédente"
            disabled={at === 0}
            onClick={() => go(at - 1)}
            className={`${arrow} left-3`}
          >
            <Chevron left />
          </button>
          <button
            type="button"
            aria-label="Équipe suivante"
            disabled={at === STARTER_LEVELS.length - 1}
            onClick={() => go(at + 1)}
            className={`${arrow} right-3`}
          >
            <Chevron />
          </button>
        </div>
        <div className="relative mx-2 grid grid-cols-4 rounded-full sm:mx-auto sm:w-fit border border-border bg-sunken p-1">
          {STARTER_LEVELS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              aria-current={i === at ? "true" : undefined}
              onClick={() => go(i)}
              className={`relative z-10 h-8 min-w-0 rounded-full px-1 text-[12.5px] sm:min-w-20 sm:px-3 font-semibold transition-colors duration-300 ${i === at ? "text-foreground" : "text-muted-foreground hover:text-foreground"} ${focusRing}`}
            >
              {l.name}
            </button>
          ))}
          {/* The pill under the current level slides from one to the other. */}
          <span
            aria-hidden="true"
            style={{ transform: `translateX(${at * 100}%)` }}
            className="absolute top-1 left-1 h-8 w-[calc((100%-0.5rem)/4)] rounded-full border border-border-strong bg-raised transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          />
        </div>
      </div>
      <div className="px-6 pb-6">
        <p className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-border bg-sunken px-4 py-3 text-[13px] text-muted-foreground">
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="mt-px size-4 flex-none text-claude-text"
          >
            <path
              d="M13.5 3.5 16.5 6.5 7 16H4v-3z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            <b className="font-semibold text-foreground">
              Cette équipe est entièrement modifiable.
            </b>{" "}
            Ce n'est qu'un point de départ : dans l'onglet Agents du projet, tu
            pourras ajouter, retirer ou réordonner ses agents, changer leur
            modèle et leurs consignes, ou passer à un autre niveau.
          </span>
        </p>
        {error && <ErrorAlert error={error} />}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={onCancel}
            className={ghostButton}
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => onImport(level.id)}
            className={primaryButton}
          >
            Importer avec {level.name}
          </button>
        </div>
      </div>
    </dialog>
  );
}

const IMPORT_PAGE = 10;

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
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(IMPORT_PAGE);
  const importRepo = useMutation({
    meta: { done: "Projet importé." },
    mutationFn: async (sent: {
      githubRepoId: number;
      starterTeam: StarterLevel;
    }) => {
      const res = await client.api.projects.$post({ json: sent });
      if (!res.ok) {
        const error = await failure(res);
        throw error.message === "plan" ? new Error(QUOTA_REFUSAL) : error;
      }
    },
    onSuccess: () => setChoosing(null),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["repositories"] }),
      ]),
  });

  if (repositories.isPending)
    return <p className="loading text-muted-foreground">Chargement…</p>;
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
  // iOS adds a space after a tapped suggestion: it is not part of the name.
  const typed = query.trim();
  const needle = typed.toLowerCase();
  // Not-yet-imported first; the sort is stable, so each group keeps the server order.
  const matching = repos
    .filter((repo) => repo.fullName.toLowerCase().includes(needle))
    .sort((a, b) => Number(a.imported) - Number(b.imported));
  const remaining = matching.length - shown;
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
        <input
          type="search"
          aria-label="Chercher un repo"
          placeholder="Chercher un repo…"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setShown(IMPORT_PAGE);
          }}
          className={`mb-3 ${field}`}
        />
      )}
      {repos.length > 0 && matching.length === 0 && (
        <p className="text-muted-foreground">
          Aucun repo ne correspond à « {typed} ».
        </p>
      )}
      {matching.length > 0 && (
        <ul className={listCard}>
          {matching.slice(0, shown).map((repo) => (
            <li
              key={repo.githubRepoId}
              className="flex min-h-[50px] flex-wrap items-center gap-x-4 gap-y-2 px-[18px] py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block break-all font-mono text-[13px] font-semibold">
                  {repoName(repo.fullName)}
                </span>
                <span className="block break-words text-[12.5px] text-muted-foreground">
                  {repo.fullName.split("/")[0]} · {repo.defaultBranch}
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
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShown(shown + IMPORT_PAGE)}
          className={`mt-3 ${button}`}
        >
          Afficher plus ({remaining} restant{remaining > 1 ? "s" : ""})
        </button>
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
          <span className="mt-1 flex flex-wrap gap-2">
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
