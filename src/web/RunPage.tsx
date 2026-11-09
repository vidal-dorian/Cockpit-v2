import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { dollars } from "./Cost.tsx";
import { RunControls } from "./RunControls.tsx";
import { RunQuestions } from "./RunQuestions.tsx";
import { RunAction, RunVerdict } from "./RunVerdict.tsx";
import { Breadcrumb, repoName, StateSentence } from "./Shell.tsx";
import { CRITERION_RESULTS, RUN_STATUSES } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { useChanges } from "./useChanges.ts";
import { clock, elapsed } from "./when.ts";

/** The run with its steps, story and project, "not_found" when the user cannot reach it, or null when the server answers 401. */
export async function fetchRun(id: string) {
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

type Run = Exclude<Awaited<ReturnType<typeof fetchRun>>, "not_found" | null>;

// The 28 px square of a row (S29): done fades, the current one is outlined, the one that waits for you is red, the others are plain.
const MARKS = {
  done: { glyph: "✓", style: "border-border bg-raised text-past" },
  stopped: { glyph: "✕", style: "border-border-strong text-muted-foreground" },
  current: { glyph: "…", style: "border-foreground text-foreground" },
  waiting: { glyph: "✦", style: "border-you-soft bg-you-soft text-you-text" },
  none: { glyph: "·", style: "border-border-strong text-dim" },
};

function Mark({ kind, rank }: { kind: keyof typeof MARKS; rank?: number }) {
  const { glyph, style } = MARKS[kind];
  return (
    <span
      aria-hidden="true"
      className={`grid size-7 flex-none place-items-center rounded-lg border text-[13px] ${style}`}
    >
      {rank ?? glyph}
    </span>
  );
}

/** The steps reported, then those to come and the PR row (decision 069 C); a finished run has only the first. */
function Steps({
  steps,
  askedAt = null,
  upcoming = [],
  pr,
}: {
  steps: Run["steps"];
  /** When the pending question was asked: the open step waits for the answer since then. */
  askedAt?: string | null;
  upcoming?: string[];
  pr?: Run["story"];
}) {
  const grey = "text-dim";
  return (
    <ol className={listCard}>
      {steps.map((step) => {
        const asking = askedAt !== null && step.status === "running";
        return (
          <li
            key={step.id}
            className="flex min-h-[50px] items-start gap-3 px-4 py-2.5"
          >
            <Mark
              kind={
                asking
                  ? "waiting"
                  : step.status === "running"
                    ? "current"
                    : step.status === "succeeded"
                      ? "done"
                      : "stopped"
              }
            />
            <div className="min-w-0">
              <p>
                <span className="font-semibold">{step.agent}</span>{" "}
                <span className="text-[13px] text-muted-foreground">
                  {asking
                    ? `attend ta réponse depuis ${elapsed(askedAt)}`
                    : (RUN_STATUSES[step.status] ?? step.status)}
                  {duration(step.startedAt, step.finishedAt) &&
                    ` · ${duration(step.startedAt, step.finishedAt)}`}
                </span>
              </p>
              {step.summary && (
                <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
                  {step.summary}
                </p>
              )}
            </div>
            <time
              dateTime={step.startedAt}
              className="ml-auto text-[13px] text-muted-foreground"
            >
              {clock(step.startedAt)}
            </time>
          </li>
        );
      })}
      {upcoming.map((agent, i) => (
        <li
          key={agent}
          className={`flex min-h-[50px] items-center gap-3 px-4 py-2.5 ${grey}`}
        >
          <Mark kind="none" rank={steps.length + i + 1} />
          <span className="font-semibold">{agent}</span>
          <span className="text-[13px]">à venir</span>
        </li>
      ))}
      {pr && (
        <li
          className={`flex min-h-[50px] items-center gap-3 px-4 py-2.5 ${pr.prNumber === null ? grey : ""}`}
        >
          <Mark
            kind={pr.prNumber === null ? "none" : "done"}
            rank={
              pr.prNumber === null
                ? steps.length + upcoming.length + 1
                : undefined
            }
          />
          <span className="font-semibold">PR</span>
          <span className="text-[13px]">
            {pr.prNumber === null
              ? "Claude pousse la branche et ouvre la PR"
              : `PR #${pr.prNumber} ouverte`}
          </span>
        </li>
      )}
    </ol>
  );
}

function Criteria({ criteria }: { criteria: NonNullable<Run["criteria"]> }) {
  const passed = criteria.filter((k) => k.result === "passed").length;
  return (
    <section>
      <h2 className={sectionLabel}>
        Les critères{" "}
        <span className="font-normal tracking-normal normal-case">
          · {passed} sur {criteria.length}
        </span>
      </h2>
      <ol className={`${listCard} mt-2`}>
        {criteria.map((criterion) => (
          <li
            key={criterion.id}
            className="flex min-h-[50px] items-start gap-3 px-4 py-2.5"
          >
            <Mark
              kind={
                criterion.result === "passed"
                  ? "done"
                  : criterion.result === "failed"
                    ? "stopped"
                    : "none"
              }
            />
            <div className="min-w-0">
              <p>
                <span className="font-semibold">Étant donné</span>{" "}
                {criterion.given}
              </p>
              <p>
                <span className="font-semibold">Quand</span> {criterion.when}
              </p>
              <p>
                <span className="font-semibold">Alors</span> {criterion.then}
              </p>
              <p className="mt-1 text-[13px]">
                <span className="font-semibold">
                  {criterion.result
                    ? CRITERION_RESULTS[criterion.result]
                    : "Non signalé dans ce run"}
                </span>{" "}
                <span className="whitespace-pre-wrap text-muted-foreground">
                  {criterion.evidence}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What Claude does on a story, live (decision 033 I). */
export function RunPage() {
  const { id = "" } = useParams();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const result = useQuery({
    queryKey: ["run", id],
    queryFn: () => fetchRun(id),
  });
  useChanges(`run:${id}`);
  const found = result.data && result.data !== "not_found" && result.data;
  const running = found && found.run.status === "running";
  const asked = running
    ? (found.questions ?? []).find((q) => q.answer === null)
    : undefined;
  const waiting = Boolean(asked);

  return (
    <main>
      <div aria-live="polite" className="pb-8">
        {result.isPending && (
          <p className="px-[26px] pt-[26px] text-muted-foreground">
            Chargement…
          </p>
        )}
        {result.isError && (
          <div role="alert" className={`mx-[26px] mt-[26px] ${alertBox}`}>
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
          <p className="px-[26px] pt-[26px]">
            <a href="/api/auth/login" className={primaryButton}>
              Se connecter avec GitHub
            </a>
          </p>
        )}
        {result.data === "not_found" && (
          <>
            <Breadcrumb
              trail={[{ label: "Projets", to: "/projets" }, { label: "Runs" }]}
            />
            <StateSentence
              title="Run introuvable."
              rest="Il n'existe pas, ou tu n'y as pas accès."
            />
          </>
        )}
        {found && (
          <>
            <Breadcrumb
              trail={[
                { label: "Projets", to: "/projets" },
                {
                  label: repoName(found.project.name),
                  to: `/projets/${found.project.id}`,
                },
                { label: `US ${found.story.id}`, to: `/us/${found.story.id}` },
                { label: "Runs" },
              ]}
            />
            <StateSentence
              headingRef={titleRef}
              title={`Run ${found.run.id} · ${
                waiting
                  ? "Claude attend ta réponse"
                  : (
                      RUN_STATUSES[found.run.status] ?? found.run.status
                    ).toLowerCase()
              }.`}
              rest={
                <Link
                  to={`/us/${found.story.id}`}
                  className={`rounded-md hover:text-foreground ${focusRing}`}
                >
                  US {found.story.id} · {found.story.iWant}
                </Link>
              }
              actions={
                <RunControls
                  runId={id}
                  running={found.run.status === "running"}
                  archived={found.project.archived}
                  stopRequested={found.run.stopRequestedAt !== null}
                  relaunchStoryId={
                    ["ready", "in_review"].includes(found.story.status)
                      ? found.story.id
                      : null
                  }
                />
              }
            />
            <div className="mt-5 grid gap-6 px-[26px]">
              <div className="-mb-3 grid gap-1 text-[12.5px] text-muted-foreground">
                <p>
                  <span className={badge}>
                    {RUN_STATUSES[found.run.status] ?? found.run.status}
                  </span>{" "}
                  branche{" "}
                  <span className="font-mono text-[12px]">
                    {found.run.branch}
                  </span>{" "}
                  · modèle {found.run.model} · {found.cloud ? "cloud" : "ce PC"}
                  {found.cloud?.sessionUrl && (
                    <>
                      {" "}
                      <a
                        href={found.cloud.sessionUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={`underline ${focusRing}`}
                      >
                        Voir la session ↗
                      </a>
                    </>
                  )}
                  {` · ${repoName(found.project.name)}`}
                  {running && ` · ${elapsed(found.run.startedAt)}`}
                </p>
                <p>
                  {found.costUsd == null
                    ? "coût inconnu"
                    : `Coût du run : ${dollars(found.costUsd)}`}
                  {found.stopReason === "budget" &&
                    " · Plafond atteint : arrêt demandé"}
                </p>
                {found.run.comment && (
                  <p>
                    Consigne :{" "}
                    <span className="whitespace-pre-wrap">
                      {found.run.comment}
                    </span>
                  </p>
                )}
              </div>
              {found.verdict && (
                <RunVerdict
                  verdict={found.verdict}
                  criteria={found.criteria ?? []}
                  story={found.story}
                />
              )}
              {running && (
                <section>
                  <h2 className={sectionLabel}>
                    Les étapes{" "}
                    <span className="font-normal tracking-normal normal-case">
                      · en direct
                    </span>
                  </h2>
                  <div className="mt-2">
                    <Steps
                      steps={found.steps}
                      askedAt={asked?.askedAt ?? null}
                      upcoming={found.upcomingSteps}
                      pr={found.story}
                    />
                  </div>
                </section>
              )}
              <Criteria criteria={found.criteria ?? []} />
              {found.verdict && found.story.prNumber != null && (
                <div>
                  <RunAction
                    prUrl={`https://github.com/${found.project.name}/pull/${found.story.prNumber}`}
                    merged={found.story.status === "done"}
                  />
                </div>
              )}
              {!running && (
                <details>
                  <summary
                    className={`cursor-pointer ${sectionLabel} ${focusRing}`}
                  >
                    Journal détaillé
                  </summary>
                  <div className="mt-2">
                    <Steps steps={found.steps} />
                  </div>
                </details>
              )}
              <RunQuestions
                runId={id}
                running={found.run.status === "running"}
                questions={found.questions ?? []}
                onAnswered={() => titleRef.current?.focus()}
              />
              {found.run.summary && (
                <section>
                  <h2 className={sectionLabel}>Résumé</h2>
                  <p className="mt-2 whitespace-pre-wrap">
                    {found.run.summary}
                  </p>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
