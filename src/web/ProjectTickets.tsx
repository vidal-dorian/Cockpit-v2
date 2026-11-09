import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { fetchStories } from "./ProjectKanban.tsx";
import { RunNowButton } from "./ProjectRoutine.tsx";
import { fetchProjects } from "./Projects.tsx";
import { atLeast } from "./roles.ts";
import { TicketTags } from "./TagField.tsx";
import { TicketPanel } from "./TicketPanel.tsx";
import { age, fetchTickets, STEPS, STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  button,
  chipLink,
  focusRing,
  listCard,
  primaryButton,
} from "./ui.ts";

type Ticket = NonNullable<Awaited<ReturnType<typeof fetchTickets>>>[number] & {
  attachmentsCount?: number;
};
type Stories = NonNullable<Awaited<ReturnType<typeof fetchStories>>>;

/** « 4 US · 1 à valider, 2 prêtes, 1 en cours »: the stories of a ticket by status (decision 055 F). */
function storiesDetail(stories: Stories) {
  if (stories.length === 0) return "";
  const count = (status: string) =>
    stories.filter((s) => s.status === status).length;
  const parts = [
    [count("to_validate"), "à valider", "à valider"],
    [count("ready"), "prête", "prêtes"],
    [count("in_progress"), "en cours", "en cours"],
    [count("in_review"), "en revue", "en revue"],
  ].flatMap(([n, one, many]) => (n ? [`${n} ${n === 1 ? one : many}`] : []));
  return [`${stories.length} US`, parts.join(", ")].filter(Boolean).join(" · ");
}

const isOpen = (t: Ticket) => t.step !== "done" && t.step !== "abandoned";

function TicketRow({
  ticket,
  stories,
  selected,
  onSelect,
}: {
  ticket: Ticket;
  stories: Stories;
  selected: boolean;
  onSelect: () => void;
}) {
  const detail = storiesDetail(stories);
  return (
    <li
      className={`flex min-h-[50px] items-center gap-3.5 px-4 py-2 hover:bg-raised ${selected ? "bg-raised" : ""}`}
    >
      <span
        aria-hidden="true"
        className="w-6 text-center text-[13px] font-bold text-dim"
      >
        ✎
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onSelect}
          className={`block text-left font-semibold hover:underline ${focusRing}`}
        >
          {ticket.title}
        </button>
        <span className="block text-[12.5px] text-muted-foreground">
          <span>{STEPS[ticket.step] ?? ticket.step}</span>
          {detail && (
            <>
              {" "}
              · <span>{detail}</span>
            </>
          )}
        </span>
      </div>
      <div className="flex flex-none items-center gap-2 text-[12.5px] text-muted-foreground">
        <TicketTags tags={ticket.tags} priority={ticket.priority} />
        {(ticket.attachmentsCount ?? 0) > 0 && (
          <span>📎 {ticket.attachmentsCount}</span>
        )}
        <span>{age(ticket.createdAt)}</span>
      </div>
    </li>
  );
}

/** The « Tickets » tab of the project page (decision 055 F, G; S14): chips, tag menu, search, the list and the panel of the open ticket. */
export function ProjectTickets({ projectId }: { projectId: string }) {
  const tickets = useQuery({
    queryKey: ["tickets", projectId],
    queryFn: () => fetchTickets(projectId),
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const mayWrite = atLeast(
    projects.data?.find((p) => String(p.id) === projectId)?.role,
    "can_validate",
  );
  const archived = projects.data?.find(
    (p) => String(p.id) === projectId,
  )?.archived;
  const stories = useQuery({
    queryKey: ["stories", projectId],
    queryFn: () => fetchStories(projectId),
  });
  const [view, setView] = useState<"open" | "new" | null>("open");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  // The box keeps what is typed; the request follows 300 ms after the last keystroke, trimmed.
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [selected, setSelected] = useState<number>();
  const found = useQuery({
    queryKey: ["search", projectId, q],
    queryFn: async () => {
      const res = await client.api.projects[":id"].search.$get({
        param: { id: projectId },
        query: { q },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: q !== "",
    placeholderData: keepPreviousData,
  });

  const all = tickets.data ?? [];
  const tags = [...new Set(all.flatMap((t) => t.tags ?? []))].sort();
  const searching = q !== "" && search.trim() !== "";
  // The tickets listed, in order: the results of a search, or the list under its chip and tag.
  const shown = searching
    ? (found.data?.tickets ?? []).flatMap(
        (r) => all.find((t) => t.id === r.id) ?? [],
      )
    : all.filter(
        (t) =>
          (view === "open"
            ? isOpen(t)
            : view === "new"
              ? t.step === "new"
              : true) &&
          (tag === "" || (t.tags ?? []).includes(tag)),
      );
  const index = shown.findIndex((t) => t.id === selected);
  const open = shown[index];
  const storiesOf = (id: number) =>
    (stories.data ?? []).filter((s) => s.ticketId === id);
  const toggle = (next: "open" | "new") => setView(view === next ? null : next);
  const chip = (name: "open" | "new", label: string, n: number) => (
    <button
      type="button"
      aria-pressed={view === name}
      onClick={() => toggle(name)}
      className={chipLink({ isActive: view === name })}
    >
      {label} · {n}
    </button>
  );

  return (
    <section className="mx-[26px] mt-4" aria-labelledby="tickets">
      <h2 id="tickets" className="sr-only">
        Tickets
      </h2>
      {tickets.data && !archived && mayWrite && (
        <div className="mb-3 flex justify-end">
          <Link
            to={`/projets/${projectId}/tickets/importer`}
            className={button}
          >
            Importer les issues
          </Link>
        </div>
      )}
      <div aria-live="polite">
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
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                aria-label="Chercher dans les tickets et les US"
                placeholder="🔍 Chercher dans les tickets et les US"
                value={search}
                maxLength={100}
                onChange={(event) => setSearch(event.target.value)}
                className={`h-[34px] min-w-56 flex-1 rounded-[10px] border border-border-strong bg-sunken px-3 text-[13px] ${focusRing}`}
              />
              {chip("open", "Ouverts", all.filter(isOpen).length)}
              {chip(
                "new",
                "Nouveaux",
                all.filter((t) => t.step === "new").length,
              )}
              <select
                aria-label="Étiquette"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                className={`h-7 rounded-full border border-border bg-transparent px-2 text-[12.5px] font-semibold text-muted-foreground ${focusRing}`}
              >
                <option value="">Étiquette</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="ml-auto">
                <RunNowButton projectId={projectId} onlyConnected />
              </div>
            </div>
            {searching && found.isPending && (
              <p className="text-muted-foreground">Recherche…</p>
            )}
            {searching && found.isError && (
              <p role="alert" className={alertBox}>
                La recherche a échoué, réessaie.
              </p>
            )}
            {searching &&
              found.data &&
              shown.length === 0 &&
              found.data.stories.length === 0 && (
                <p className="text-muted-foreground">Aucun résultat.</p>
              )}
            {!searching && shown.length === 0 && (
              <p className="text-muted-foreground">
                Aucun ticket ne correspond.
              </p>
            )}
            {shown.length > 0 && (
              <ul className={listCard}>
                {shown.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    stories={storiesOf(ticket.id)}
                    selected={ticket.id === open?.id}
                    onSelect={() =>
                      setSelected(
                        ticket.id === selected ? undefined : ticket.id,
                      )
                    }
                  />
                ))}
              </ul>
            )}
            {searching && found.data && found.data.stories.length > 0 && (
              <ul className={`mt-3 ${listCard}`}>
                {found.data.stories.map((story) => (
                  <li key={story.id} className="min-h-[50px] px-4 py-3">
                    <Link
                      to={`/us/${story.id}`}
                      className={`font-semibold hover:underline ${focusRing}`}
                    >
                      US {story.id} · {story.title}
                    </Link>{" "}
                    <span className="text-[12.5px] text-muted-foreground">
                      {STORY_STATUSES[story.status] ?? story.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {open && (
        <TicketPanel
          key={open.id}
          ticket={open}
          stories={storiesOf(open.id)}
          counter={{
            index,
            total: shown.length,
            onPrevious: () => setSelected(shown[index - 1]?.id),
            onNext: () => setSelected(shown[index + 1]?.id),
          }}
          onClose={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
