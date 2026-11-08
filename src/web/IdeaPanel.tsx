import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { TagField } from "./TagField.tsx";
import { fetchTickets, PRIORITIES, withPending } from "./tickets.ts";
import { button, field, focusRing, kbd, primaryButton } from "./ui.ts";

export type Idea = {
  projectId: string;
  title: string;
  descriptionMd: string;
  priority: keyof typeof PRIORITIES;
  tags: string[];
};

/** The idea bar grown upwards (decision 054 D, S09): title, description, project, priority and tags. The draft is the caller's, so that it survives « Annuler » and Escape; both are ignored while the idea is sending. */
export function IdeaPanel({
  projects,
  idea,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  projects: { id: number; label: string }[];
  idea: Idea;
  pending: boolean;
  onChange: (change: Partial<Idea>) => void;
  onSubmit: (idea: Idea) => void;
  onCancel: () => void;
}) {
  const heading = useId();
  const [tagText, setTagText] = useState("");
  const set = onChange;
  // The tags already used in the chosen project, offered as suggestions.
  const used = useQuery({
    queryKey: ["tickets", idea.projectId],
    queryFn: () => fetchTickets(idea.projectId),
  });
  const suggestions = [
    ...new Set((used.data ?? []).flatMap((t) => t.tags ?? [])),
  ];
  const canSend = idea.title.trim() !== "" && !pending;
  const send = () =>
    canSend && onSubmit({ ...idea, tags: withPending(idea.tags, tagText) });

  return (
    <div
      role="dialog"
      aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onCancel();
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
          text={tagText}
          onText={setTagText}
          suggestions={suggestions}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[12.5px] text-muted-foreground">
          Seuls le titre et le projet sont obligatoires.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
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
