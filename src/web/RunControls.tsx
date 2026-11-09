import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { alertBox, button, primaryButton } from "./ui.ts";

/** The confirmation of « Fermer le run », a native modal: Escape closes it (that is « Annuler »), the page behind is inert. */
function CloseDialog({
  archived,
  pending,
  onConfirm,
  onCancel,
}: {
  archived: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // Unmounting an open modal skips the native close steps: give the focus back by hand.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => opener?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="close-run-title"
      onClose={onCancel}
      className="m-auto open:flex w-[min(460px,calc(100%-2rem))] flex-col gap-3 rounded-[14px] border border-border-strong bg-card p-[22px] text-left text-foreground backdrop:bg-background/70"
    >
      <h2 id="close-run-title" className="text-lg font-semibold">
        Fermer le run ?
      </h2>
      <p id="close-run-warning" className="text-muted-foreground">
        Claude ne pourra plus rien signaler sur ce run : l'US sera relançable.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          aria-describedby="close-run-warning"
          // Keep the keyboard focus on the safe choice.
          // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
          autoFocus
          onClick={onCancel}
          className={button}
        >
          Annuler
        </button>
        <button
          type="button"
          aria-describedby="close-run-warning"
          disabled={archived || pending}
          onClick={onConfirm}
          className={primaryButton}
        >
          Confirmer la fermeture
        </button>
      </div>
    </dialog>
  );
}

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
    <div className="flex max-w-full shrink-0 md:max-w-[320px] flex-col items-end gap-2 text-right text-[13px]">
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
        <button
          type="button"
          disabled={archived || send.isPending}
          onClick={() => setConfirming(true)}
          className={button}
        >
          Fermer le run
        </button>
      </div>
      {stopRequested && (
        <p className="text-muted-foreground">
          Arrêt demandé : Claude s'arrêtera à la prochaine étape.
        </p>
      )}
      {confirming && (
        <CloseDialog
          archived={archived}
          pending={send.isPending}
          onConfirm={() => send.mutate("close")}
          onCancel={() => setConfirming(false)}
        />
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
