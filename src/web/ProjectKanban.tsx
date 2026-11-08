import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { client } from "./api.ts";
import { Dot } from "./Shell.tsx";
import { fetchTickets, plural, STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  focusRing,
  primaryButton,
  urgentBadge,
} from "./ui.ts";

/** The non-abandoned stories of a project, by ticket then position (decision 019), or null when the server answers 401. */
export async function fetchStories(id: string) {
  const res = await client.api.projects[":id"].stories.$get({ param: { id } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).stories;
}

type StoryStatus = NonNullable<
  Awaited<ReturnType<typeof fetchStories>>
>[number]["status"];

// The six columns, in order: the dot names the « temps », the line says who moves the card (019 B modified by screen S00b of decision 045: the Idées column comes first).
const COLUMNS = [
  { name: "Idées", dot: "idea", sub: "Claude écrit les US" },
  { name: "À valider", dot: "you", sub: "à toi" },
  { name: "Prêtes", dot: "you", sub: "à toi de lancer" },
  { name: "En cours", dot: "claude", sub: "Claude développe" },
  { name: "En revue", dot: "you", sub: "à toi de relire" },
  { name: "Terminées", dot: "done", sub: "c'est fait" },
] as const;

const cardStyle =
  "flex flex-col items-start gap-2 rounded-[14px] border border-border bg-card p-3 hover:border-border-strong hover:bg-raised";

// The column of each status; `satisfies` makes tsc fail when a story status has no column (abandoned has none).
const COLUMN_OF = {
  to_validate: "À valider",
  to_rewrite: "À valider",
  ready: "Prêtes",
  in_progress: "En cours",
  in_review: "En revue",
  done: "Terminées",
} satisfies Record<
  Exclude<StoryStatus, "abandoned">,
  (typeof COLUMNS)[number]["name"]
>;

/** The « Kanban » section of the project page: read-only, a card opens its story (no drag and drop, brief §6.3). */
export function ProjectKanban({ projectId }: { projectId: string }) {
  const stories = useQuery({
    queryKey: ["stories", projectId],
    queryFn: () => fetchStories(projectId),
  });

  const tickets = useQuery({
    queryKey: ["tickets", projectId],
    queryFn: () => fetchTickets(projectId),
  });
  const ideas = (tickets.data ?? []).filter((t) => t.step === "new");

  const board = stories.data; // a const, so the narrowing holds inside the callbacks below
  // Red only for the story the page sentence names, the first one waiting on an answer (decision 045 C).
  const asking = board?.find((s) => s.questionPending)?.id;

  return (
    <section className="mx-[26px] mt-5" aria-labelledby="kanban">
      <h2 id="kanban" className="sr-only">
        Kanban
      </h2>
      <div aria-live="polite">
        {stories.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {stories.isError && (
          <div role="alert" className={alertBox}>
            <p>Impossible de lire les user stories.</p>
            <button
              type="button"
              onClick={() => stories.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {stories.isSuccess && stories.data === null && (
          <a href="/api/auth/login" className={primaryButton}>
            Se connecter avec GitHub
          </a>
        )}
        {board && (
          <>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Pas de glisser-déposer : un clic ouvre la carte.
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: a <section> with this role is flagged as redundant, and the role is wanted explicit */}
            <div
              role="region"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1)
              tabIndex={0}
              aria-label="Colonnes du Kanban"
              className={`flex flex-col gap-3 sm:flex-row sm:overflow-x-auto ${focusRing}`}
            >
              {COLUMNS.map(({ name, dot, sub }) => {
                const cards = board.filter(
                  (s) =>
                    s.status !== "abandoned" && COLUMN_OF[s.status] === name,
                );
                const count = name === "Idées" ? ideas.length : cards.length;
                const faded = name === "Terminées";
                return (
                  <section key={name} className="sm:min-w-36 sm:flex-1">
                    <h3
                      aria-label={`${name} (${count})`}
                      className="flex items-center gap-2 px-0.5 text-[13px] font-semibold"
                    >
                      <Dot tone={dot} />
                      {name} <span className={badge}>{count}</span>
                    </h3>
                    <p className="mt-0.5 mb-2.5 px-0.5 text-xs text-muted-foreground">
                      {sub}
                    </p>
                    {name === "Idées" && tickets.isPending ? (
                      <p className="text-muted-foreground">Chargement…</p>
                    ) : name === "Idées" && tickets.isError ? (
                      <p className="text-destructive">
                        Impossible de lire les tickets.
                      </p>
                    ) : count === 0 ? (
                      <p className="text-muted-foreground">Aucune</p>
                    ) : (
                      <ul className="grid grid-cols-1 gap-2">
                        {name === "Idées" &&
                          ideas.map((t) => (
                            <li key={t.id}>
                              <Link
                                to={`/tickets/${t.id}`}
                                className={`${cardStyle} ${focusRing}`}
                              >
                                <span className="block text-[13.5px] leading-snug font-semibold">
                                  {t.title}
                                </span>{" "}
                                <span className="block text-xs text-muted-foreground">
                                  ticket
                                </span>
                              </Link>
                            </li>
                          ))}
                        {cards.map((story) => {
                          const detail = [
                            story.status === "to_validate" ||
                            story.status === "ready"
                              ? plural(
                                  story.criteriaCount,
                                  "critère",
                                  "critères",
                                )
                              : null,
                            story.prNumber ? `PR #${story.prNumber}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <li key={story.id}>
                              <Link
                                to={`/us/${story.id}`}
                                className={`${cardStyle} ${story.id === asking ? "border-you-line!" : ""} ${focusRing} ${faded ? "opacity-60" : ""}`}
                              >
                                {/* The {" "} separators keep the visible words apart in the accessible name and in textContent. */}
                                <span className="block text-[13.5px] leading-snug font-semibold">
                                  US {story.id} · {story.iWant}
                                </span>{" "}
                                <span className="block text-xs text-muted-foreground">
                                  <span className="sr-only">Ticket : </span>
                                  {story.ticketTitle}
                                </span>{" "}
                                {detail && (
                                  <span className="block text-xs text-muted-foreground">
                                    {detail}
                                  </span>
                                )}{" "}
                                {story.issueDiverged && (
                                  <span
                                    className={`max-w-full whitespace-normal! ${urgentBadge}`}
                                  >
                                    Issue modifiée sur GitHub
                                  </span>
                                )}
                                {story.questionPending ? (
                                  <span
                                    className={
                                      story.id === asking ? urgentBadge : badge
                                    }
                                  >
                                    ✦ Question pour toi
                                  </span>
                                ) : story.prCiState === "failure" &&
                                  story.status === "in_review" ? (
                                  <span className={badge}>✕ CI en échec</span>
                                ) : (
                                  story.status !== "in_progress" && (
                                    <span
                                      className={`${badge} first-letter:uppercase`}
                                    >
                                      {STORY_STATUSES[story.status]}
                                    </span>
                                  )
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
