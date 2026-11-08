import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { Panel } from "./Shell.tsx";
import { STORY_STATUSES, ticketError } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  dangerButton,
  focusRing,
  ghostButton,
  panelPrimaryButton,
  sectionLabel,
} from "./ui.ts";

type Ticket = {
  id: number;
  projectId: number;
  title: string;
  descriptionMd: string;
};
type Story = { id: number; iWant: string; status: string };

/** The right panel of a ticket of the Tickets tab (decision 054 G): its description and stories, the way to its page, and the deletion with its confirmation on the spot. */
export function TicketPanel({
  ticket,
  stories,
  counter,
  onClose,
}: {
  ticket: Ticket;
  stories: Story[];
  counter: {
    index: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
  };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: async () => {
      const res = await client.api.tickets[":id"].$delete({
        param: { id: String(ticket.id) },
      });
      if (!res.ok) throw await ticketError(res);
    },
    onSuccess: async () => {
      onClose();
      await Promise.all(
        [
          ["tickets", String(ticket.projectId)],
          ["ticket", String(ticket.id)],
          ["home"],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
    // Refused because Claude wrote stories meanwhile: read them, which hides « Supprimer ».
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: ["stories", String(ticket.projectId)],
      }),
  });

  return (
    <Panel
      label="Ticket"
      badge={<span className={badge}>Ticket</span>}
      counter={counter}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
      footer={
        <>
          <Link to={`/tickets/${ticket.id}`} className={panelPrimaryButton}>
            Ouvrir le ticket
          </Link>
          <div className="flex gap-2">
            <Link
              to={`/tickets/${ticket.id}?modifier=1`}
              className={ghostButton}
            >
              Modifier
            </Link>
            {/* A ticket with stories is never deleted (decision 017 J). */}
            {stories.length === 0 &&
              (confirming ? (
                <>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                    className={dangerButton}
                  >
                    Confirmer la suppression
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className={button}
                  >
                    Annuler
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    remove.reset();
                    setConfirming(true);
                  }}
                  className={ghostButton}
                >
                  Supprimer
                </button>
              ))}
          </div>
          {remove.error && (
            <p role="alert" className={alertBox}>
              {remove.error.message}
            </p>
          )}
        </>
      }
    >
      <h2 className="text-lg font-semibold">{ticket.title}</h2>
      <SafeMarkdown>{ticket.descriptionMd}</SafeMarkdown>
      {stories.length > 0 && (
        <>
          <h3 className={sectionLabel}>Les user stories de ce ticket</h3>
          <ul className="flex flex-col gap-2">
            {stories.map((story) => (
              <li
                key={story.id}
                className="flex items-baseline justify-between gap-2"
              >
                <Link
                  to={`/us/${story.id}`}
                  className={`font-semibold ${focusRing}`}
                >
                  US {story.id} · {story.iWant}
                </Link>
                <span className="text-[12.5px] text-muted-foreground">
                  {STORY_STATUSES[story.status] ?? story.status}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
