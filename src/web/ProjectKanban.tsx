import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { client } from "./api.ts";
import { STORY_STATUSES } from "./tickets.ts";
import { focusRing } from "./ui.ts";

/** The non-abandoned stories of a project, by ticket then position (decision 019), or null when the server answers 401. */
async function fetchStories(id: string) {
  const res = await client.api.projects[":id"].stories.$get({ param: { id } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).stories;
}

type StoryStatus = NonNullable<
  Awaited<ReturnType<typeof fetchStories>>
>[number]["status"];

// The five columns, in order.
const COLUMNS = [
  "À valider",
  "Prêtes",
  "En cours",
  "En revue",
  "Terminées",
] as const;

// The column of each status; `satisfies` makes tsc fail when a story status has no column (abandoned has none).
const COLUMN_OF = {
  to_validate: "À valider",
  to_rewrite: "À valider",
  ready: "Prêtes",
  in_progress: "En cours",
  in_review: "En revue",
  done: "Terminées",
} satisfies Record<Exclude<StoryStatus, "abandoned">, (typeof COLUMNS)[number]>;

/** The « Kanban » section of the project page: read-only, a card opens its story (no drag and drop, brief §6.3). */
export function ProjectKanban({ projectId }: { projectId: string }) {
  const stories = useQuery({
    queryKey: ["stories", projectId],
    queryFn: () => fetchStories(projectId),
  });

  const board = stories.data; // a const, so the narrowing holds inside the callbacks below

  return (
    <section className="mt-10" aria-labelledby="kanban">
      <h2 id="kanban" className="font-heading text-xl font-bold">
        Kanban
      </h2>
      <div className="mt-3" aria-live="polite">
        {stories.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {stories.isError && (
          <div
            role="alert"
            className="rounded-xl bg-destructive-soft p-4 text-destructive"
          >
            <p>Impossible de lire les user stories.</p>
            <button
              type="button"
              onClick={() => stories.refetch()}
              className={`mt-3 min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {stories.isSuccess && stories.data === null && (
          <a
            href="/api/auth/login"
            className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
          >
            Se connecter avec GitHub
          </a>
        )}
        {board && (
          // biome-ignore lint/a11y/useSemanticElements: a <section> with this role is flagged as redundant, and the role is wanted explicit
          <div
            role="region"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1)
            tabIndex={0}
            aria-label="Colonnes du Kanban"
            className={`flex flex-col gap-3 sm:flex-row sm:overflow-x-auto ${focusRing}`}
          >
            {COLUMNS.map((name) => {
              const cards = board.filter(
                (s) => s.status !== "abandoned" && COLUMN_OF[s.status] === name,
              );
              return (
                <section key={name} className="sm:min-w-56 sm:flex-1">
                  <h3 className="font-heading text-lg font-bold">
                    {name} ({cards.length})
                  </h3>
                  {cards.length === 0 ? (
                    <p className="mt-2 text-muted-foreground">Aucune</p>
                  ) : (
                    <ul className="mt-2 grid gap-2">
                      {cards.map((story) => (
                        <li key={story.id} className="rounded-xl bg-card">
                          <Link
                            to={`/us/${story.id}`}
                            className={`block p-4 ${focusRing}`}
                          >
                            {/* The {" "} separators keep the visible words apart in the accessible name and in textContent. */}
                            <span className="block font-semibold underline">
                              {story.iWant}
                            </span>{" "}
                            <span className="block text-muted-foreground">
                              <span className="sr-only">Ticket : </span>
                              {story.ticketTitle}
                            </span>{" "}
                            {story.status === "to_rewrite" && (
                              <span className="mt-1 inline-block rounded-full bg-claude-soft px-3 py-1 font-semibold text-claude-text">
                                {STORY_STATUSES.to_rewrite}
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
