import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { client } from "./api.ts";
import { STORY_STATUSES } from "./tickets.ts";
import { focusRing } from "./ui.ts";

/** The non-abandoned stories of a project, by ticket then position (decision 019). */
async function fetchStories(id: string) {
  const res = await client.api.projects[":id"].stories.$get({ param: { id } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).stories;
}

// The five columns, in order; a column holds the statuses it gathers.
const COLUMNS = [
  { name: "À valider", statuses: ["to_validate", "to_rewrite"] },
  { name: "Prêtes", statuses: ["ready"] },
  { name: "En cours", statuses: ["in_progress"] },
  { name: "En revue", statuses: ["in_review"] },
  { name: "Terminées", statuses: ["done"] },
];

/** The « Kanban » section of the project page: read-only, a card opens its story (no drag and drop, brief §6.3). */
export function ProjectKanban({ projectId }: { projectId: string }) {
  const stories = useQuery({
    queryKey: ["stories", projectId],
    queryFn: () => fetchStories(projectId),
  });

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
          <p
            role="alert"
            className="rounded-xl bg-destructive-soft p-4 text-destructive"
          >
            Impossible de lire les user stories.
          </p>
        )}
        {stories.data && (
          <div className="flex flex-col gap-3 sm:flex-row sm:overflow-x-auto">
            {COLUMNS.map(({ name, statuses }) => {
              const cards = stories.data.filter((s) =>
                statuses.includes(s.status),
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
                            <span className="block font-semibold underline">
                              {story.iWant}
                            </span>{" "}
                            <span className="block text-muted-foreground">
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
