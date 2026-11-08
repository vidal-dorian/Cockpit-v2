import { useId, useState } from "react";
import { normalizeTag } from "./tickets.ts";
import { badge, focusRing } from "./ui.ts";

// Decision 054 A: at most 10 tags of 30 characters.
const MAX_TAGS = 10;

/** The tags of a ticket as chips and the field that adds one (« + étiquette », Enter); `suggestions` are the tags already used in the project. */
export function TagField({
  tags,
  onChange,
  suggestions = [],
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}) {
  const [text, setText] = useState("");
  const listId = useId();
  const add = () => {
    const tag = normalizeTag(text);
    if (tag !== "" && !tags.includes(tag) && tags.length < MAX_TAGS)
      onChange([...tags, tag]);
    setText("");
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
      {/* biome-ignore lint/a11y/useSemanticElements: an input with a list reads as a combobox; this one is a text field whose list only suggests */}
      <input
        aria-label="Étiquette"
        role="textbox"
        placeholder="+ étiquette"
        value={text}
        maxLength={30}
        list={listId}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          // Not the Enter of the form or of the panel: it only adds the tag.
          event.preventDefault();
          if (!(event.ctrlKey || event.metaKey)) add();
        }}
        className={`w-28 bg-transparent text-[13px] placeholder:text-dim ${focusRing}`}
      />
      <datalist id={listId}>
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
