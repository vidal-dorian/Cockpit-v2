import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { alertBox, button, field, primaryButton } from "./ui.ts";

/** The answer block of a pending question (decision 036 G): suggested answers, a free text, then `queryKey` is read again. */
export function AnswerForm({
  id,
  suggestedAnswers,
  queryKey,
  onSent,
}: {
  id: number;
  suggestedAnswers: string[] | null;
  queryKey: string[];
  onSent?: () => void;
}) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const send = useMutation({
    mutationFn: async (answer: string) => {
      const res = await client.api.questions[":id"].answer.$post({
        param: { id: String(id) },
        json: { answer },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      setTyped("");
      onSent?.();
    },
    // Answered meanwhile or run finished: the page shows the real state.
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  // Also after a success, until the refetch shows the answer: a second click would only get a 409.
  const busy = send.isPending || send.isSuccess;
  return (
    <>
      <form
        className="mt-2 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim() !== "") send.mutate(typed);
        }}
      >
        {suggestedAnswers && (
          <div className="flex flex-wrap gap-2">
            {suggestedAnswers.map((answer) => (
              <button
                key={answer}
                type="button"
                disabled={busy}
                onClick={() => send.mutate(answer)}
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
          disabled={busy || typed.trim() === ""}
          className={`${primaryButton} justify-self-start`}
        >
          Répondre
        </button>
      </form>
      {send.isError && (
        <p role="alert" className={`mt-2 ${alertBox}`}>
          La réponse n'a pas été enregistrée.
        </p>
      )}
    </>
  );
}
