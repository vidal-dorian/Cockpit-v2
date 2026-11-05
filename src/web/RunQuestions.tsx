import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { alertBox, button, card, field, primaryButton } from "./ui.ts";

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
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const send = useMutation({
    mutationFn: async ({ id, answer }: { id: number; answer: string }) => {
      const res = await client.api.questions[":id"].answer.$post({
        param: { id: String(id) },
        json: { answer },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => setTyped(""),
    // Answered meanwhile or run finished: the page shows the real state.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["run", runId] }),
  });
  const pending = questions.filter((q) => q.answer === null);
  const ordered = [...pending, ...questions.filter((q) => q.answer !== null)];
  return (
    <section className="mt-6">
      <h2 className="font-heading text-xl font-bold">Questions</h2>
      <ul className="mt-2 grid gap-2">
        {ordered.map((q) => (
          <li key={q.id} className={`${card} p-3`}>
            <p className="whitespace-pre-wrap font-semibold">{q.question}</p>
            {q.answer !== null ? (
              <p className="mt-1 whitespace-pre-wrap">{q.answer}</p>
            ) : !running ? (
              <p className="mt-1 text-muted-foreground">Sans réponse</p>
            ) : (
              <form
                className="mt-2 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (typed.trim() !== "")
                    send.mutate({ id: q.id, answer: typed });
                }}
              >
                {q.suggestedAnswers && (
                  <div className="flex flex-wrap gap-2">
                    {q.suggestedAnswers.map((answer) => (
                      <button
                        key={answer}
                        type="button"
                        disabled={send.isPending}
                        onClick={() => send.mutate({ id: q.id, answer })}
                        className={button}
                      >
                        {answer}
                      </button>
                    ))}
                  </div>
                )}
                <label>
                  Ta réponse
                  <textarea
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    maxLength={10_000}
                    className={field}
                  />
                </label>
                <button
                  type="submit"
                  disabled={send.isPending || typed.trim() === ""}
                  className={`${primaryButton} justify-self-start`}
                >
                  Répondre
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {send.isError && (
        <p role="alert" className={`mt-2 ${alertBox}`}>
          La réponse n'a pas été enregistrée.
        </p>
      )}
    </section>
  );
}
