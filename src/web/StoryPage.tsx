// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import Markdown from "react-markdown";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { Breadcrumb, StateSentence } from "./Shell.tsx";
import { StoryDecisions, StoryHistory } from "./StoryDecisions.tsx";
import { StoryDiverged } from "./StoryDiverged.tsx";
import { StoryGitHub } from "./StoryGitHub.tsx";
import { StoryIssue } from "./StoryIssue.tsx";
import { CRITERION_RESULTS, RUN_STATUSES, STORY_STATUSES } from "./tickets.ts";
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

/** The story with its ticket and project, "not_found" when the user cannot reach it, or null when the server answers 401. */
async function fetchStory(id: string) {
  const res = await client.api.stories[":id"].$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const label = "font-semibold text-foreground";

/** What the state of a story says, the status word included (the title of the page is the story, this is the rest of the sentence). */
function stateSentence(status: string, prNumber: number | null) {
  const word = STORY_STATUSES[status] ?? status;
  switch (status) {
    case "to_validate":
      return `Écrite par Claude, ${word} : attend ta validation.`;
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
                  label: found.project.fullName,
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
              <p
                className={`${card} px-[18px] py-4 text-[15px] leading-relaxed`}
              >
                <span className={label}>En tant que</span>{" "}
                <span>{found.story.asA}</span>,{" "}
                <span className={label}>je veux</span>{" "}
                <span>{found.story.iWant}</span>{" "}
                <span className={label}>afin de</span>{" "}
                <span>{found.story.soThat}</span>
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
              <h2 className="sr-only">Critères</h2>
              <ol className="grid gap-3">
                {found.story.criteria.map((criterion, index) => (
                  <li key={criterion.id} className={`${card} px-4 py-3.5`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className={sectionLabel}>Critère {index + 1}</p>
                      {criterion.result && (
                        <span className={badge}>
                          {CRITERION_RESULTS[criterion.result]}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 leading-relaxed">
                      <span className={label}>Étant donné</span>{" "}
                      {criterion.given}
                    </p>
                    <p className="leading-relaxed">
                      <span className={label}>Quand</span> {criterion.when}
                    </p>
                    <p className="leading-relaxed">
                      <span className={label}>Alors</span> {criterion.then}
                    </p>
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
              <Section title="Dépend de">
                <ul className={listCard}>
                  {found.story.dependsOn.map((dependency) => (
                    <li
                      key={dependency.id}
                      className="flex min-h-[50px] flex-wrap items-center gap-x-3 px-4 py-2"
                    >
                      <Link
                        to={`/us/${dependency.id}`}
                        className={`font-semibold underline ${focusRing}`}
                      >
                        {dependency.iWant}
                      </Link>
                      <span className="text-muted-foreground">
                        {STORY_STATUSES[dependency.status] ?? dependency.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
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
              <Section title="Runs">
                <ul className={listCard}>
                  {found.story.runs.map((run) => (
                    <li
                      key={run.id}
                      className="flex min-h-[50px] flex-wrap items-center gap-x-3 px-4 py-2"
                    >
                      <Link
                        to={`/runs/${run.id}`}
                        className={`font-semibold underline ${focusRing}`}
                      >
                        Run n° {run.id} ·{" "}
                        {RUN_STATUSES[run.status] ?? run.status}
                      </Link>
                      <span className="text-[12.5px] text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString("fr-FR")}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <StoryHistory id={found.story.id} />
            <StoryDecisions
              key={found.story.id}
              story={found.story}
              project={found.project}
              archived={found.project.archived}
              statusRef={statusRef}
            >
              {found.story.status === "in_review" && github}
            </StoryDecisions>
          </>
        )}
      </div>
    </main>
  );
}
