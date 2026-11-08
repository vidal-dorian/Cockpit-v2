import Markdown from "react-markdown";
import { markdownStyle } from "./ui.ts";

/** A markdown description: no raw HTML, no remote image (it would be a tracking pixel): react-markdown ignores the HTML and drops unsafe link addresses (decision 014 H). */
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className={markdownStyle}>
      <Markdown disallowedElements={["img"]}>{children}</Markdown>
    </div>
  );
}
