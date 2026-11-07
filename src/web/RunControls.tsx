import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { alertBox, button, dangerButton } from "./ui.ts";

/** Ask Claude to stop, close a silent run, or relaunch a finished one (decision 037 F); sits at the top right of the run page. */
export function RunControls({
  runId,
  running,
  archived,
  stopRequested,
  relaunchStoryId,
}: {
  runId: string;
  running: boolean;
  archived: boolean;
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
    return relaunchStoryId === null || archived ? null : (
      <Link to={`/us/${relaunchStoryId}`} className={button}>
        Relancer
      </Link>
    );
  return (
    <div className="flex max-w-[320px] shrink-0 flex-col items-end gap-2 text-right text-[13px]">
      <div className="flex flex-wrap justify-end gap-2">
        {!stopRequested && (
          <button
            type="button"
            disabled={archived || send.isPending}
            onClick={() => send.mutate("stop")}
            className={button}
          >
            Demander l'arrêt
          </button>
        )}
        {!confirming && (
          <button
            type="button"
            disabled={archived || send.isPending}
            onClick={() => setConfirming(true)}
            className={button}
          >
            Fermer le run
          </button>
        )}
      </div>
      {stopRequested && (
        <p className="text-muted-foreground">
          Arrêt demandé : Claude s'arrêtera à la prochaine étape.
        </p>
      )}
      {confirming && (
        <div className="flex flex-col items-end gap-2">
          <p id="close-run-warning" className="text-muted-foreground">
            Claude ne pourra plus rien signaler sur ce run : l'US sera
            relançable.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              aria-describedby="close-run-warning"
              // The button that asked is gone: keep the keyboard focus on the safe choice.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
              autoFocus
              onClick={() => setConfirming(false)}
              className={button}
            >
              Annuler
            </button>
            <button
              type="button"
              aria-describedby="close-run-warning"
              disabled={archived || send.isPending}
              onClick={() => send.mutate("close")}
              className={dangerButton}
            >
              Confirmer la fermeture
            </button>
          </div>
        </div>
      )}
      {send.isError && (
        <p role="alert" className={`px-3 py-2 ${alertBox}`}>
          L'action n'a pas pu être faite : le run a peut-être changé
          entre-temps.
        </p>
      )}
    </div>
  );
}
