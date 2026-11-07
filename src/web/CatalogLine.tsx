import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import {
  type Done,
  DoneBox,
  type Failure,
  FileRow,
  failure,
  message,
  ProblemAlert,
} from "./ProjectPrepare.tsx";
import { badge, button, listCard, primaryButton, urgentBadge } from "./ui.ts";

type Line = {
  ok: boolean;
  files?: { path: string; state: string }[];
};

async function readPlan(id: string) {
  const res = await client.api.projects[":id"].catalog.plan.$post({
    param: { id },
  });
  if (!res.ok) return { failure: await failure(res) };
  return { plan: (await res.json()).plan };
}
type CatalogPlan = NonNullable<Awaited<ReturnType<typeof readPlan>>["plan"]>;

/** Decision 049 E and F: the line « Fichiers de Claude à jour » of the health, the files kept as they are, and « Mettre à jour » with the diff of each file and one commit. */
export function CatalogLine({
  line,
  projectId,
  fullName,
  archived,
}: {
  line: Line;
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const files = line.files ?? [];
  const toUpdate = files.filter(
    (f) => f.state === "old" || f.state === "absent",
  ).length;

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
    mutationFn: async (sent: CatalogPlan) => {
      // The route reads its body by hand, so the client does not type it: `init` sends it.
      const res = await client.api.projects[":id"].catalog.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({
              files: sent.files.map((f) => ({
                path: f.path,
                before: f.current,
              })),
            }),
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
          <span className="block font-bold">Fichiers de Claude à jour</span>
          {toUpdate > 0 && (
            <span className="block text-[12.5px] text-muted-foreground">
              {toUpdate === 1
                ? "1 fichier a une nouvelle version"
                : `${toUpdate} fichiers ont une nouvelle version`}
            </span>
          )}
        </p>
        {toUpdate > 0 && (
          <>
            {archived && (
              <span
                id="catalog-archived"
                className="text-[12.5px] text-muted-foreground"
              >
                {message({ code: "project_archived", status: 409 })}
              </span>
            )}
            <button
              type="button"
              disabled={archived || read.isPending || commit.isPending}
              aria-describedby={archived ? "catalog-archived" : undefined}
              onClick={() => {
                setProblem(null);
                setDone(null);
                read.mutate();
              }}
              className={button}
            >
              Mettre à jour
            </button>
          </>
        )}
        <span className={line.ok ? badge : urgentBadge}>
          {line.ok ? "OK" : "À corriger"}
        </span>
      </div>
      {files.some((f) => f.state === "modified") && (
        <ul className="mt-1 ml-[30px] text-[12.5px] text-muted-foreground">
          {files
            .filter((f) => f.state === "modified")
            .map((f) => (
              <li key={f.path}>
                <span className="font-mono">{f.path}</span>
                <span> : modifié à la main, gardé tel quel</span>
              </li>
            ))}
        </ul>
      )}
      {problem && <ProblemAlert problem={problem} />}
      {done && <DoneBox done={done} />}
      {plan && (
        <>
          <ul className={`mt-3 ${listCard}`}>
            {plan.files.map((file) => (
              <FileRow
                key={file.path}
                file={{
                  path: file.path,
                  content: file.content,
                  status: file.state === "absent" ? "create" : "update",
                  ...(file.current !== null && { current: file.current }),
                }}
              />
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={commit.isPending || plan.files.length === 0}
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
