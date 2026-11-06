import { useRef } from "react";
import { AnswerForm } from "./AnswerForm.tsx";
import { card } from "./ui.ts";

type Question = {
  id: number;
  question: string;
  suggestedAnswers: string[] | null;
  answer: string | null;
};

/** The questions Claude asked during a run: the pending one first, to answer (decision 036 G). */
export function RunQuestions({
  runId,
  running,
  questions,
}: {
  runId: string;
  running: boolean;
  questions: Question[];
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pending = questions.filter((q) => q.answer === null);
  const ordered = [...pending, ...questions.filter((q) => q.answer !== null)];
  return (
    <section className="mt-6">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-xl font-bold"
      >
        Questions
      </h2>
      <ul className="mt-2 grid gap-2">
        {ordered.map((q) => (
          <li key={q.id} className={`${card} p-3`}>
            <p className="whitespace-pre-wrap font-semibold">{q.question}</p>
            {q.answer !== null ? (
              <p className="mt-1 whitespace-pre-wrap">{q.answer}</p>
            ) : !running ? (
              <p className="mt-1 text-muted-foreground">Sans réponse</p>
            ) : (
              <AnswerForm
                id={q.id}
                suggestedAnswers={q.suggestedAnswers}
                queryKey={["run", runId]}
                onSent={() => headingRef.current?.focus()}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
