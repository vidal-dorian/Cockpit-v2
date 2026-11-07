import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { alertBox, button, focusRing, listCard, primaryButton } from "./ui.ts";

// The server's refusals, in French; its codes are not meant to be read.
const REFUSALS: Record<string, string> = {
  empty_repo:
    "Ce repo n'a encore aucun commit : fais-en un premier sur GitHub, puis réessaie.",
  repo_unreachable:
    "L'App Cockpit ne voit plus ce repo : vérifie sur GitHub qu'elle y a encore accès.",
  project_archived: "Ce projet est archivé : plus rien ne s'y écrit.",
  repo_changed: "Le repo a changé entre-temps : regarde de nouveau",
  pull_request_forbidden:
    "La branche par défaut est protégée et l'App n'a pas le droit d'ouvrir une pull request : donne-lui « Pull requests » en écriture dans ses réglages, puis recommence.",
};
const UNAVAILABLE =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";
const UNAUTHORIZED = "Ta session a expiré : reconnecte-toi, puis recommence.";
const FAILED = "Ça n'a pas marché, réessaie dans un instant.";

type Plan = NonNullable<Awaited<ReturnType<typeof readPlan>>["plan"]>;
type PlanFile = Plan["files"][number];
/** What went wrong, for the page: `code` is the server's, never shown; `status` is 0 when no answer came. */
export type Failure = { code: string; status: number; settingsUrl?: string };
type Done = { url: string; pullRequest: boolean };

export function message({ code, status }: Failure) {
  if (REFUSALS[code]) return REFUSALS[code];
  if (status === 502) return UNAVAILABLE;
  return status === 401 ? UNAUTHORIZED : FAILED;
}

export async function failure(res: Response): Promise<Failure> {
  const body: { error?: string; appSettingsUrl?: string } | null = await res
    .json()
    .catch(() => null);
  return {
    code: body?.error ?? "",
    status: res.status,
    settingsUrl: body?.appSettingsUrl,
  };
}

async function readPlan(id: string) {
  const res = await client.api.projects[":id"].prepare.$post({ param: { id } });
  if (!res.ok) return { failure: await failure(res) };
  return { plan: (await res.json()).plan };
}

function FileRow({ file }: { file: PlanFile }) {
  const lines = useMemo(
    () =>
      file.status === "exists" && file.current !== undefined
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
      {file.status === "exists" && file.current !== undefined && (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Déjà là, différent : laissé tel quel
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

/** Decision 027 F: « Préparer pour Claude », the files that would be added to the repo, and the commit that adds them. Stays mounted once the health is green, to say what was done. */
export function ProjectPrepare({
  projectId,
  fullName,
  archived,
  red,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  /** The line claude_md or agents of the health is red. */
  red: boolean;
}) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);

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
    <div className="mt-4">
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
              <span className="block font-bold">
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
      {problem && (
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
      {plan && (
        <>
          <ul className={`mt-3 ${listCard}`}>
            {plan.files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                commit.isPending ||
                plan.files.every((f) => f.status !== "create")
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
