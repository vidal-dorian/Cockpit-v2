import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ComponentProps,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AnswerForm } from "./AnswerForm.tsx";
import { client } from "./api.ts";
import { fetchRun } from "./RunPage.tsx";
import { WhyAsked } from "./RunQuestions.tsx";
import { Dot, type Panel } from "./Shell.tsx";
import { StoryBody } from "./StoryBody.tsx";
import { fetchStory, StoryDecisions } from "./StoryDecisions.tsx";
import { StoryGitHub } from "./StoryGitHub.tsx";
import { StoryVerdict } from "./StoryPage.tsx";
import { TicketTags } from "./TagField.tsx";
import { TicketPanel } from "./TicketPanel.tsx";
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

/** The pending question of the story's running run (decision 084 G), answered where the card is opened. */
function CardQuestion({ runId }: { runId: number }) {
  const queryClient = useQueryClient();
  const run = useQuery({
    queryKey: ["run", String(runId)],
    queryFn: () => fetchRun(String(runId)),
  });
  const question =
    typeof run.data === "object"
      ? run.data?.questions.find((q) => q.answer === null)
      : undefined;
  return (
    question && (
      <section className="grid gap-3">
        <h3 className="text-base font-semibold break-words whitespace-pre-wrap">
          {question.question}
        </h3>
        <WhyAsked context={question.context} />
        <AnswerForm
          key={question.id}
          id={question.id}
          suggestedAnswers={question.suggestedAnswers}
          queryKey={["run", String(runId)]}
          onSent={() => {
            // The board and the panel read the story, not the run: they must see the question gone.
            queryClient.invalidateQueries({ queryKey: ["stories"] });
            queryClient.invalidateQueries({ queryKey: ["story"] });
          }}
        />
      </section>
    )
  );
}

/** The panel of an open US card (decisions 069 H and 084 G): the decisions of its page, with what is needed to take them (the story, the pull request, the question). */
function StoryCardPanel({
  id,
  counter,
  onDone,
}: {
  id: string;
  counter?: ComponentProps<typeof Panel>["counter"];
  onDone: (decidedId: number) => void;
}) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const found = useQuery({
    queryKey: ["story", id],
    queryFn: () => fetchStory(id),
  }).data;
  const loaded = found && found !== "not_found" ? found.story.id : null;
  // Under lg the panel follows the board: opening a card brings the focus and the view to it (decision 084 H).
  useEffect(() => {
    if (loaded === null) return;
    statusRef.current?.focus();
    statusRef.current?.scrollIntoView({ block: "nearest" });
  }, [loaded]);
  if (!found || found === "not_found") return null;
  const { story, project } = found;
  const running = story.runs?.find((run) => run.status === "running");
  const latestRun = story.runs?.reduce<{ id: number } | undefined>(
    (best, run) => (!best || run.id > best.id ? run : best),
    undefined,
  );
  const pr =
    story.prNumber != null ? { ...story, prNumber: story.prNumber } : null;
  return (
    <StoryDecisions
      story={story}
      project={project}
      archived={project.archived}
      statusRef={statusRef}
      counter={counter}
      onDone={onDone}
      toDecide={story.criteria.flatMap((c) =>
        c.takeoverState === "pending"
          ? [{ id: c.id, summary: c.summary ?? "" }]
          : [],
      )}
    >
      <p ref={statusRef} tabIndex={-1} className="text-[12.5px]">
        US {story.id} ·{" "}
        <Link to={`/us/${story.id}`} className={`underline ${focusRing}`}>
          Ouvrir l'US
        </Link>
        {" · "}
        <Link
          to={`/tickets/${found.ticket.id}`}
          className={`underline ${focusRing}`}
        >
          {found.ticket.title}
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
      {story.issue?.diverged && (
        <p className="text-muted-foreground">
          Issue modifiée sur GitHub :{" "}
          <Link to={`/us/${story.id}`} className={`underline ${focusRing}`}>
            Choisir la version
          </Link>
        </p>
      )}
      {["to_validate", "to_rewrite", "ready"].includes(story.status) && (
        <StoryBody found={found} />
      )}
      {story.status === "in_review" && (
        <>
          {pr && <StoryGitHub story={pr} fullName={project.fullName} />}
          {latestRun && <StoryVerdict runId={latestRun.id} />}
        </>
      )}
      {running && <CardQuestion runId={running.id} />}
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
  const queryClient = useQueryClient();
  // An id that is not a card of the board opens nothing.
  const openStory = board?.find(
    (s) => s.status !== "abandoned" && String(s.id) === params.get("us"),
  );
  const openIdea = ideas.find((t) => String(t.id) === params.get("ticket"));
  const cardId = openStory ? `us-${openStory.id}` : `ticket-${openIdea?.id}`;
  // The focus goes back once the board has re-rendered: the card may have changed column, or be gone.
  const [restore, setRestore] = useState<string | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const close = () => {
    navigate({ search: "" });
    setRestore(cardId);
  };
  useEffect(() => {
    if (restore === null || openStory || openIdea) return;
    (document.getElementById(restore) ?? region.current)?.focus();
    setRestore(null);
  }, [restore, openStory, openIdea]);
  // The column of the open story is the queue of decision 084 B: Valider, Renvoyer and Abandonner open the next one.
  const openColumn =
    openStory && openStory.status !== "abandoned"
      ? COLUMN_OF[openStory.status]
      : null;
  const column = (board ?? []).filter(
    (s) => s.status !== "abandoned" && COLUMN_OF[s.status] === openColumn,
  );
  const position = column.findIndex((s) => s.id === openStory?.id);
  // The story is read before the address changes: the panel never blinks empty between two stories.
  const openAt = async (index: number) => {
    const next = String(column[index]?.id);
    await queryClient.prefetchQuery({
      queryKey: ["story", next],
      queryFn: () => fetchStory(next),
    });
    navigate({ search: `?us=${next}` });
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
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Pas de glisser-déposer : un clic ouvre la carte à droite.
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: a <section> with this role is flagged as redundant, and the role is wanted explicit */}
            <div
              ref={region}
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
                            story.status === "ready" && story.blockedBy
                              ? `dépend de l'US ${story.blockedBy}`
                              : null,
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
      {openStory && (
        <StoryCardPanel
          id={String(openStory.id)}
          counter={{
            index: position,
            total: column.length,
            onPrevious: () => openAt(position - 1),
            onNext: () => openAt(position + 1),
          }}
          onDone={(decidedId) => {
            // Moved on to another story meanwhile: that one is not skipped.
            if (decidedId !== openStory.id) return;
            if (column[position + 1]) openAt(position + 1);
            else close();
          }}
        />
      )}
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
