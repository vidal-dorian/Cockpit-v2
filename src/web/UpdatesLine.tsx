import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import {
  type Done,
  DoneBox,
  type Failure,
  FileRow,
  failure,
  ProblemAlert,
} from "./ProjectPrepare.tsx";
import { badge, button, listCard, primaryButton, urgentBadge } from "./ui.ts";

async function readPlan(id: string) {
  const res = await client.api.projects[":id"].dependabot.plan.$get({
    param: { id },
  });
  if (!res.ok) return { failure: await failure(res) };
  return { plan: (await res.json()).plan };
}
type DependabotPlan = NonNullable<Awaited<ReturnType<typeof readPlan>>["plan"]>;

/** Decision 052 L: the line « Mises à jour automatiques » of the health, and « Ajouter .github/dependabot.yml », which shows the file then writes it like « Préparer pour Claude ». */
export function UpdatesLine({
  line,
  projectId,
  fullName,
  archived,
}: {
  line: { ok: boolean };
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<DependabotPlan | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const read = useMutation({
    mutationFn: () => readPlan(projectId),
    onError: () => setProblem({ code: "", status: 0 }),
    onSuccess: (answer) => {
      setPlan(answer.plan ?? null);
      if (answer.failure) setProblem(answer.failure);
    },
  });
  const commit = useMutation({
    mutationFn: async (sent: DependabotPlan) => {
      // The route reads its body by hand, so the client does not type it: `init` sends it.
      const res = await client.api.projects[":id"].dependabot.apply.$post(
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
    <li className="min-h-[50px] px-4 py-2">
      <div className="flex min-h-[34px] items-center gap-3.5">
        <span aria-hidden="true" className="w-4 text-dim">
          {line.ok ? "✓" : "✕"}
        </span>
        <p className="min-w-0 flex-1">
          <span className="block font-semibold">Mises à jour automatiques</span>
          {!line.ok && (
            <span className="block text-[12.5px] text-muted-foreground">
              Aucune mise à jour automatique n'est configurée : ajoute un
              .github/dependabot.yml (ou une configuration Renovate).
            </span>
          )}
        </p>
        {!line.ok && (
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
            Ajouter .github/dependabot.yml
          </button>
        )}
        <span className={line.ok ? badge : urgentBadge}>
          {line.ok ? "OK" : "À corriger"}
        </span>
      </div>
      {problem && <ProblemAlert problem={problem} />}
      {done && <DoneBox done={done} />}
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
    </li>
  );
}
