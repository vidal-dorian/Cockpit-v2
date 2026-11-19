import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { client } from "./api.ts";
import { Dot } from "./Shell.tsx";
import { fetchStory, StoryDecisions } from "./StoryDecisions.tsx";
import { TicketTags } from "./TagField.tsx";
import { TicketPanel } from "./TicketPanel.tsx";
import { fetchTickets, plural, STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  chipLink,
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

/** The panel of an open US card (decision 069 H): the decisions of its page, headed by the way to the page and to its running run. */
function StoryCardPanel({ id }: { id: string }) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const found = useQuery({
    queryKey: ["story", id],
    queryFn: () => fetchStory(id),
  }).data;
  if (!found || found === "not_found") return null;
  const { story, project } = found;
  const running = story.runs?.find((run) => run.status === "running");
  return (
    <StoryDecisions
      key={story.id}
      story={story}
      project={project}
      archived={project.archived}
      statusRef={statusRef}
      toDecide={story.criteria.flatMap((c) =>
        c.takeoverState === "pending" ? [c.summary ?? ""] : [],
      )}
    >
      <p ref={statusRef} tabIndex={-1} className="text-[12.5px]">
        US {story.id} ·{" "}
        <Link to={`/us/${story.id}`} className={`underline ${focusRing}`}>
          Ouvrir l'US
        </Link>
        {running && (
          <>
            {" · "}
            <Link
              to={`/runs/${running.id}`}
              className={`underline ${focusRing}`}
            >
              Run {running.id} ↗
            </Link>
          </>
        )}
      </p>
    </StoryDecisions>
  );
}

/** The « Kanban » section of the project page: a card opens in the right panel, at ?us=<id> or ?ticket=<id> (decision 069 G; no drag and drop, brief §6.3). */
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
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // An id that is not a card of the board opens nothing.
  const openStory = board?.find(
    (s) => s.status !== "abandoned" && String(s.id) === params.get("us"),
  );
  const openIdea = ideas.find((t) => String(t.id) === params.get("ticket"));
  const cardId = openStory ? `us-${openStory.id}` : `ticket-${openIdea?.id}`;
  const close = () => {
    navigate({ search: "" });
    document.getElementById(cardId)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // A form of the panel keeps its Escape, and the ticket panel closes itself.
    if (
      event.key !== "Escape" ||
      !(openStory || openIdea) ||
      target.closest("form") ||
      (openIdea && target.closest("aside"))
    )
      return;
    close();
  };
  const countOf = (name: string) =>
    name === "Idées"
      ? ideas.length
      : (board ?? []).filter(
          (s) => s.status !== "abandoned" && COLUMN_OF[s.status] === name,
        ).length;
  // The column shown below sm (083 C2): the first filled one of what waits for the user, else of the board, else Idées.
  const [chosen, setChosen] = useState<{
    projectId: string;
    name: string;
  } | null>(null);
  // The choice belongs to its project: the component stays mounted from one project to the next.
  const shown =
    (chosen?.projectId === projectId ? chosen.name : null) ??
    ["À valider", "Prêtes", "En revue"].find((n) => countOf(n) > 0) ??
    COLUMNS.find(({ name }) => countOf(name) > 0)?.name ??
    "Idées";
  // Below lg the right panel is not fixed on the right: a card goes to its page (083 C3). The width is read at the touch.
  const toPage = (path: string) => (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      window.matchMedia?.("(min-width: 1024px)").matches !== false
    )
      return;
    event.preventDefault();
    navigate(path);
  };
  // Red only for the story the page sentence names, the first one waiting on an answer (decision 045 C).
  const asking = board?.find((s) => s.questionPending)?.id;

  return (
    <section
      className="mx-[26px] mt-5"
      aria-labelledby="kanban"
      onKeyDown={onKeyDown}
    >
      <h2 id="kanban" className="sr-only">
        Kanban
      </h2>
      <div aria-live="polite">
        {stories.isPending && (
          <p className="loading text-muted-foreground">Chargement…</p>
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
            <p className="mb-3 text-[12.5px] text-muted-foreground max-lg:hidden">
              Pas de glisser-déposer : un clic ouvre la carte à droite.
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its border and legend */}
            <div
              role="group"
              aria-label="Colonne affichée"
              className="mb-3 flex flex-wrap gap-2 sm:hidden"
            >
              {COLUMNS.map(({ name }) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={shown === name}
                  onClick={() => setChosen({ projectId, name })}
                  className={`${chipLink({ isActive: shown === name })} min-h-11`}
                >
                  {name} <span className={badge}>{countOf(name)}</span>
                </button>
              ))}
            </div>
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
                const count = countOf(name);
                const faded = name === "Terminées";
                return (
                  <section
                    key={name}
                    className={`sm:min-w-36 sm:flex-1 ${shown === name ? "" : "max-sm:hidden"}`}
                  >
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
                      <p className="loading text-muted-foreground">
                        Chargement…
                      </p>
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
                                id={`ticket-${t.id}`}
                                to={
                                  openIdea?.id === t.id
                                    ? { search: "" }
                                    : `?ticket=${t.id}`
                                }
                                onClick={toPage(`/tickets/${t.id}`)}
                                aria-current={
                                  openIdea?.id === t.id || undefined
                                }
                                className={`${cardStyle} ${focusRing}`}
                              >
                                <span className="block text-[13.5px] leading-snug font-semibold">
                                  {t.title}
                                </span>{" "}
                                <span className="block text-xs text-muted-foreground">
                                  ticket
                                </span>
                                <span className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
                                  <TicketTags
                                    tags={t.tags}
                                    priority={t.priority}
                                  />
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
                                id={`us-${story.id}`}
                                to={
                                  openStory?.id === story.id
                                    ? { search: "" }
                                    : `?us=${story.id}`
                                }
                                onClick={toPage(`/us/${story.id}`)}
                                aria-current={
                                  openStory?.id === story.id || undefined
                                }
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
      {openStory && <StoryCardPanel id={String(openStory.id)} />}
      {openIdea && (
        <TicketPanel
          key={openIdea.id}
          ticket={openIdea}
          stories={(board ?? []).filter((s) => s.ticketId === openIdea.id)}
          onClose={close}
        />
      )}
    </section>
  );
}
