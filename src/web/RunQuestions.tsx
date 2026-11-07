import { useState } from "react";
import { AnswerForm } from "./AnswerForm.tsx";
import { Panel } from "./Shell.tsx";
import { badge, listCard, sectionLabel, urgentBadge } from "./ui.ts";

type Question = {
  id: number;
  question: string;
  suggestedAnswers: string[] | null;
  answer: string | null;
};

/**
 * The questions Claude asked during a run (decision 036 G): the pending ones, while the run goes on, in the right panel to answer
 * (S29); the answered ones, and those a finished run never got an answer to, in a list.
 */
export function RunQuestions({
  runId,
  running,
  questions,
  onAnswered,
}: {
  runId: string;
  running: boolean;
  questions: Question[];
  /** Called once an answer is sent: the panel goes away with the last question, so the page moves the focus. */
  onAnswered: () => void;
}) {
  const [index, setIndex] = useState(0);
  const pending = running ? questions.filter((q) => q.answer === null) : [];
  const at = Math.min(index, pending.length - 1);
  const current = pending[at];
  const others = questions.filter((q) => !pending.includes(q));
  return (
    <>
      {others.length > 0 && (
        <section>
          <h2 className={sectionLabel}>Questions</h2>
          <ul className={`${listCard} mt-2`}>
            {others.map((q) => (
              <li key={q.id} className="min-h-[50px] px-4 py-2.5">
                <p className="whitespace-pre-wrap font-semibold">
                  {q.question}
                </p>
                {q.answer !== null ? (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {q.answer}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Sans réponse</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {current && (
        <Panel
          label="Question de Claude"
          badge={
            <span className={at === 0 ? urgentBadge : badge}>
              ✦ Question de Claude
            </span>
          }
          counter={
            pending.length > 1
              ? {
                  index: at,
                  total: pending.length,
                  onPrevious: () => setIndex(at - 1),
                  onNext: () => setIndex(at + 1),
                }
              : undefined
          }
          footer={
            <p className="text-center text-[13px] text-muted-foreground">
              Plus tard · Claude reste en pause
            </p>
          }
        >
          <h2 className="whitespace-pre-wrap text-xl font-semibold">
            {current.question}
          </h2>
          {current.suggestedAnswers && (
            <p className={sectionLabel}>Choisis une réponse</p>
          )}
          <AnswerForm
            key={current.id}
            id={current.id}
            suggestedAnswers={current.suggestedAnswers}
            queryKey={["run", runId]}
            onSent={onAnswered}
          />
        </Panel>
      )}
    </>
  );
}
