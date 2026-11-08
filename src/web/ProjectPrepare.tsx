import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { plural } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  focusRing,
  listCard,
  primaryButton,
} from "./ui.ts";

// The server's refusals, in French; its codes are not meant to be read.
const REFUSALS: Record<string, string> = {
  empty_repo:
    "Ce repo n'a encore aucun commit : fais-en un premier sur GitHub, puis réessaie.",
  repo_unreachable:
    "L'App Cockpit ne voit plus ce repo : vérifie sur GitHub qu'elle y a encore accès.",
  project_archived: "Ce projet est archivé : plus rien ne s'y écrit.",
  not_prepared:
    "Ce repo n'est pas encore préparé pour Claude : commence par « Préparer pour Claude ».",
  no_ecosystem:
    "Aucun écosystème trouvé (package.json, composer.json, go.mod...) : il n'y a rien à mettre à jour automatiquement.",
  repo_changed: "Le repo a changé entre-temps : regarde de nouveau",
  pull_request_forbidden:
    "La branche par défaut est protégée et l'App n'a pas le droit d'ouvrir une pull request : donne-lui « Pull requests » en écriture dans ses réglages, puis recommence.",
};
const UNAVAILABLE =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";
const UNAUTHORIZED = "Ta session a expiré : reconnecte-toi, puis recommence.";
const FAILED = "Ça n'a pas marché, réessaie dans un instant.";

export type Plan = NonNullable<Awaited<ReturnType<typeof readPlan>>["plan"]>;
type PlanFile = Plan["files"][number];
/** What went wrong, for the page: `code` is the server's, never shown; `status` is 0 when no answer came. */
export type Failure = {
  code: string;
  status: number;
  settingsUrl?: string;
  /** The path of the value a `secret_in_clear` refusal points at. */
  at?: string;
};
export type Done = { url: string; pullRequest: boolean };

export function message({ code, status }: Failure) {
  if (REFUSALS[code]) return REFUSALS[code];
  if (status === 502) return UNAVAILABLE;
  return status === 401 ? UNAUTHORIZED : FAILED;
}

export async function failure(res: Response): Promise<Failure> {
  const body: {
    error?: string;
    appSettingsUrl?: string;
    at?: string;
  } | null = await res.json().catch(() => null);
  return {
    code: body?.error ?? "",
    status: res.status,
    settingsUrl: body?.appSettingsUrl,
    at: body?.at,
  };
}

export async function readPlan(id: string) {
  const res = await client.api.projects[":id"].prepare.$post({ param: { id } });
  if (!res.ok) return { failure: await failure(res) };
  return { plan: (await res.json()).plan };
}

export function FileRow({ file }: { file: PlanFile }) {
  const lines = useMemo(
    () =>
      (file.status === "exists" || file.status === "update") &&
      file.current !== undefined
        ? diffLines(file.current, file.content)
        : null,
    [file],
  );
  return (
    <li className="min-h-[50px] px-4 py-3">
      <p className="font-mono text-[13px] font-semibold">
        <span aria-hidden="true" className="mr-2 text-dim">
          {file.status === "create" ? "+" : "·"}
        </span>
        {file.path}
      </p>
      {file.status === "create" && (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">Sera ajouté</p>
          <details className="mt-2">
            <summary className={`cursor-pointer ${focusRing}`}>
              Voir le contenu
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-sm">
              {file.content}
            </pre>
          </details>
        </>
      )}
      {file.status === "same" && (
        <p className="mt-1 text-[13px] text-muted-foreground">
          Déjà là, identique
        </p>
      )}
      {file.status === "exists" && file.current === undefined && (
        <p className="mt-1 text-[13px] text-muted-foreground">
          Déjà là, pas un simple fichier : laissé tel quel
        </p>
      )}
      {(file.status === "exists" || file.status === "update") &&
        file.current !== undefined && (
          <>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {file.status === "update"
                ? "Sera mis à jour"
                : "Déjà là, différent : laissé tel quel"}
            </p>
            {lines ? (
              <DiffList lines={lines} />
            ) : (
              <>
                <h3 className="mt-3 font-semibold">Version du repo</h3>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-sm">
                  {file.current}
                </pre>
                <h3 className="mt-3 font-semibold">Version de Cockpit</h3>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-sm">
                  {file.content}
                </pre>
              </>
            )}
          </>
        )}
    </li>
  );
}

/** The refusal of a write, in French, with the way out when there is one. */
export function ProblemAlert({ problem }: { problem: Failure }) {
  return (
    <div role="alert" className={`mt-3 ${alertBox}`}>
      <p>{message(problem)}</p>
      {problem.status === 401 && (
        <a href="/api/auth/login" className={`underline ${focusRing}`}>
          Se connecter avec GitHub
        </a>
      )}
      {problem.settingsUrl && (
        <a href={problem.settingsUrl} className={`underline ${focusRing}`}>
          Réglages de l'App sur GitHub
        </a>
      )}
    </div>
  );
}

/** What a write did: the commit, or the pull request when the default branch is protected (decision 026 G). */
export function DoneBox({ done }: { done: Done }) {
  return (
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
  );
}

const FILE_NOTE: Record<string, string> = {
  create: "Sera ajouté",
  update: "Sera mis à jour",
  same: "Déjà là, identique",
  exists: "Déjà là, différent : laissé tel quel",
  special: "Déjà là, pas un simple fichier : laissé tel quel",
};

const noteOf = (file: PlanFile) =>
  file.status === "exists" && file.current === undefined
    ? FILE_NOTE.special
    : FILE_NOTE[file.status];

/** The master/detail of the plan (screen S13): the files on the left, the selected one on the right, the first one at first. */
function PlanView({ plan }: { plan: Plan }) {
  const [selected, setSelected] = useState(plan.files[0]?.path);
  const file = plan.files.find((f) => f.path === selected) ?? plan.files[0];
  const lines = useMemo(
    () =>
      (file?.status === "exists" || file?.status === "update") &&
      file.current !== undefined
        ? diffLines(file.current, file.content)
        : null,
    [file],
  );
  if (!file) return null;
  return (
    <div className="mt-3 grid items-start gap-3.5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <ul className={listCard}>
        {plan.files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              aria-pressed={f.path === file.path}
              onClick={() => setSelected(f.path)}
              className={`flex min-h-[50px] w-full items-start gap-3 px-4 py-2.5 text-left ${focusRing} ${f.path === file.path ? "bg-raised shadow-[inset_2px_0_0_var(--color-foreground)]" : "hover:bg-raised"}`}
            >
              <span aria-hidden="true" className="w-4 text-center text-dim">
                {f.status === "create" ? "+" : "·"}
              </span>
              <span className="min-w-0">
                <span className="block break-all font-mono text-[13px] font-semibold">
                  {f.path}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {noteOf(f)}
                  {f.status === "create" &&
                    ` · ${plural(f.content.split("\n").length, "ligne", "lignes")}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <section aria-label={`Aperçu de ${file.path}`} className="min-w-0">
        <p className="mb-2 flex flex-wrap items-center gap-2.5">
          <span className="break-all font-mono text-[13px] font-semibold">
            {file.path}
          </span>
          <span className={badge}>
            {file.status === "create"
              ? "nouveau"
              : file.status === "update"
                ? "mis à jour"
                : "laissé tel quel"}
          </span>
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-sunken py-2.5">
          {file.status === "create" && (
            <pre className="overflow-x-auto font-mono text-xs leading-[1.65]">
              {file.content.split("\n").map((text, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines are never reordered
                <div key={i} className="px-3.5">
                  <span
                    aria-hidden="true"
                    className="inline-block w-7 text-past"
                  >
                    {i + 1}
                  </span>
                  {text}
                </div>
              ))}
            </pre>
          )}
          {file.status !== "create" && (
            <p className="px-3.5 pb-1 text-[13px] text-muted-foreground">
              {noteOf(file)}
            </p>
          )}
          {(file.status === "exists" || file.status === "update") &&
            file.current !== undefined &&
            (lines ? (
              <DiffList lines={lines} />
            ) : (
              <div className="px-3.5">
                <h3 className="mt-3 font-semibold">Version du repo</h3>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-sm">
                  {file.current}
                </pre>
                <h3 className="mt-3 font-semibold">Version de Cockpit</h3>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-sm">
                  {file.content}
                </pre>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

/** Decision 027 F: « Préparer pour Claude », the files that would be added to the repo, and the commit that adds them. Stays mounted once the health is green, to say what was done. */
export function ProjectPrepare({
  projectId,
  fullName,
  archived,
  red,
  onPlan,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  /** The line claude_md or agents of the health is red. */
  red: boolean;
  /** Tells the page header how many files the plan on screen adds (null when there is no plan). */
  onPlan?: (added: number | null) => void;
}) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(
    () =>
      onPlan?.(
        plan
          ? plan.files.filter(
              (f) => f.status === "create" || f.status === "update",
            ).length
          : null,
      ),
    [plan, onPlan],
  );

  const read = useMutation({
    mutationFn: () => readPlan(projectId),
    onError: () => setProblem({ code: "", status: 0 }),
    onSuccess: (answer) => {
      setPlan(answer.plan ?? null);
      // After a repo_changed the message stays, next to the new list.
      if (answer.failure) setProblem(answer.failure);
    },
  });
  const commit = useMutation({
    mutationFn: async (sent: Plan) => {
      // The route reads its body by hand, so the client does not type it: `init` sends it.
      const res = await client.api.projects[":id"].prepare.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({ plan: sent }),
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
        if (answer.failure.code === "repo_changed") read.mutate();
        return;
      }
      const { commitSha, pullRequest } = answer.done;
      setPlan(null);
      setDone({
        url:
          pullRequest?.url ??
          `https://github.com/${fullName}/commit/${commitSha}`,
        pullRequest: pullRequest !== undefined,
      });
      return queryClient.invalidateQueries({ queryKey: ["health", projectId] });
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });

  return (
    <div>
      {red && !done?.pullRequest && !plan && (
        <>
          <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[.08em] text-you-text">
            1 · À corriger d'abord
          </h2>
          <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] border border-you-line bg-you-ground px-4 py-3.5">
            <span
              aria-hidden="true"
              className="grid size-9 flex-none place-items-center rounded-[10px] bg-you-soft text-you-text"
            >
              ✕
            </span>
            <p className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">
                Préparer le repo pour Claude
              </span>
              <span className="block text-[12.5px] text-muted-foreground">
                ajoute /dev-us, les agents et le serveur MCP · un commit, montré
                fichier par fichier avant
              </span>
            </p>
            <button
              type="button"
              disabled={archived || read.isPending || commit.isPending}
              onClick={() => {
                setProblem(null);
                setDone(null);
                read.mutate();
              }}
              className={primaryButton}
            >
              Préparer pour Claude
            </button>
          </div>
        </>
      )}
      {problem && <ProblemAlert problem={problem} />}
      {done && <DoneBox done={done} />}
      {plan && (
        <>
          <PlanView plan={plan} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                commit.isPending ||
                plan.files.every(
                  (f) => f.status !== "create" && f.status !== "update",
                )
              }
              onClick={() => {
                setProblem(null);
                commit.mutate(plan);
              }}
              className={primaryButton}
            >
              Faire le commit
            </button>
            <button
              type="button"
              onClick={() => setPlan(null)}
              className={button}
            >
              Annuler
            </button>
            <p className="text-[12.5px] text-muted-foreground">
              Refusé si un fichier a changé sur GitHub entre-temps.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
