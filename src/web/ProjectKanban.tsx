import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { client } from "./api.ts";
import { fetchTickets } from "./ProjectTickets.tsx";
import { Dot } from "./Shell.tsx";
import { STORY_STATUSES } from "./tickets.ts";
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

// The six columns, in order: the dot names the « temps », the line says who moves the card (decision 045 H).
const COLUMNS = [
  { name: "Idées", dot: "idea", sub: "Claude écrit les US" },
  { name: "À valider", dot: "you", sub: "à toi" },
  { name: "Prêtes", dot: "you", sub: "à toi de lancer" },
  { name: "En cours", dot: "claude", sub: "Claude développe" },
  { name: "En revue", dot: "you", sub: "à toi de relire" },
  { name: "Terminées", dot: "done", sub: "c'est fait" },
] as const;

const cardStyle =
  "block rounded-xl border border-border bg-card px-[13px] py-[11px] hover:border-border-strong hover:bg-raised";

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
                  <section key={name} className="sm:min-w-48 sm:flex-1">
                    <h3
                      aria-label={`${name} (${count})`}
                      className="flex items-center gap-2 text-sm font-bold"
                    >
                      <Dot tone={dot} />
                      {name} <span className={badge}>{count}</span>
                    </h3>
                    <p className="mt-0.5 mb-2 text-[12.5px] text-dim">{sub}</p>
                    {count === 0 ? (
                      <p className="text-muted-foreground">Aucune</p>
                    ) : (
                      <ul className="grid gap-2">
                        {name === "Idées" &&
                          ideas.map((t) => (
                            <li key={t.id}>
                              <Link
                                to={`/tickets/${t.id}`}
                                className={`${cardStyle} ${focusRing}`}
                              >
                                <span className="block text-[13px] font-bold">
                                  {t.title}
                                </span>{" "}
                                <span className="block text-xs text-muted-foreground">
                                  ticket
                                </span>
                              </Link>
                            </li>
                          ))}
                        {cards.map((story) => (
                          <li key={story.id}>
                            <Link
                              to={`/us/${story.id}`}
                              className={`${cardStyle} ${focusRing} ${faded ? "opacity-60" : ""}`}
                            >
                              {/* The {" "} separators keep the visible words apart in the accessible name and in textContent. */}
                              <span className="block text-[13px] font-bold">
                                {story.iWant}
                              </span>{" "}
                              <span className="block text-xs text-muted-foreground">
                                <span className="sr-only">Ticket : </span>
                                {story.ticketTitle}
                              </span>{" "}
                              {story.issueDiverged && (
                                <span className={`mt-1 mr-2 ${urgentBadge}`}>
                                  Issue modifiée sur GitHub
                                </span>
                              )}
                              {story.status === "to_rewrite" && (
                                <span className={`mt-1 ${badge}`}>
                                  {STORY_STATUSES.to_rewrite}
                                </span>
                              )}
                            </Link>
                          </li>
                        ))}
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
