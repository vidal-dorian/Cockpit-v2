import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { STEPS, ticketError } from "./tickets.ts";
import {
  alertBox,
  button,
  card,
  field,
  focusRing,
  primaryButton,
} from "./ui.ts";

/** The tickets of a project, newest first, or null when the server answers 401. */
async function fetchTickets(id: string) {
  const res = await client.api.projects[":id"].tickets.$get({ param: { id } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).tickets;
}

/** The « Tickets » section of the project page: the list and the form to create one. */
export function ProjectTickets({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const tickets = useQuery({
    queryKey: ["tickets", projectId],
    queryFn: () => fetchTickets(projectId),
  });
  const [title, setTitle] = useState("");
  const [descriptionMd, setDescriptionMd] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const res = await client.api.projects[":id"].tickets.$post({
        param: { id: projectId },
        json: descriptionMd ? { title, descriptionMd } : { title },
      });
      if (!res.ok) throw await ticketError(res);
    },
    onSuccess: () => {
      setTitle("");
      setDescriptionMd("");
      return queryClient.invalidateQueries({
        queryKey: ["tickets", projectId],
      });
    },
  });

  return (
    <section className="mt-10" aria-labelledby="tickets">
      <h2 id="tickets" className="font-heading text-xl font-bold">
        Tickets
      </h2>
      <div className="mt-3" aria-live="polite">
        {tickets.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {tickets.isError && (
          <div role="alert" className={alertBox}>
            <p>Impossible de lire les tickets.</p>
            <button
              type="button"
              onClick={() => tickets.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {tickets.isSuccess && tickets.data === null && (
          <a href="/api/auth/login" className={primaryButton}>
            Se connecter avec GitHub
          </a>
        )}
        {tickets.data?.length === 0 && (
          <p className="text-muted-foreground">Aucun ticket pour l'instant.</p>
        )}
        {tickets.data && tickets.data.length > 0 && (
          <ul className="grid gap-2">
            {tickets.data.map((ticket) => (
              <li
                key={ticket.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${card} p-4`}
              >
                <Link
                  to={`/tickets/${ticket.id}`}
                  className={`font-semibold underline ${focusRing}`}
                >
                  {ticket.title}
                </Link>
                <span className="rounded-full bg-claude-soft px-3 py-1 font-semibold text-claude-text sm:ml-auto">
                  {STEPS[ticket.step] ?? ticket.step}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h3 className="font-heading text-lg font-bold">Nouveau ticket</h3>
        <label className="mt-2 block font-semibold">
          Titre
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={field}
          />
        </label>
        <label className="mt-3 block font-semibold">
          Description (markdown)
          <textarea
            value={descriptionMd}
            onChange={(event) => setDescriptionMd(event.target.value)}
            rows={10}
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className={`mt-3 ${primaryButton}`}
        >
          Créer
        </button>
        {create.error && (
          <p role="alert" className={`mt-3 ${alertBox}`}>
            {create.error.message}
          </p>
        )}
      </form>
    </section>
  );
}
