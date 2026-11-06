// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import Markdown from "react-markdown";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { DevelopWindow } from "./DevelopWindow.tsx";
import { StoryDecisions, StoryHistory } from "./StoryDecisions.tsx";
import { StoryDiverged } from "./StoryDiverged.tsx";
import { StoryGitHub } from "./StoryGitHub.tsx";
import { StoryIssue } from "./StoryIssue.tsx";
import { CRITERION_RESULTS, RUN_STATUSES, STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  button,
  card,
  focusRing,
  markdownStyle,
  primaryButton,
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

const label = "font-semibold";

/** The story, and the decisions of the user on it (decision 018). */
export function StoryPage() {
  const { id = "" } = useParams();
  const result = useQuery({
    queryKey: ["story", id],
    queryFn: () => fetchStory(id),
  });
  useChanges(`story:${id}`);
  const statusRef = useRef<HTMLSpanElement>(null);
  const found = result.data && result.data !== "not_found" && result.data;

  return (
    <main className="mx-auto max-w-[880px] px-4 sm:px-7 py-8">
      <div aria-live="polite">
        {result.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {result.isError && (
          <div role="alert" className={alertBox}>
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
              User story introuvable
            </h1>
          </>
        )}
        {found && (
          <>
            <Link
              to={`/tickets/${found.ticket.id}`}
              className={`underline ${focusRing}`}
            >
              ← {found.ticket.title}
            </Link>
            <h1 className="mt-4 font-heading text-3xl font-extrabold">
              User story {found.story.position}
            </h1>
            <p className="mt-2">
              <span
                ref={statusRef}
                tabIndex={-1}
                className={`rounded-full bg-claude-soft px-3 py-1 font-semibold text-claude-text ${focusRing}`}
              >
                {STORY_STATUSES[found.story.status] ?? found.story.status}
              </span>
              <span className="ml-3 text-muted-foreground">
                {found.project.fullName}
              </span>
            </p>
            {found.story.issue && (
              <StoryIssue
                id={found.story.id}
                issue={found.story.issue}
                archived={found.project.archived}
              />
            )}
            {found.story.issue?.diverged && (
              <StoryDiverged
                id={found.story.id}
                diverged={found.story.issue.diverged}
                archived={found.project.archived}
                statusRef={statusRef}
              />
            )}
            {found.story.status === "to_rewrite" &&
              found.story.rewriteComment && (
                <section className="mt-4 rounded-xl bg-you-soft p-4 text-you-text">
                  <h2 className="font-semibold">Ton commentaire pour Claude</h2>
                  <p className="mt-1 whitespace-pre-wrap">
                    {found.story.rewriteComment}
                  </p>
                </section>
              )}
            <StoryDecisions
              key={found.story.id}
              story={found.story}
              projectId={found.project.id}
              archived={found.project.archived}
              statusRef={statusRef}
            />
            {["ready", "in_review"].includes(found.story.status) &&
              !found.project.archived && (
                <DevelopWindow story={found.story} project={found.project} />
              )}
            <div className="mt-4 grid gap-1">
              <p>
                <span className={label}>En tant que</span> {found.story.asA}
              </p>
              <p>
                <span className={label}>Je veux</span> {found.story.iWant}
              </p>
              <p>
                <span className={label}>Afin de</span> {found.story.soThat}
              </p>
            </div>
            {found.story.prNumber != null && (
              <StoryGitHub
                story={{ ...found.story, prNumber: found.story.prNumber }}
                fullName={found.project.fullName}
              />
            )}
            {found.story.notesMd && (
              <section className="mt-6">
                <h2 className="font-heading text-xl font-bold">Notes</h2>
                {/* Same rules as a ticket description: no raw HTML, no remote image (decisions 014 H and 017 L). */}
                <div className={markdownStyle}>
                  <Markdown disallowedElements={["img"]}>
                    {found.story.notesMd}
                  </Markdown>
                </div>
              </section>
            )}
            <section className="mt-6">
              <h2 className="font-heading text-xl font-bold">Critères</h2>
              <ol className="mt-2 grid gap-2">
                {found.story.criteria.map((criterion) => (
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
                    {criterion.result && (
                      <p className="mt-1">
                        <span className={label}>
                          {CRITERION_RESULTS[criterion.result]}
                        </span>{" "}
                        <span className="whitespace-pre-wrap text-muted-foreground">
                          {criterion.evidence}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            {found.story.dependsOn.length > 0 && (
              <section className="mt-6">
                <h2 className="font-heading text-xl font-bold">Dépend de</h2>
                <ul className="mt-2 grid gap-2">
                  {found.story.dependsOn.map((dependency) => (
                    <li
                      key={dependency.id}
                      className={`flex flex-wrap items-baseline gap-x-3 ${card} p-3`}
                    >
                      <Link
                        to={`/us/${dependency.id}`}
                        className={`underline ${focusRing}`}
                      >
                        {dependency.iWant}
                      </Link>
                      <span className="text-muted-foreground">
                        {STORY_STATUSES[dependency.status] ?? dependency.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(found.story.runs ?? []).length > 0 && (
              <section className="mt-6">
                <h2 className="font-heading text-xl font-bold">Runs</h2>
                <ul className="mt-2 grid gap-2">
                  {found.story.runs.map((run) => (
                    <li key={run.id} className={`${card} p-3`}>
                      <Link
                        to={`/runs/${run.id}`}
                        className={`underline ${focusRing}`}
                      >
                        Run n° {run.id} ·{" "}
                        {RUN_STATUSES[run.status] ?? run.status}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString("fr-FR")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <StoryHistory id={found.story.id} />
          </>
        )}
      </div>
    </main>
  );
}
