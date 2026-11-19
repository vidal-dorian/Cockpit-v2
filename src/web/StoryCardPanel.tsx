import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useEffect, useRef } from "react";
import { Link } from "react-router";
import { AnswerForm } from "./AnswerForm.tsx";
import { fetchRun } from "./RunPage.tsx";
import { WhyAsked } from "./RunQuestions.tsx";
import type { Panel } from "./Shell.tsx";
import { StoryBody } from "./StoryBody.tsx";
import { fetchStory, StoryDecisions } from "./StoryDecisions.tsx";
import { StoryGitHub } from "./StoryGitHub.tsx";
import { StoryVerdict } from "./StoryPage.tsx";
import { button, focusRing } from "./ui.ts";

/** The pending question of the story's running run (decision 085 G), answered where the card is opened. */
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

/** The panel of an open US card (decisions 069 H and 085 G): the decisions of its page, with what is needed to take them (the story, the pull request, the question). */
export function StoryCardPanel({
  id,
  counter,
  onDone,
  back,
}: {
  id: string;
  counter?: ComponentProps<typeof Panel>["counter"];
  onDone: (decidedId: number) => void;
  /** Where the panel was opened from (« ← Ticket »): a way back to it. */
  back?: { label: string; onClick: () => void };
}) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const found = useQuery({
    queryKey: ["story", id],
    queryFn: () => fetchStory(id),
  }).data;
  const loaded = found && found !== "not_found" ? found.story.id : null;
  // Under lg the panel follows the board: opening a card brings the focus and the view to it (decision 085 H).
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
      {back && (
        <button type="button" onClick={back.onClick} className={button}>
          {back.label}
        </button>
      )}
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

/** The story open in the panel of a ticket, on its page or in the Tickets tab (decision 085 J, A): the queue is the stories of the ticket to validate, and the next one opens after a decision; at the end `onOpen(null)` gives the ticket back. */
export function TicketStoryPanel({
  stories,
  openId,
  onOpen,
  back,
}: {
  stories: { id: number; status: string }[];
  openId: number;
  onOpen: (id: number | null) => void;
  back: { label: string; onClick: () => void };
}) {
  const queue = stories.filter((s) => s.status === "to_validate");
  const position = queue.findIndex((s) => s.id === openId);
  return (
    <StoryCardPanel
      id={String(openId)}
      back={back}
      counter={
        position < 0
          ? undefined
          : {
              index: position,
              total: queue.length,
              onPrevious: () => onOpen(queue[position - 1]?.id ?? null),
              onNext: () => onOpen(queue[position + 1]?.id ?? null),
            }
      }
      onDone={(decidedId) => {
        // Moved on to another story meanwhile: that one is not skipped.
        if (decidedId !== openId) return;
        // The decided story may already be gone from the list: the one that took its place is the next.
        const left = queue.filter((s) => s.id !== decidedId);
        onOpen(left[Math.max(position, 0)]?.id ?? null);
      }}
    />
  );
}
