import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { FixLink } from "./ProjectPrepare.tsx";
import { ROLE_REFUSAL, roleRefusal } from "./roles.ts";
import { useShortcut } from "./Shortcuts.tsx";
import { alertBox, field, focusRing, kbd, panelPrimaryButton } from "./ui.ts";

// Why the story of a paused run could not be relaunched after its answer was saved (decision 044 E).
const RELAUNCH_REFUSALS: Record<string, string> = {
  launcher_not_connected: "le lanceur n'est pas connecté",
  launcher_needs_reconnect: "le lanceur est à reconnecter",
  project_not_in_launcher: "le projet n'est plus coché dans le lanceur",
  monthly_budget_reached: "le plafond du mois est atteint",
  fire_failed: "le lancement a échoué",
};

/** The answer block of a pending question (decision 036 G): suggested answers, a free text, then `queryKey` is read again. */
export function AnswerForm({
  id,
  suggestedAnswers,
  queryKey,
  onSent,
  label = "Répondre",
}: {
  id: number;
  suggestedAnswers: string[] | null;
  queryKey: string[];
  onSent?: () => void;
  /** The text of the white button. */
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const send = useMutation<void, Error & { saved?: string }, string>({
    mutationFn: async (answer: string) => {
      const res = await client.api.questions[":id"].answer.$post({
        param: { id: String(id) },
        json: { answer },
      });
      if (!res.ok) {
        const failure = (await res.json().catch(() => null)) as {
          error?: string;
          answerSaved?: boolean;
        } | null;
        throw Object.assign(
          new Error(
            roleRefusal(res.status, failure?.error) ?? `HTTP ${res.status}`,
          ),
          {
            saved: failure?.answerSaved ? failure.error : undefined,
          },
        );
      }
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
  // Keys 1 and 2 answer the suggested answers (decision 084 D); useShortcut keeps quiet in a field.
  const press = (n: number) => {
    const answer = busy ? undefined : suggestedAnswers?.[n - 1];
    return answer === undefined ? undefined : () => send.mutate(answer);
  };
  useShortcut("1", press(1));
  useShortcut("2", press(2));
  return (
    <>
      <form
        className="flex flex-1 flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim() !== "") send.mutate(typed);
        }}
      >
        {suggestedAnswers?.map((answer, i) => (
          <button
            key={answer}
            type="button"
            disabled={busy}
            aria-busy={send.isPending}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => send.mutate(answer)}
            className={`flex items-center gap-[9px] rounded-[14px] border px-3.5 py-[11px] text-left text-[13.5px] font-semibold disabled:opacity-50 ${focusRing} ${send.variables === answer && busy ? "border-foreground bg-raised" : "border-border-strong bg-card hover:bg-raised-hover"}`}
          >
            <span aria-hidden="true" className={kbd}>
              {i + 1}
            </span>
            {answer}
          </button>
        ))}
        <label className="grid text-[13px] font-semibold">
          <span className="sr-only">Ta réponse</span>
          <textarea
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Autre réponse…"
            rows={2}
            maxLength={10_000}
            className={`${field} mt-0 border-border bg-transparent text-center font-semibold placeholder:text-muted-foreground`}
          />
        </label>
        <button
          type="submit"
          disabled={busy || typed.trim() === ""}
          aria-busy={send.isPending}
          className={`${panelPrimaryButton} mt-auto`}
        >
          {label}
          <span
            aria-hidden="true"
            className={`${kbd} border-primary-foreground/30 text-primary-foreground`}
          >
            Ctrl Entrée
          </span>
        </button>
      </form>
      {send.isError && (
        <p role="alert" className={`mt-2 ${alertBox}`}>
          {send.error.saved !== undefined
            ? `Réponse enregistrée, mais l'US n'a pas pu être relancée : ${RELAUNCH_REFUSALS[send.error.saved] ?? "relance refusée"}.`
            : send.error.message === ROLE_REFUSAL
              ? ROLE_REFUSAL
              : "La réponse n'a pas été enregistrée."}{" "}
          <FixLink code={send.error.saved} />
        </p>
      )}
    </>
  );
}
