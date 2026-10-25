import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router";
import { client } from "./api.ts";
import { STEPS, ticketError } from "./tickets.ts";
import { focusRing } from "./ui.ts";

/** The ticket, "not_found" when the user cannot reach it, or null when the server answers 401. */
async function fetchTicket(id: string) {
  const res = await client.api.tickets[":id"].$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).ticket;
}

const field = `mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2 ${focusRing}`;
const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`;
const alertBox = "rounded-xl bg-destructive-soft p-4 text-destructive";
// The page has no typography plugin: the few elements a description uses are styled here, with tokens.
const markdownStyle =
  "break-words [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-card [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6";

type Ticket = Exclude<
  Awaited<ReturnType<typeof fetchTicket>>,
  null | "not_found"
>;

function TicketView({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // One thing at a time: reading, editing or confirming the deletion (decision 003, rule 4).
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [title, setTitle] = useState(ticket.title);
  const [descriptionMd, setDescriptionMd] = useState(ticket.descriptionMd);
  const id = String(ticket.id);
  // The form or the confirmation is gone and so is the button that opened it: the focus goes back to a new one, not to <body>.
  const modifier = useRef<HTMLButtonElement>(null);
  const supprimer = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"edit" | "delete" | null>(null);
  useEffect(() => {
    if (mode !== "view" || !focusAfter.current) return;
    (focusAfter.current === "edit" ? modifier : supprimer).current?.focus();
    focusAfter.current = null;
  }, [mode]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await client.api.tickets[":id"].$patch({
        param: { id },
        json: { title, descriptionMd },
      });
      if (!res.ok) throw await ticketError(res);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", String(ticket.projectId)],
        }),
      ]);
      focusAfter.current = "edit";
      setMode("view");
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const res = await client.api.tickets[":id"].$delete({ param: { id } });
      if (!res.ok) throw await ticketError(res);
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["ticket", id] });
      await queryClient.invalidateQueries({
        queryKey: ["tickets", String(ticket.projectId)],
      });
      navigate(`/projets/${ticket.projectId}`);
    },
  });
  const cancel = () => {
    focusAfter.current = mode === "edit" ? "edit" : "delete";
    setMode("view");
    save.reset();
    remove.reset();
  };

  return (
    <>
      <Link
        to={`/projets/${ticket.projectId}`}
        className={`underline ${focusRing}`}
      >
        ← Projet
      </Link>
      {mode === "edit" ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="block font-semibold">
            Titre
            <input
              // The Modifier button is gone: keep the keyboard focus in the form.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the form the user just asked for
              autoFocus
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
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className={`min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={save.isPending}
              className={button}
            >
              Annuler
            </button>
          </div>
          {save.error && (
            <p role="alert" className={`mt-3 ${alertBox}`}>
              {save.error.message}
            </p>
          )}
        </form>
      ) : (
        <>
          <h1 className="mt-4 font-heading text-3xl font-extrabold">
            {ticket.title}
          </h1>
          <p className="mt-2">
            <span className="rounded-full bg-claude-soft px-3 py-1 font-semibold text-claude-text">
              {STEPS[ticket.step] ?? ticket.step}
            </span>
          </p>
          {/* No raw HTML, no remote image (it would be a tracking pixel): react-markdown ignores the HTML and drops unsafe link addresses (decision 014). */}
          <div className={`mt-4 ${markdownStyle}`}>
            <Markdown disallowedElements={["img"]}>
              {ticket.descriptionMd}
            </Markdown>
          </div>
          <div className="mt-6 flex gap-2">
            {mode === "view" ? (
              <>
                <button
                  ref={modifier}
                  type="button"
                  onClick={() => {
                    setTitle(ticket.title);
                    setDescriptionMd(ticket.descriptionMd);
                    setMode("edit");
                  }}
                  className={button}
                >
                  Modifier
                </button>
                <button
                  ref={supprimer}
                  type="button"
                  onClick={() => setMode("delete")}
                  className={button}
                >
                  Supprimer
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className={`min-h-10 rounded-lg bg-destructive px-4 font-semibold text-card ${focusRing}`}
                >
                  Confirmer la suppression
                </button>
                <button
                  // A key of its own: without it React would reuse the Supprimer button and never mount this one, so autoFocus would not run.
                  key="cancel-delete"
                  type="button"
                  // The Supprimer button is gone: keep the keyboard focus on the safe choice.
                  // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                  autoFocus
                  onClick={cancel}
                  className={button}
                >
                  Annuler
                </button>
              </>
            )}
          </div>
          {remove.error && (
            <p role="alert" className={`mt-3 ${alertBox}`}>
              {remove.error.message}
            </p>
          )}
        </>
      )}
    </>
  );
}

export function TicketPage() {
  const { id = "" } = useParams();
  const ticket = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => fetchTicket(id),
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div aria-live="polite">
        {ticket.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {ticket.isError && (
          <div role="alert" className={alertBox}>
            <p>Impossible de lire le ticket.</p>
            <button
              type="button"
              onClick={() => ticket.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {ticket.data === null && (
          <a
            href="/api/auth/login"
            className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
          >
            Se connecter avec GitHub
          </a>
        )}
        {ticket.data === "not_found" && (
          <>
            <Link to="/projets" className={`underline ${focusRing}`}>
              ← Projets
            </Link>
            <h1 className="mt-4 font-heading text-3xl font-extrabold">
              Ticket introuvable
            </h1>
          </>
        )}
        {/* Keyed by id: another ticket starts from a clean state, a save keeps the node (and the focus). */}
        {ticket.data && ticket.data !== "not_found" && (
          <TicketView key={ticket.data.id} ticket={ticket.data} />
        )}
      </div>
    </main>
  );
}
