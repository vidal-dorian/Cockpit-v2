import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { HistoryChips } from "./ProjectHistory.tsx";
import { button, ghostButton, listCard, sectionLabel } from "./ui.ts";

type Entry = {
  number: number;
  title: string;
  fix: boolean;
  storyId: number | null;
};
type Group = {
  kind: "unreleased" | "release" | "older" | "day";
  name: string | null;
  date: string | null;
  entries: Entry[];
};
type Branch = { storyId: number; branch: string; prNumber: number };
type Changelog = {
  repo: string;
  groups: Group[];
  branches: Branch[];
};

// Decision 062 E: why the server refused to delete the branch.
const REFUSALS: Record<string, string> = {
  pr_not_merged: "La PR de cette US n'est pas mergée.",
  branch_gone: "La branche n'existe plus sur GitHub.",
  branch_protected:
    "Cette branche est protégée : elle ne peut pas être supprimée d'ici.",
  branch_has_new_commits:
    "La branche a des commits que la PR mergée n'a pas : rien n'est supprimé.",
  branch_has_open_pr: "Une PR ouverte part de cette branche.",
  project_archived: "Ce projet est archivé.",
  github_unavailable:
    "GitHub ne répond pas : vérifie sur GitHub si la branche a été supprimée.",
};

const dayOf = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

const frenchDate = (date: string) =>
  new Date(date).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

function groupTitle(group: Group) {
  if (group.kind === "unreleased") return "Pas encore publiée";
  if (group.kind === "older") return "Versions plus anciennes";
  if (group.kind === "release")
    return `Version ${group.name} · ${group.date ? frenchDate(group.date) : ""}`;
  const day = group.date?.slice(0, 10) ?? "";
  if (day === dayOf(0)) return "Aujourd'hui";
  if (day === dayOf(1)) return "Hier";
  return frenchDate(day);
}

function BranchLine({
  branch,
  projectId,
  archived,
}: {
  branch: Branch;
  projectId: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/stories/${branch.storyId}/branch/delete`, {
        method: "POST",
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        REFUSALS[body.error ?? ""] ?? "La branche n'a pas pu être supprimée.",
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["changelog", projectId] }),
    onError: (error) => setRefusal(error.message),
  });
  return (
    <li className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2">
      <span className="font-mono text-[13px] font-semibold">
        {branch.branch}
      </span>
      <span className="text-[12.5px] text-muted-foreground">
        {`PR #${branch.prNumber} mergée · plus utilisée`}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {archived ? null : asking ? (
          <>
            <span className="text-[13px]">
              {`Supprimer la branche ${branch.branch} ? Rien ne sera perdu : elle est déjà mergée.`}
            </span>
            <button
              type="button"
              className={button}
              disabled={remove.isPending}
              onClick={() => {
                setRefusal(null);
                remove.mutate();
              }}
            >
              Oui, supprimer
            </button>
            <button
              type="button"
              className={ghostButton}
              onClick={() => setAsking(false)}
            >
              Annuler
            </button>
          </>
        ) : (
          <button
            type="button"
            className={button}
            onClick={() => setAsking(true)}
          >
            Supprimer la branche
          </button>
        )}
      </span>
      {refusal && (
        <p role="alert" className="basis-full text-[13px]">
          {refusal}
        </p>
      )}
    </li>
  );
}

/** « Ce qui a été livré » (decision 062 F, S17): one line per merged PR by version or day, then the merged branches to clean. */
export function ProjectDelivered({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean | undefined;
}) {
  const changelog = useQuery({
    queryKey: ["changelog", projectId],
    queryFn: async (): Promise<Changelog> => {
      const res = await fetch(`/api/projects/${projectId}/changelog`);
      if (!res.ok) throw new Error("changelog");
      return res.json();
    },
  });
  const { repo, groups = [], branches = [] } = changelog.data ?? {};
  return (
    <>
      <HistoryChips projectId={projectId} />
      <div className="mt-4 space-y-5 px-[26px]">
        {changelog.isError && <p>Impossible de lire ce qui a été livré.</p>}
        {changelog.data && groups.length === 0 && (
          <p className="text-muted-foreground">Rien de livré pour l'instant.</p>
        )}
        {groups.map((group) => (
          <section
            key={`${group.kind}-${group.name}-${group.date}-${group.entries[0]?.number}`}
          >
            <h2 className={sectionLabel}>{groupTitle(group)}</h2>
            <ul className={`${listCard} mt-2`}>
              {group.entries.map((entry) => (
                <li
                  key={entry.number}
                  className="flex min-h-[50px] items-center gap-3 px-[18px] py-2"
                >
                  <span className="text-muted-foreground">
                    {entry.fix ? "✕" : "⇄"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {entry.fix ? `Corrigé : ${entry.title}` : entry.title}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    <a
                      href={`https://github.com/${repo}/pull/${entry.number}`}
                      className="underline"
                    >{`PR #${entry.number}`}</a>
                    {entry.storyId !== null && (
                      <>
                        {" · "}
                        <Link to={`/us/${entry.storyId}`} className="underline">
                          {`US ${entry.storyId}`}
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {branches.length > 0 && (
          <section>
            <h2 className={sectionLabel}>
              Branches à nettoyer · après le merge
            </h2>
            <ul className={`${listCard} mt-2`}>
              {branches.map((branch) => (
                <BranchLine
                  key={branch.storyId}
                  branch={branch}
                  projectId={projectId}
                  archived={archived === true}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
