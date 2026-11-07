import type { DiffLine } from "./diff.ts";

// The word always comes with the color, so a change never relies on color alone (decision 003).
const MARKS = {
  same: { word: "", style: "" },
  removed: { word: "Retirée", style: "text-dim line-through" },
  added: {
    word: "Ajoutée",
    style: "bg-raised shadow-[inset_2px_0_0_var(--color-muted-foreground)]",
  },
};

/** The lines of a diff (decision 025 E), one list item each. */
export function DiffList({ lines }: { lines: DiffLine[] }) {
  return (
    <ul className="grid rounded-xl border border-border bg-sunken py-2.5 font-mono text-xs leading-[1.65]">
      {lines.map(({ type, text }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines are never reordered, and two can be equal
        <li key={index} className={`flex gap-3 px-3.5 ${MARKS[type].style}`}>
          <span className="w-16 shrink-0 font-semibold">
            {MARKS[type].word}
          </span>
          <span className="whitespace-pre-wrap break-words">{text}</span>
        </li>
      ))}
    </ul>
  );
}
