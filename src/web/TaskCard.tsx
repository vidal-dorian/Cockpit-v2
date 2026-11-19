import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  alertBox,
  badge,
  button,
  dangerButton,
  field,
  primaryButton,
} from "./ui.ts";

/** A French sentence for a failed answer; the codes of the server are not meant to be read. */
export const failure = (res: { status: number }) =>
  new Error(
    res.status === 400
      ? "L'adresse de lancement ou le jeton n'est pas valide : colle-les tels que claude.ai les affiche."
      : "L'opération a échoué, réessaie.",
  );

type Answer = { ok: boolean; status: number };

/** Save and remove of a task of claude.ai (decisions 022 A and 054 A): the focus goes back to the heading, which the page keeps when the fields or buttons are replaced. */
export function useTask(
  queryKey: string,
  put: (json: { fireUrl: string; token: string }) => Promise<Answer>,
  del: () => Promise<Answer>,
) {
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const settled = {
    onSuccess: () => heading.current?.focus(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [queryKey] }),
  };
  const save = useMutation({
    meta: { done: "Tâche enregistrée." },
    mutationFn: async (json: { fireUrl: string; token: string }) => {
      const res = await put(json);
      if (!res.ok) throw failure(res);
    },
    ...settled,
  });
  const remove = useMutation({
    meta: { done: "Tâche retirée." },
    mutationFn: async () => {
      const res = await del();
      if (!res.ok) throw failure(res);
    },
    ...settled,
  });
  return { heading, save, remove, error: save.error ?? remove.error };
}
export type Task = ReturnType<typeof useTask>;

const step = "px-[18px] py-3.5";

/** The step that copies the prompt of the task: a read-only field to select by hand when the clipboard refuses. */
export function PromptStep({ n, prompt }: { n: number; prompt: string }) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  return (
    <li className={step}>
      <p className="font-semibold">{n}. Copier la consigne</p>
      <p className="mt-1">Colle-la comme consigne de la tâche.</p>
      <textarea
        readOnly
        aria-label="Consigne"
        rows={6}
        value={prompt}
        onFocus={(e) => e.currentTarget.select()}
        className={`${field} font-mono`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            navigator.clipboard.writeText(prompt).then(
              () => setCopy("done"),
              () => setCopy("failed"),
            )
          }
          className={button}
        >
          Copier la consigne
        </button>
        <span className={copy === "failed" ? "text-destructive" : undefined}>
          {copy === "done" && "Copiée."}
          {copy === "failed" &&
            "Copie impossible : sélectionne la consigne à la main."}
        </span>
      </div>
    </li>
  );
}

/** The step that pastes the address and the token of the task, or shows it connected. */
export function ConnectStep({
  n,
  task,
  connected,
  needsReconnect,
}: {
  n: number;
  task: Task;
  connected: boolean;
  needsReconnect: boolean;
}) {
  const [fireUrl, setFireUrl] = useState("");
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);
  // The token is shown once by claude.ai and erased here: the removal is confirmed in place (decision 003, rule 4).
  const retire = confirming ? (
    <>
      <span>
        Retirer la tâche ? Il faudra régénérer son jeton sur claude.ai.
      </span>
      <button
        type="button"
        onClick={() =>
          task.remove.mutate(undefined, {
            onSettled: () => setConfirming(false),
          })
        }
        disabled={task.remove.isPending}
        aria-busy={task.remove.isPending}
        className={dangerButton}
      >
        Confirmer le retrait
      </button>
      <button
        type="button"
        // The Retirer button is gone: keep the keyboard focus on the safe choice.
        // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
        autoFocus
        onClick={() => setConfirming(false)}
        className={button}
      >
        Annuler
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={button}
    >
      Retirer
    </button>
  );
  return (
    <li className={step}>
      <p className="font-semibold">{n}. Coller l'adresse et le jeton</p>
      {connected && !needsReconnect ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className={badge}>Connectée</span>
          {retire}
        </div>
      ) : (
        <>
          {needsReconnect && (
            <p className={`mt-2 ${alertBox}`}>
              La tâche est à reconnecter : claude.ai a refusé le jeton. Clique «
              Régénérer » sur la tâche, puis colle le nouveau jeton ici.{" "}
              {retire}
            </p>
          )}
          <p className="mt-1">
            Dans la tâche, ajoute le déclencheur API : claude.ai affiche
            l'adresse de lancement et le jeton une seule fois.
          </p>
          <form
            className="mt-2 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              // The token only lives in the field, and not any longer than the save.
              task.save.mutate(
                { fireUrl, token },
                {
                  onSuccess: () => {
                    setToken("");
                    setFireUrl("");
                  },
                },
              );
            }}
          >
            <label>
              Adresse de lancement
              <input
                value={fireUrl}
                onChange={(e) => setFireUrl(e.target.value)}
                autoComplete="off"
                className={`${field} font-mono`}
              />
            </label>
            <label>
              Jeton
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                className={`${field} font-mono`}
              />
            </label>
            <button
              type="submit"
              disabled={task.save.isPending}
              aria-busy={task.save.isPending}
              className={`justify-self-start ${primaryButton}`}
            >
              Enregistrer
            </button>
          </form>
        </>
      )}
    </li>
  );
}
