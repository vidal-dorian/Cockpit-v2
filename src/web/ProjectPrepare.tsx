import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { focusRing } from "./ui.ts";

const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold disabled:opacity-50 ${focusRing}`;

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

type Plan = NonNullable<Awaited<ReturnType<typeof readPlan>>["plan"]>;
type PlanFile = Plan["files"][number];
/** What went wrong, for the page: `code` is the server's, never shown. */
type Failure = { code: string; settingsUrl?: string };
type Done = { url: string; pullRequest: boolean };

async function failure(res: Response): Promise<Failure> {
  const body: { error?: string; appSettingsUrl?: string } | null = await res
    .json()
    .catch(() => null);
  return { code: body?.error ?? "", settingsUrl: body?.appSettingsUrl };
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
    <li className="rounded-xl bg-card p-4">
      <p className="font-mono font-semibold">{file.path}</p>
      {file.status === "create" && (
        <>
          <p className="mt-1">Sera ajouté</p>
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
      {file.status === "same" && <p className="mt-1">Déjà là, identique</p>}
      {file.status === "exists" && file.current === undefined && (
        <p className="mt-1">Déjà là, pas un simple fichier : laissé tel quel</p>
      )}
      {file.status === "exists" && file.current !== undefined && (
        <>
          <p className="mt-1">Déjà là, différent : laissé tel quel</p>
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
    onError: () => setProblem({ code: "" }),
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
    onError: () => setProblem({ code: "" }),
  });

  return (
    <div className="mt-3">
      {red && (
        <button
          type="button"
          disabled={archived || read.isPending || commit.isPending}
          onClick={() => {
            setProblem(null);
            setDone(null);
            read.mutate();
          }}
          className={button}
        >
          Préparer pour Claude
        </button>
      )}
      {problem && (
        <div
          role="alert"
          className="mt-3 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          <p>{REFUSALS[problem.code] ?? UNAVAILABLE}</p>
          {problem.settingsUrl && (
            <a href={problem.settingsUrl} className={`underline ${focusRing}`}>
              Réglages de l'App sur GitHub
            </a>
          )}
        </div>
      )}
      {done && (
        <div className="mt-3 rounded-xl bg-done-soft p-4 text-done-text">
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
          <ul className="mt-3 grid gap-2">
            {plan.files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          <button
            type="button"
            disabled={
              commit.isPending || plan.files.every((f) => f.status !== "create")
            }
            onClick={() => {
              setProblem(null);
              commit.mutate(plan);
            }}
            className={`mt-3 ${button}`}
          >
            Faire le commit
          </button>
        </>
      )}
    </div>
  );
}
