import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { fetchProjects } from "./Projects.tsx";
import { Breadcrumb, repoName, StateSentence } from "./Shell.tsx";
import {
  alertBox,
  button,
  chipLink,
  focusRing,
  listCard,
  primaryButton,
} from "./ui.ts";

const UNREACHABLE = "GitHub est injoignable, réessaie.";

class GithubDown extends Error {
  constructor() {
    super(UNREACHABLE);
  }
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** « Importé de l'issue #57 ↗ »: the link of an imported ticket to its issue (decision 056 G). */
export function ImportedFrom({
  fullName,
  number,
}: {
  fullName: string;
  number: number;
}) {
  return (
    <a
      href={`https://github.com/${fullName}/issues/${number}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[12.5px] text-muted-foreground hover:text-foreground hover:underline ${focusRing}`}
    >
      Importé de l'issue #{number} ↗
    </a>
  );
}

async function fetchIssues(id: string) {
  const res = await client.api.projects[":id"].issues.$get({ param: { id } });
  if (res.status === 502) throw new GithubDown();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).issues;
}

type Issue = Awaited<ReturnType<typeof fetchIssues>>[number];
type View = "import" | "known" | "closed";

const subtitle = (issue: Issue) =>
  issue.inCockpit
    ? "storyId" in issue.inCockpit
      ? `déjà dans Cockpit (US ${issue.inCockpit.storyId})`
      : `déjà dans Cockpit (ticket ${issue.inCockpit.ticketId})`
    : issue.state === "closed"
      ? "fermée"
      : issue.kind === "story"
        ? "écrite comme une US · deviendra une US validée"
        : "deviendra un ticket « Nouveau »";

/** The import screen (decision 056 F, S27): the open issues of the repo, those to import checked by default. */
export function IssueImport() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const issues = useQuery({
    queryKey: ["issues", id],
    queryFn: () => fetchIssues(id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [view, setView] = useState<View>("import");
  // What the user unchecked: everything importable is checked by default, also after a re-read.
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const fullName = projects.data?.find((p) => String(p.id) === id)?.fullName;

  const run = useMutation({
    mutationFn: async (numbers: number[]) => {
      const res = await client.api.projects[":id"].issues.import.$post({
        param: { id },
        json: { numbers },
      });
      if (res.status === 502) throw new GithubDown();
      if (!res.ok) throw new Error("L'import a échoué, réessaie.");
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all(
        [["issues", id], ["tickets", id], ["stories", id], ["home"]].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });

  const all = issues.data ?? [];
  const toImport = all.filter((i) => i.state === "open" && !i.inCockpit);
  const known = all.filter((i) => i.inCockpit);
  const closed = all.filter((i) => i.state === "closed" && !i.inCockpit);
  const checked = toImport.filter((i) => !unchecked.has(i.number));
  const stories = checked.filter((i) => i.kind === "story").length;
  const listed = { import: toImport, known, closed }[view];
  const chip = (name: View, label: string, n?: number) => (
    <button
      type="button"
      aria-pressed={view === name}
      onClick={() => setView(name)}
      className={chipLink({ isActive: view === name })}
    >
      {n === undefined ? label : `${label} · ${n}`}
    </button>
  );
  const failed = issues.error ?? run.error;

  return (
    <main>
      <Breadcrumb
        trail={[
          { label: "Projets", to: "/projets" },
          {
            label: fullName ? repoName(fullName) : "Projet",
            to: `/projets/${id}`,
          },
          { label: "Tickets", to: `/projets/${id}/tickets` },
        ]}
      />
      <StateSentence
        title={
          issues.data
            ? `${plural(all.filter((i) => i.state === "open").length, "issue ouverte", "issues ouvertes")} sur ${fullName ?? "ce repo"}.`
            : "Importer les issues"
        }
        rest="Rien n'est écrit sur GitHub. Tu peux relancer l'import sans doublon."
      />
      <section className="mx-[26px] mt-4" aria-live="polite">
        {issues.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {failed && (
          <p role="alert" className={alertBox}>
            {failed instanceof GithubDown
              ? UNREACHABLE
              : run.error
                ? run.error.message
                : "Impossible de lire les issues."}
          </p>
        )}
        {run.isSuccess && (
          <p className="mb-3">
            {plural(run.data.tickets, "issue importée", "issues importées")}.{" "}
            <Link
              to={`/projets/${id}/tickets`}
              className={`font-semibold hover:underline ${focusRing}`}
            >
              Voir les tickets
            </Link>
          </p>
        )}
        {issues.data && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {chip("import", "À importer", toImport.length)}
              {chip("known", "Déjà dans Cockpit", known.length)}
              {chip("closed", "Fermées")}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setUnchecked(new Set())}
                  className={button}
                >
                  Tout cocher
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setUnchecked(new Set(toImport.map((i) => i.number)))
                  }
                  className={button}
                >
                  Tout décocher
                </button>
              </div>
            </div>
            {listed.length > 0 && (
              <ul className={listCard}>
                {listed.map((issue) => (
                  <li
                    key={issue.number}
                    className={`flex min-h-[50px] items-center gap-3.5 px-4 py-2 ${view === "import" ? "" : "text-muted-foreground"}`}
                  >
                    {view === "import" && (
                      <input
                        type="checkbox"
                        aria-label={`Importer l'issue #${issue.number}`}
                        checked={!unchecked.has(issue.number)}
                        onChange={() => {
                          const next = new Set(unchecked);
                          if (!next.delete(issue.number))
                            next.add(issue.number);
                          setUnchecked(next);
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        #{issue.number} · {issue.title}
                      </span>
                      <span className="block text-[12.5px] text-muted-foreground">
                        {subtitle(issue)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={checked.length === 0 || run.isPending}
                onClick={() => run.mutate(checked.map((i) => i.number))}
                className={primaryButton}
              >
                Importer {plural(checked.length, "issue", "issues")}
              </button>
              <p className="text-[12.5px] text-muted-foreground">
                {stories} deviendront des US validées,{" "}
                {checked.length - stories} des tickets que Claude transformera
                en US.
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
