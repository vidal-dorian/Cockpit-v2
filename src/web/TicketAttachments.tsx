import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  fetchAttachments,
  formatSize,
  iconOf,
  nextKey,
  uploadAttachment,
} from "./attachments.ts";
import {
  alertBox,
  button,
  card,
  dangerButton,
  focusRing,
  ghostButton,
  sectionLabel,
} from "./ui.ts";

/** The card « Pièces jointes » of the ticket page (decision 058 E): the files as download links, removing with a confirmation on the spot, adding one or several. `readOnly` for an archived project. */
export function TicketAttachments({
  ticketId,
  projectId,
  readOnly,
}: {
  ticketId: number;
  projectId: number;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ["attachments", String(ticketId)];
  const files = useQuery({
    queryKey: key,
    queryFn: () => fetchAttachments(ticketId),
  });
  const input = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<number>();
  const [refused, setRefused] = useState<
    { key: number; name: string; message: string }[]
  >([]);
  const [sending, setSending] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({
        queryKey: ["tickets", String(projectId)],
      }),
    ]);
  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Le retrait a échoué, réessaie.");
    },
    onSuccess: () => {
      setConfirming(undefined);
      return refresh();
    },
  });
  const send = async (chosen: File[]) => {
    setRefused([]);
    setSending(true);
    const failed: typeof refused = [];
    for (const file of chosen) {
      const message = await uploadAttachment(ticketId, file);
      if (message) failed.push({ key: nextKey(), name: file.name, message });
    }
    setRefused(failed);
    await refresh();
    setSending(false);
  };

  return (
    <section aria-labelledby="attachments-title" className={`${card} p-5`}>
      <h2 id="attachments-title" className={sectionLabel}>
        Pièces jointes
      </h2>
      {files.isError && (
        <p role="alert" className="mt-2 text-destructive">
          Impossible de lire les pièces jointes.
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2 text-[13.5px]">
        {(files.data ?? []).map((file) => (
          <li key={file.id} className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true">{iconOf(file.mediaType)}</span>
            <a
              href={`/api/attachments/${file.id}`}
              className={`min-w-0 break-all underline ${focusRing}`}
            >
              {file.name}
            </a>
            <span className="text-muted-foreground">
              {formatSize(file.size)}
            </span>
            {!readOnly &&
              (confirming === file.id ? (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(file.id)}
                    className={dangerButton}
                  >
                    Confirmer le retrait
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(undefined)}
                    className={button}
                  >
                    Annuler
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Retirer ${file.name}`}
                  onClick={() => {
                    remove.reset();
                    setConfirming(file.id);
                  }}
                  className={`ml-auto ${ghostButton}`}
                >
                  Retirer
                </button>
              ))}
          </li>
        ))}
      </ul>
      {remove.error && (
        <p role="alert" className={`mt-2 ${alertBox}`}>
          {remove.error.message}
        </p>
      )}
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Claude les lit quand il écrit les US.
      </p>
      {refused.length > 0 && (
        <div role="alert" className={`mt-2 ${alertBox}`}>
          {refused.map((r) => (
            <p key={r.key}>
              {r.name} : {r.message}
            </p>
          ))}
        </div>
      )}
      {!readOnly && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              event.target.value = "";
              send(chosen);
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={sending}
              onClick={() => input.current?.click()}
              className={button}
            >
              + Ajouter
            </button>
            {sending && <span className="text-muted-foreground">Envoi…</span>}
          </div>
        </>
      )}
    </section>
  );
}
