import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { RunQuestions } from "./RunQuestions.tsx";
import { CRITERION_RESULTS, RUN_STATUSES } from "./tickets.ts";
import { alertBox, button, card, focusRing, primaryButton } from "./ui.ts";
import { useChanges } from "./useChanges.ts";

/** The run with its steps, story and project, "not_found" when the user cannot reach it, or null when the server answers 401. */
async function fetchRun(id: string) {
  const res = await client.api.runs[":id"].$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const duration = (from: string, to: string | null) => {
  if (!to) return null;
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

const label = "font-semibold";

/** What Claude does on a story, live (decision 033 I). */
export function RunPage() {
  const { id = "" } = useParams();
  const result = useQuery({
    queryKey: ["run", id],
    queryFn: () => fetchRun(id),
  });
  useChanges(`run:${id}`);
  const found = result.data && result.data !== "not_found" && result.data;

  return (
    <main className="mx-auto max-w-[880px] px-4 sm:px-7 py-8">
      <div aria-live="polite">
        {result.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {result.isError && (
          <div role="alert" className={alertBox}>
            <p>Impossible de lire le run.</p>
            <button
              type="button"
              onClick={() => result.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {result.data === null && (
          <a href="/api/auth/login" className={primaryButton}>
            Se connecter avec GitHub
          </a>
        )}
        {result.data === "not_found" && (
          <>
            <Link to="/projets" className={`underline ${focusRing}`}>
              ← Projets
            </Link>
            <h1 className="mt-4 font-heading text-3xl font-extrabold">
              Run introuvable
            </h1>
          </>
        )}
        {found && (
          <>
            <Link
              to={`/us/${found.story.id}`}
              className={`underline ${focusRing}`}
            >
              ← {found.story.iWant}
            </Link>
            <h1 className="mt-4 font-heading text-3xl font-extrabold">
              Run n° {found.run.id}
            </h1>
            <p className="mt-2">
              <span className="rounded-full bg-claude-soft px-3 py-1 font-semibold text-claude-text">
                {RUN_STATUSES[found.run.status] ?? found.run.status}
              </span>
              <span className="ml-3 text-muted-foreground">
                {found.project.name}
              </span>
            </p>
            <div className="mt-4 grid gap-1">
              <p>
                <span className={label}>Branche</span> {found.run.branch}
              </p>
              <p>
                <span className={label}>Modèle</span> {found.run.model}
              </p>
              {found.run.comment && (
                <p>
                  <span className={label}>Consigne</span>{" "}
                  <span className="whitespace-pre-wrap">
                    {found.run.comment}
                  </span>
                </p>
              )}
            </div>
            <section className="mt-6">
              <h2 className="font-heading text-xl font-bold">Étapes</h2>
              <ol className="mt-2 grid gap-2">
                {found.steps.map((step) => (
                  <li key={step.id} className={`${card} p-3`}>
                    <p>
                      <span className={label}>{step.agent}</span>{" "}
                      <span className="text-muted-foreground">
                        {RUN_STATUSES[step.status] ?? step.status}
                        {duration(step.startedAt, step.finishedAt) &&
                          ` · ${duration(step.startedAt, step.finishedAt)}`}
                      </span>
                    </p>
                    {step.summary && (
                      <p className="mt-1 whitespace-pre-wrap">{step.summary}</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            <section className="mt-6">
              <h2 className="font-heading text-xl font-bold">Critères</h2>
              <ol className="mt-2 grid gap-2">
                {(found.criteria ?? []).map((criterion) => (
                  <li key={criterion.id} className={`${card} p-3`}>
                    <p>
                      <span className={label}>Étant donné</span>{" "}
                      {criterion.given}
                    </p>
                    <p>
                      <span className={label}>Quand</span> {criterion.when}
                    </p>
                    <p>
                      <span className={label}>Alors</span> {criterion.then}
                    </p>
                    <p className="mt-1">
                      <span className={label}>
                        {criterion.result
                          ? CRITERION_RESULTS[criterion.result]
                          : "Non signalé dans ce run"}
                      </span>{" "}
                      <span className="whitespace-pre-wrap text-muted-foreground">
                        {criterion.evidence}
                      </span>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
            <RunQuestions
              runId={id}
              running={found.run.status === "running"}
              questions={found.questions ?? []}
            />
            {found.run.summary && (
              <section className="mt-6">
                <h2 className="font-heading text-xl font-bold">Résumé</h2>
                <p className="mt-2 whitespace-pre-wrap">{found.run.summary}</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
