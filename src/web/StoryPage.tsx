// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import Markdown from "react-markdown";
import { Link, useParams } from "react-router";
import { fetchRun } from "./RunPage.tsx";
import { RunVerdict } from "./RunVerdict.tsx";
import { atLeast } from "./roles.ts";
import { Breadcrumb, repoName, StateSentence } from "./Shell.tsx";
import { StoryBody } from "./StoryBody.tsx";
import { fetchStory, StoryDecisions, StoryHistory } from "./StoryDecisions.tsx";
import { StoryDiverged } from "./StoryDiverged.tsx";
import { StoryGitHub } from "./StoryGitHub.tsx";
import { StoryIssue } from "./StoryIssue.tsx";
import { RUN_STATUSES, STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  button,
  focusRing,
  listCard,
  markdownStyle,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { useChanges } from "./useChanges.ts";

/** The verdict of the latest run of a story in review (decision 039 E), the same as on the page of the run. */
export function StoryVerdict({ runId }: { runId: number }) {
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
      summary={data.run.summary}
      prUrl={
        data.story.prNumber == null
          ? null
          : `https://github.com/${data.project.name}/pull/${data.story.prNumber}`
      }
      projectId={data.project.id}
      criteriaTo={`/runs/${runId}#criteres`}
    />
  ) : null;
}

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
  const mayValidate = atLeast(
    found ? found.project.role : undefined,
    "can_validate",
  );
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
          <p className="loading px-[26px] pt-[26px] text-muted-foreground">
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
                archived={found.project.archived || !mayValidate}
                statusRef={statusRef}
              />
            )}
            <div className="px-[26px] pt-[22px]">
              <StoryBody found={found} />
            </div>
            {found.story.issue && (
              <StoryIssue
                id={found.story.id}
                issue={found.story.issue}
                archived={found.project.archived || !mayValidate}
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
                c.takeoverState === "pending"
                  ? [{ id: c.id, summary: c.summary ?? "" }]
                  : [],
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
