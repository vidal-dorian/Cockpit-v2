/** Visible keyboard focus on every link and button (decision 003). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

// The page has no typography plugin: the few elements a description uses are styled here, with tokens.
export const markdownStyle =
  "break-words [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-card [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6";

// Shapes of decision 045 E, shared so that every screen looks the same: cards and lists 14px, buttons and fields 10px,
// badges are pills, 1px borders, no shadow on what is laid down. Each size is built from the shared base without the
// classes it sets itself, so no constant needs a conflicting class appended to it.

const buttonBase = `inline-flex items-center justify-center gap-2 whitespace-nowrap border font-semibold disabled:opacity-50 ${focusRing}`;
const buttonSize = "h-[34px] rounded-[10px] px-3.5 text-[13px]";
const panelSize = "h-[42px] w-full rounded-[10px] px-3.5 text-sm";
const secondary =
  "border-border-strong bg-raised text-foreground hover:bg-raised-hover";
const primary =
  "border-primary bg-primary text-primary-foreground hover:bg-primary-hover";

/** A secondary button (34px), on the raised surface; also fits a link. */
export const button = `${buttonBase} ${buttonSize} ${secondary}`;

/** The one white button of a zone (decision 045 C); also fits a link. */
export const primaryButton = `${buttonBase} ${buttonSize} ${primary}`;

/** A quiet button: no fill, no border, muted text. */
export const ghostButton = `${buttonBase} ${buttonSize} border-transparent bg-transparent text-muted-foreground hover:bg-raised hover:text-foreground`;

/** A secondary button at the bottom of the right panel (42px, full width). */
export const panelButton = `${buttonBase} ${panelSize} ${secondary}`;

/** The white button at the bottom of the right panel (42px, full width). */
export const panelPrimaryButton = `${buttonBase} ${panelSize} ${primary}`;

/** A destructive action: red fill, page-colored text. */
export const dangerButton = `${buttonBase} ${buttonSize} border-destructive bg-destructive text-background hover:opacity-90`;

/** The shape of a card without its fill, for a card on another surface (`bg-sunken`, `bg-raised`). */
export const cardShape = "rounded-[14px] border border-border";

/** A card: a bordered surface. */
export const card = `${cardShape} bg-card`;

/** A list of rows in one card: put `min-h-[50px]` rows inside, the dividers are drawn here. */
export const listCard = `${card} divide-y divide-border overflow-hidden`;

/** An error, always with a sentence next to the color. */
export const alertBox =
  "rounded-[14px] bg-destructive-soft p-4 text-destructive";

/** A text field or a select. */
export const field = `mt-1 block min-h-[34px] w-full rounded-[10px] border border-border-strong bg-sunken px-3 py-1.5 text-[13.5px] ${focusRing}`;

const badgeBase =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-0.5 text-xs font-semibold";

/** A neutral pill: counts, states, tags. */
export const badge = `${badgeBase} bg-raised text-muted-foreground`;

/** A pill for what asks for you (red, like the first thing to do). */
export const urgentBadge = `${badgeBase} bg-you-soft text-you-text`;

/** The small uppercase label above a section. */
export const sectionLabel =
  "text-[11.5px] font-bold uppercase tracking-[.08em] text-muted-foreground";

/** A keyboard key, as in « N » or « Ctrl K ». */
export const kbd =
  "rounded-[5px] border border-border-strong px-[5px] py-px font-mono text-[10.5px] font-medium text-muted-foreground";
