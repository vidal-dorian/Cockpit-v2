import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { STEPS, ticketError } from "./tickets.ts";
import {
  alertBox,
  button,
  field,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** The tickets of a project, newest first, or null when the server answers 401. */
export async function fetchTickets(id: string) {
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
    <section className="mx-[26px] mt-6" aria-labelledby="tickets">
      <h2 id="tickets" className={sectionLabel}>
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
          <ul className={listCard}>
            {tickets.data.map((ticket) => (
              <li
                key={ticket.id}
                className="flex min-h-[50px] items-center gap-3.5 px-4 py-2 hover:bg-raised"
              >
                <span aria-hidden="true" className="w-4 text-dim">
                  ✎
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/tickets/${ticket.id}`}
                    className={`block font-bold hover:underline ${focusRing}`}
                  >
                    {ticket.title}
                  </Link>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {STEPS[ticket.step] ?? ticket.step}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h3 className={sectionLabel}>Nouveau ticket</h3>
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
