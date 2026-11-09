import { useId, useState } from "react";
import { MAX_TAGS, normalizeTag } from "./tickets.ts";
import { badge, focusRing } from "./ui.ts";

/** The badges of a ticket: its tags, and « priorité haute » for a high priority. */
export function TicketTags({
  tags = [],
  priority,
}: {
  tags?: string[];
  priority?: string;
}) {
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className={badge}>
          {tag}
        </span>
      ))}
      {priority === "high" && <span className={badge}>priorité haute</span>}
    </>
  );
}

/** The tags of a ticket as chips and the field that adds one (« + étiquette », Enter); `text` is what is typed there, kept by the caller so that it can add it on save; `suggestions` are the tags already used in the project. */
export function TagField({
  tags,
  onChange,
  text,
  onText,
  suggestions = [],
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  text: string;
  onText: (text: string) => void;
  suggestions?: string[];
}) {
  const [full, setFull] = useState(false);
  const listId = useId();
  const add = () => {
    const tag = normalizeTag(text);
    if (tag !== "" && !tags.includes(tag) && tags.length >= MAX_TAGS)
      return setFull(true);
    if (tag !== "" && !tags.includes(tag)) onChange([...tags, tag]);
    onText("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span key={tag} className={badge}>
          {tag}
          <button
            type="button"
            aria-label={`Retirer l'étiquette ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className={`rounded-full ${focusRing}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label="Étiquette"
        placeholder="+ étiquette"
        value={text}
        maxLength={30}
        list={listId}
        onChange={(event) => {
          setFull(false);
          onText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          // Not the Enter of the form or of the panel: it only adds the tag.
          event.preventDefault();
          if (!(event.ctrlKey || event.metaKey)) add();
        }}
        className={`w-28 bg-transparent text-base md:text-[13px] md:leading-[inherit] placeholder:text-dim ${focusRing}`}
      />
      {full && (
        <span
          role="status"
          className="basis-full text-[12.5px] text-muted-foreground"
        >
          {MAX_TAGS} étiquettes au plus.
        </span>
      )}
      <datalist id={listId}>
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
