// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import Markdown from "react-markdown";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { fetchRun } from "./RunPage.tsx";
import { RunVerdict } from "./RunVerdict.tsx";
import { Breadcrumb, repoName, StateSentence } from "./Shell.tsx";
import { StoryDecisions, StoryHistory } from "./StoryDecisions.tsx";
import { StoryDiverged } from "./StoryDiverged.tsx";
import { StoryGitHub } from "./StoryGitHub.tsx";
import { StoryIssue } from "./StoryIssue.tsx";
import { RUN_STATUSES, STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  card,
  focusRing,
  listCard,
  markdownStyle,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { useChanges } from "./useChanges.ts";

/** The verdict of the latest run of a story in review (decision 039 E), the same as on the page of the run. */
function StoryVerdict({ runId }: { runId: number }) {
  const run = useQuery({
    queryKey: ["run", String(runId)],
    queryFn: () => fetchRun(String(runId)),
  });
  const data = typeof run.data === "object" ? run.data : null;
  return data?.verdict ? (
    <RunVerdict
      verdict={data.verdict}
      criteria={data.criteria}
      story={data.story}
    />
  ) : null;
}

/** The story with its ticket and project, "not_found" when the user cannot reach it, or null when the server answers 401. */
async function fetchStory(id: string) {
  const res = await client.api.stories[":id"].$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const label = "font-semibold text-foreground";
const value = "text-muted-foreground";

/** What the state of a story says, the status word included (the title of the page is the story, this is the rest of the sentence). */
function stateSentence(status: string, prNumber: number | null) {
  const word = STORY_STATUSES[status] ?? status;
  switch (status) {
    case "to_validate":
      return "Écrite par Claude · attend ta validation.";
    case "to_rewrite":
      return `Renvoyée à Claude, ${word} : il la réécrit avec ton commentaire.`;
    case "ready":
      return `Elle est ${word}, personne n'y travaille encore.`;
    case "in_progress":
      return `Elle est ${word}, Claude la développe.`;
    case "in_review":
      return `Elle est ${word}${prNumber != null ? `, Claude a ouvert la PR #${prNumber}` : ""} : à toi de relire.`;
    default:
      return `Elle est ${word}.`;
  }
}

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** « 7 nov., 09:30 → 10:30 »: when a run started and ended. */
const runSpan = (run: { startedAt: string; finishedAt: string | null }) =>
  `${new Date(run.startedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${hour(run.startedAt)}${run.finishedAt ? ` → ${hour(run.finishedAt)}` : ""}`;

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="px-[26px] pt-[22px]">
    <h2 className={`mb-2 ${sectionLabel}`}>{title}</h2>
    {children}
  </section>
);

/** The story, and the decisions of the user on it (decision 018), in the right panel (decision 045). */
export function StoryPage() {
  const { id = "" } = useParams();
  const result = useQuery({
    queryKey: ["story", id],
    queryFn: () => fetchStory(id),
  });
  useChanges(`story:${id}`);
  const statusRef = useRef<HTMLSpanElement>(null);
  const found = result.data && result.data !== "not_found" && result.data;
  const diverged = found ? found.story.issue?.diverged : null;
  const pr =
    found && found.story.prNumber != null
      ? { ...found.story, prNumber: found.story.prNumber }
      : null;
  const latestRun = found
    ? found.story.runs?.reduce<{ id: number } | undefined>(
        (best, run) => (!best || run.id > best.id ? run : best),
        undefined,
      )
    : undefined;
  const github = pr && found && (
    <StoryGitHub story={pr} fullName={found.project.fullName} />
  );

  return (
    <main className="pb-6">
      <div aria-live="polite">
        {result.isPending && (
          <p className="px-[26px] pt-[26px] text-muted-foreground">
            Chargement…
          </p>
        )}
        {result.isError && (
          <div role="alert" className={`mx-[26px] mt-[26px] ${alertBox}`}>
            <p>Impossible de lire la user story.</p>
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
          <div className="px-[26px] pt-[26px]">
            <a href="/api/auth/login" className={primaryButton}>
              Se connecter avec GitHub
            </a>
          </div>
        )}
        {result.data === "not_found" && (
          <>
            <Breadcrumb trail={[{ label: "Projets", to: "/projets" }]} />
            <StateSentence
              title="User story introuvable."
              rest="Elle n'existe pas ou tu n'y as pas accès."
            />
          </>
        )}
        {found && (
          <>
            <Breadcrumb
              trail={[
                { label: "Projets", to: "/projets" },
                {
                  label: repoName(found.project.fullName),
                  to: `/projets/${found.project.id}`,
                },
                {
                  label: found.ticket.title,
                  to: `/tickets/${found.ticket.id}`,
                },
              ]}
            />
            <StateSentence
              title={
                diverged
                  ? `L'issue #${found.story.issue?.number} a été modifiée sur GitHub.`
                  : `US ${found.story.id} · ${found.story.iWant}`
              }
              rest={
                <span
                  ref={statusRef}
                  tabIndex={-1}
                  className={`rounded-md ${focusRing}`}
                >
                  {diverged
                    ? "Laquelle des deux versions garder ?"
                    : stateSentence(found.story.status, found.story.prNumber)}
                </span>
              }
            />
            {diverged && (
              <StoryDiverged
                id={found.story.id}
                diverged={diverged}
                archived={found.project.archived}
                statusRef={statusRef}
              />
            )}
            <div className="grid gap-3 px-[26px] pt-[22px]">
              <p className={`${card} px-[18px] py-4 text-[15px] leading-[1.6]`}>
                <span className={label}>En tant que</span>{" "}
                <span className={value}>{found.story.asA}</span>,{" "}
                <span className={label}>je veux</span>{" "}
                <span className={value}>{found.story.iWant}</span>{" "}
                <span className={label}>afin de</span>{" "}
                <span className={value}>{found.story.soThat}</span>
              </p>
              {found.story.status === "to_rewrite" &&
                found.story.rewriteComment && (
                  <section className={`${card} p-4`}>
                    <h2 className={sectionLabel}>
                      Ton commentaire pour Claude
                    </h2>
                    <p className="mt-1 whitespace-pre-wrap">
                      {found.story.rewriteComment}
                    </p>
                  </section>
                )}
            </div>
            <section className="px-[26px] pt-3">
              <h2
                className={`mb-2 flex items-baseline gap-2 ${found.story.criteria.some((k) => k.result) ? "" : "sr-only"}`}
              >
                <span className={sectionLabel}>Les critères</span>
                {found.story.criteria.some((k) => k.result) && (
                  <span className="text-[12.5px] text-muted-foreground">
                    · résultat de Claude, avec la preuve
                  </span>
                )}
              </h2>
              <ol className="grid gap-3">
                {found.story.criteria.map((criterion, index) => (
                  <li
                    key={criterion.id}
                    className={`${card} px-3.5 py-3 text-[13.5px] leading-normal`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className={sectionLabel}>Critère {index + 1}</p>
                      {criterion.result && (
                        <span className="ml-auto max-w-[70%] truncate rounded-[5px] bg-raised px-2 py-1 text-xs font-semibold text-muted-foreground">
                          {criterion.result === "passed"
                            ? "✓ passe"
                            : "✕ échoue"}
                          {criterion.evidence &&
                            ` · ${criterion.evidence.split("\n")[0]}`}
                        </span>
                      )}
                    </div>
                    {criterion.summary && (
                      <p className="mt-1.5 font-semibold">
                        {criterion.summary}
                      </p>
                    )}
                    <p className="mt-1.5 leading-relaxed">
                      <span className={label}>Étant donné</span>{" "}
                      <span className={value}>{criterion.given}</span>
                    </p>
                    <p className="mt-1">
                      <span className={label}>Quand</span>{" "}
                      <span className={value}>{criterion.when}</span>
                    </p>
                    <p className="mt-1">
                      <span className={label}>Alors</span>{" "}
                      <span className={value}>{criterion.then}</span>
                    </p>
                    {criterion.takeoverState && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
                        <span className={badge}>
                          {criterion.takeoverState === "kept"
                            ? found.story.kind === "takeover" &&
                              found.story.status === "done" &&
                              criterion.result === "passed"
                              ? "figée"
                              : "validée"
                            : "à relire"}
                        </span>
                        <Link
                          to={`/projets/${found.project.id}/conception/regles?regle=${criterion.id}`}
                          className={`font-semibold underline ${focusRing}`}
                        >
                          Juger dans l'écran de reprise
                        </Link>
                      </p>
                    )}
                    {criterion.result && criterion.evidence && (
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-muted-foreground">
                        {criterion.evidence}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            {found.story.issue && (
              <StoryIssue
                id={found.story.id}
                issue={found.story.issue}
                archived={found.project.archived}
              />
            )}
            {found.story.dependsOn.length > 0 && (
              <section className="px-[26px] pt-3 text-[12.5px] text-muted-foreground">
                <h2 className="sr-only">Dépend de</h2>
                <ul className="grid gap-1">
                  {found.story.dependsOn.map((dependency) => (
                    <li key={dependency.id}>
                      Dépend de{" "}
                      <Link
                        to={`/us/${dependency.id}`}
                        className={`underline ${focusRing}`}
                      >
                        {dependency.iWant}
                      </Link>{" "}
                      ({STORY_STATUSES[dependency.status] ?? dependency.status})
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {/* In review, the pull request is in the panel; otherwise it follows the story. */}
            {found.story.status !== "in_review" && github && (
              <div className="px-[26px] pt-[22px]">{github}</div>
            )}
            {found.story.notesMd && (
              <Section title="Notes">
                {/* Same rules as a ticket description: no raw HTML, no remote image (decisions 014 H and 017 L). */}
                <div className={markdownStyle}>
                  <Markdown disallowedElements={["img"]}>
                    {found.story.notesMd}
                  </Markdown>
                </div>
              </Section>
            )}
            {(found.story.runs ?? []).length > 0 && (
              <section className="px-[26px] pt-[22px]">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className={sectionLabel}>Les runs</h2>
                  <Link
                    to={`/runs/${latestRun?.id}`}
                    className={`text-[12.5px] text-muted-foreground hover:text-foreground ${focusRing}`}
                  >
                    Voir le run ›
                  </Link>
                </div>
                <ul className={listCard}>
                  {found.story.runs.map((run) => (
                    <li
                      key={run.id}
                      className="flex min-h-[50px] flex-col justify-center px-4 py-2"
                    >
                      <Link
                        to={`/runs/${run.id}`}
                        className={`font-semibold ${focusRing}`}
                      >
                        Run {run.id} ·{" "}
                        {(RUN_STATUSES[run.status] ?? run.status).toLowerCase()}
                      </Link>
                      <span className="text-[12.5px] text-muted-foreground">
                        {runSpan(run)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <StoryHistory id={found.story.id} />
            <StoryDecisions
              key={found.story.id}
              story={found.story}
              project={found.project}
              archived={found.project.archived}
              statusRef={statusRef}
              toDecide={found.story.criteria.flatMap((c) =>
                c.takeoverState === "pending" ? [c.summary ?? ""] : [],
              )}
            >
              {found.story.status === "in_review" && (
                <>
                  {github}
                  {latestRun && <StoryVerdict runId={latestRun.id} />}
                </>
              )}
            </StoryDecisions>
          </>
        )}
      </div>
    </main>
  );
}
