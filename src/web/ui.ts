/** Visible keyboard focus on every link and button (decision 003). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

// The page has no typography plugin: the few elements a description uses are styled here, with tokens.
export const markdownStyle =
  "break-words [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-card [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6";

// Shapes of decision 028 C, shared so that every screen looks the same.

/** A secondary button, on the raised surface. */
export const button = `min-h-10 rounded-xl border border-border-strong bg-raised px-4 font-semibold hover:bg-raised-hover disabled:opacity-50 ${focusRing}`;

/** The one orange button of a zone (decision 003, rule 2); also fits a link. */
export const primaryButton = `inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50 ${focusRing}`;

/** A card: a bordered surface. */
export const card = "rounded-2xl border border-border bg-card";

/** An error, always with a sentence next to the color. */
export const alertBox = "rounded-xl bg-destructive-soft p-4 text-destructive";

/** A text field or a select. */
export const field = `mt-1 block min-h-10 w-full rounded-xl border border-border bg-sunken px-3 py-2 ${focusRing}`;

/** A tab of a row of links: the open one is underlined, the others are secondary. */
export const tabLink = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-10 items-center border-b-2 px-3 font-semibold ${focusRing} ${isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
