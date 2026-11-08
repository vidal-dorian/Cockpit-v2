import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { TagField } from "./TagField.tsx";
import { fetchTickets, PRIORITIES } from "./tickets.ts";
import { button, field, focusRing, kbd, primaryButton } from "./ui.ts";

export type Idea = {
  projectId: string;
  title: string;
  descriptionMd: string;
  priority: keyof typeof PRIORITIES;
  tags: string[];
};

/** The idea bar grown upwards (decision 054 D, S09): title, description, project, priority and tags. « Noter » and Ctrl+Enter send, « Annuler » and Escape give the title back to the bar. */
export function IdeaPanel({
  projects,
  projectId: initialProjectId,
  title: initialTitle,
  pending,
  onSubmit,
  onCancel,
}: {
  projects: { id: number; label: string }[];
  projectId: string;
  title: string;
  pending: boolean;
  onSubmit: (idea: Idea) => void;
  /** Closes the panel; the title (maybe edited) goes back to the bar. */
  onCancel: (title: string) => void;
}) {
  const heading = useId();
  const [idea, setIdea] = useState<Idea>({
    projectId: initialProjectId,
    title: initialTitle,
    descriptionMd: "",
    priority: "normal",
    tags: [],
  });
  const set = (change: Partial<Idea>) => setIdea({ ...idea, ...change });
  // The tags already used in the chosen project, offered as suggestions.
  const used = useQuery({
    queryKey: ["tickets", idea.projectId],
    queryFn: () => fetchTickets(idea.projectId),
  });
  const suggestions = [
    ...new Set((used.data ?? []).flatMap((t) => t.tags ?? [])),
  ];
  const canSend = idea.title.trim() !== "" && !pending;
  const send = () => canSend && onSubmit(idea);

  return (
    <div
      role="dialog"
      aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel(idea.title);
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          send();
        }
      }}
      className="mb-2 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4"
    >
      <div>
        <h2 id={heading} className="font-semibold">
          Noter une idée
        </h2>
        <p className="text-[12.5px] text-muted-foreground">
          Claude en écrira les user stories
        </p>
      </div>
      <input
        aria-label="Titre"
        value={idea.title}
        maxLength={200}
        // biome-ignore lint/a11y/noAutofocus: the panel was just opened by the user, the keyboard goes on in it
        autoFocus
        onChange={(event) => set({ title: event.target.value })}
        className={field}
      />
      <textarea
        aria-label="Description"
        placeholder="Description (Markdown)"
        value={idea.descriptionMd}
        rows={4}
        onChange={(event) => set({ descriptionMd: event.target.value })}
        className={field}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Projet"
          value={idea.projectId}
          onChange={(event) => set({ projectId: event.target.value })}
          className={`max-w-[200px] rounded-[10px] bg-transparent px-2 py-1 font-semibold ${focusRing}`}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id} className="bg-card">
              {p.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Priorité"
          value={idea.priority}
          onChange={(event) =>
            set({ priority: event.target.value as Idea["priority"] })
          }
          className={`rounded-[10px] bg-transparent px-2 py-1 ${focusRing}`}
        >
          {Object.entries(PRIORITIES).map(([value, label]) => (
            <option key={value} value={value} className="bg-card">
              {label}
            </option>
          ))}
        </select>
        <TagField
          tags={idea.tags}
          onChange={(tags) => set({ tags })}
          suggestions={suggestions}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[12.5px] text-muted-foreground">
          Seuls le titre et le projet sont obligatoires.
        </p>
        <button
          type="button"
          onClick={() => onCancel(idea.title)}
          className={button}
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={!canSend}
          onClick={send}
          className={primaryButton}
        >
          Noter <kbd className={kbd}>Ctrl Entrée</kbd>
        </button>
      </div>
    </div>
  );
}
