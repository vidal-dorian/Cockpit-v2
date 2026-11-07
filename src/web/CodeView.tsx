import { useEffect, useState } from "react";
import { languageOf } from "./code-language.ts";

/**
 * Decision 047 F and G: code with its line numbers, the cited lines on the raised surface with an ink bar on the left.
 * `lines` start at line `firstLine`; `start`..`end` are the cited ones. Plain text first; Shiki is loaded on demand, only here, and the tokens replace the text when they arrive.
 */
export function CodeView({
  path,
  firstLine,
  lines,
  start,
  end,
}: {
  path: string;
  firstLine: number;
  lines: string[];
  start: number;
  end: number;
}) {
  const language = languageOf(path);
  const text = lines.join("\n");
  const [done, setDone] = useState<{ text: string; html: string[] }>();
  useEffect(() => {
    if (!language) return;
    let current = true;
    import("./highlight.ts")
      .then((m) => m.highlightLines(text.split("\n"), language))
      .then((html) => current && setDone({ text, html }))
      // Plain text for good: the code is readable without colours.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [text, language]);
  const html = done?.text === text ? done.html : null;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-sunken py-2.5 font-mono text-xs leading-[1.65] text-foreground">
      {lines.map((line, i) => {
        const n = firstLine + i;
        const cited = n >= start && n <= end;
        return (
          <div
            key={n}
            data-line={n}
            data-cited={cited ? "" : undefined}
            className={`w-max min-w-full px-3.5 whitespace-pre ${cited ? "bg-raised shadow-[inset_2px_0_0_var(--color-foreground)]" : ""}`}
          >
            <span className="inline-block w-7 text-dim select-none">{n}</span>
            {html?.[i] === undefined ? (
              line
            ) : (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightLines escapes every token; only its own spans are markup
              <span dangerouslySetInnerHTML={{ __html: html[i] }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
