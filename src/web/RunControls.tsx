import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { alertBox, button, focusRing } from "./ui.ts";

/** Ask Claude to stop, close a silent run, or relaunch a finished one (decision 037 F). */
export function RunControls({
  runId,
  running,
  stopRequested,
  relaunchStoryId,
}: {
  runId: string;
  running: boolean;
  stopRequested: boolean;
  /** The story of a finished run that can be launched again, or null. */
  relaunchStoryId: number | null;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const send = useMutation({
    mutationFn: async (action: "stop" | "close") => {
      const param = { id: runId };
      const res =
        action === "stop"
          ? await client.api.runs[":id"].stop.$post({ param })
          : await client.api.runs[":id"].close.$post({ param });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    // Refused because the run changed meanwhile: the page shows the real state.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["run", runId] }),
  });
  if (!running)
    return relaunchStoryId === null ? null : (
      <Link
        to={`/us/${relaunchStoryId}`}
        className={`mt-4 inline-block underline ${focusRing}`}
      >
        Relancer
      </Link>
    );
  return (
    <div className="mt-4 grid gap-2">
      <div className="flex flex-wrap gap-2">
        {!stopRequested && (
          <button
            type="button"
            disabled={send.isPending}
            onClick={() => send.mutate("stop")}
            className={button}
          >
            Demander l'arrêt
          </button>
        )}
        {!confirming && (
          <button
            type="button"
            disabled={send.isPending}
            onClick={() => setConfirming(true)}
            className={button}
          >
            Fermer le run
          </button>
        )}
      </div>
      {stopRequested && (
        <p>Arrêt demandé : Claude s'arrêtera à la prochaine étape.</p>
      )}
      {confirming && (
        <div>
          <p id="close-run-warning">
            Claude ne pourra plus rien signaler sur ce run : l'US sera
            relançable.
          </p>
          <button
            type="button"
            aria-describedby="close-run-warning"
            disabled={send.isPending}
            onClick={() => send.mutate("close")}
            className={`mt-2 min-h-10 rounded-xl bg-destructive px-4 font-semibold text-card disabled:opacity-50 ${focusRing}`}
          >
            Confirmer la fermeture
          </button>
          <button
            type="button"
            aria-describedby="close-run-warning"
            // The button that asked is gone: keep the keyboard focus on the safe choice.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
            autoFocus
            onClick={() => setConfirming(false)}
            className={`mt-2 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
      {send.isError && (
        <p role="alert" className={alertBox}>
          L'action n'a pas pu être faite : le run a peut-être changé
          entre-temps.
        </p>
      )}
    </div>
  );
}
