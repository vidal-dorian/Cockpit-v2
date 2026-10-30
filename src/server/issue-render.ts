import type { StoryStatus } from "./stories.ts";

/** The statuses from which a story has an issue (decision 020 A): everything past the validation. */
export type IssueStatus = Exclude<StoryStatus, "to_validate" | "to_rewrite">;

// The French word of the status and the issue's label, state and reason (decision 020 C and D).
const BY_STATUS: Record<
  IssueStatus,
  { french: string; closedAs: "completed" | "not_planned" | null }
> = {
  ready: { french: "prête", closedAs: null },
  in_progress: { french: "en cours", closedAs: null },
  in_review: { french: "en revue", closedAs: null },
  done: { french: "terminée", closedAs: "completed" },
  abandoned: { french: "abandonnée", closedAs: "not_planned" },
};

export const isIssueStatus = (status: StoryStatus): status is IssueStatus =>
  status in BY_STATUS;

/** Every label Cockpit puts on an issue: only these are ever removed (decision 020 C). */
export const COCKPIT_LABELS = Object.values(BY_STATUS).map(
  ({ french }) => `cockpit: ${french}`,
);

// GitHub's limits, in UTF-16 units (decision 020 B).
const TITLE_MAX = 256;
const BODY_MAX = 65_536;
const CUT_MENTION = "(tronqué : la version complète est dans Cockpit)";
const FOOTER =
  "Géré par Cockpit : modifie cette user story dans Cockpit, pas ici.";

/** The first `max` characters of a text, never ending in half of a surrogate pair. */
const clip = (text: string, max: number) =>
  /[\uD800-\uDBFF]/.test(text.charAt(max - 1))
    ? text.slice(0, max - 1)
    : text.slice(0, max);

/**
 * User text, made less dangerous on GitHub: a mention would notify someone, and a comment (`<!--`) could hide the footer or forge the marker.
 * Only a `@` where GitHub sees a mention (start of text, after a space or punctuation) gets a zero-width space, so `/package/@scope` links and
 * `a@b` stay intact; a lone `-->` closes nothing once every `<!--` is escaped, so Mermaid arrows stay. `#12` links and open code fences remain.
 */
const inert = (text: string) =>
  text
    .replace(/(^|[\s([{"'<>,;:!?*_~])@(?=[\p{L}\p{N}])/gu, "$1@\u200B")
    .replaceAll("<!--", "&lt;!--");

/** User text for a one-line place (a criterion): the newlines become spaces, so it cannot open a title or another checkbox. */
const oneLine = (text: string) => inert(text).replace(/\s*[\r\n]+\s*/g, " ");

/** The issue of a story (decision 020 B to D): a pure function, so the same story always gives the same body and hash. */
export function renderIssue(story: {
  id: number;
  asA: string;
  iWant: string;
  soThat: string;
  notesMd: string;
  status: IssueStatus;
  criteria: { given: string; when: string; then: string }[];
  dependsOn: { id: number; issueNumber: number | null }[];
}) {
  const { french, closedAs } = BY_STATUS[story.status];
  const head = [
    `En tant que ${inert(story.asA)}, je veux ${inert(story.iWant)}, afin de ${inert(story.soThat)}.`,
    `**Statut** : ${french}`,
  ];
  const tail = [
    `## Critères d'acceptation\n\n${story.criteria
      .map(
        (k) =>
          `- [ ] **Étant donné** ${oneLine(k.given)} **quand** ${oneLine(k.when)} **alors** ${oneLine(k.then)}`,
      )
      .join("\n")}`,
    story.dependsOn.length > 0 &&
      `## Dépendances\n\n${story.dependsOn
        .map(
          (d) =>
            `- Dépend de ${d.issueNumber ? `#${d.issueNumber}` : `US ${d.id}`}`,
        )
        .join("\n")}`,
  ];
  const end = [FOOTER, `<!-- cockpit:story:${story.id} -->`];
  const join = (parts: (string | false)[]) =>
    parts.filter(Boolean).join("\n\n");
  const notes = inert(story.notesMd);
  const withNotes = (text: string) => text && `## Notes\n\n${text}`;
  let body = join([...head, withNotes(notes), ...tail, ...end]);
  if (body.length > BODY_MAX) {
    // The notes give way first; the footer and the marker always stay.
    const over = body.length - BODY_MAX + CUT_MENTION.length + 2;
    body = join([
      ...head,
      withNotes(clip(notes, Math.max(0, notes.length - over))),
      ...tail,
      CUT_MENTION,
      ...end,
    ]);
    // shortcut: when the criteria alone are over the limit they are cut mid-line, upgrade if a story ever has 60,000 characters of criteria.
    if (body.length > BODY_MAX) {
      const kept = join([...head, ...tail]);
      const room = BODY_MAX - join([CUT_MENTION, ...end]).length - 2;
      body = join([`${clip(kept, room - 1)}…`, CUT_MENTION, ...end]);
    }
  }
  // A title is plain text on GitHub: nothing in it notifies or hides anything, so it is only cut.
  const title = story.iWant;
  return {
    title: title.length > TITLE_MAX ? `${clip(title, TITLE_MAX - 1)}…` : title,
    body,
    label: `cockpit: ${french}`,
    state: closedAs ? ("closed" as const) : ("open" as const),
    stateReason: closedAs,
  };
}

const quiet = (text: string) =>
  text.replaceAll("@\u200B", "@").replaceAll("&lt;!--", "<!--");
const NARRATIVE = /^En tant que (.+?), je veux (.+?), afin de (.+)\.(?:\n|$)/;
const CRITERION =
  /^- \[[ xX]\] \*\*Étant donné\*\* (.+?) \*\*quand\*\* (.+?) \*\*alors\*\* (.+)$/;
const CRITERIA_HEADING = "\n\n## Critères d'acceptation\n\n";
const NOTES_HEADING = "\n\n## Notes\n\n";

/**
 * The inverse of `renderIssue` (decision 025 G): the narrative, the notes and the criteria of a body, or null when it no longer follows the template
 * or Cockpit cut it. The status line, the dependencies, the footer and the marker are not read.
 * shortcut: a part that holds ", je veux " or ", afin de " is split at the first one, and a narrative over several lines is not read; upgrade if people hit it.
 */
export function parseIssue(body: string) {
  const cut = body.lastIndexOf(CRITERIA_HEADING);
  if (cut < 0 || body.includes("(tronqué")) return null;
  const head = body.slice(0, cut);
  const narrative = NARRATIVE.exec(head);
  // The whole paragraph under the heading must be criteria: a line that is not one means the template is gone.
  const lines =
    body.slice(cut + CRITERIA_HEADING.length).split("\n\n")[0] ?? "";
  const criteria = lines.split("\n").map((line) => CRITERION.exec(line));
  const parts = [narrative, ...criteria].flatMap((m) => m?.slice(1, 4) ?? []);
  if (
    !narrative ||
    criteria.includes(null) ||
    parts.some((part) => !part.trim())
  )
    return null;
  const notesAt = head.indexOf(NOTES_HEADING);
  return {
    asA: quiet(narrative[1] ?? ""),
    iWant: quiet(narrative[2] ?? ""),
    soThat: quiet(narrative[3] ?? ""),
    notesMd:
      notesAt < 0 ? "" : quiet(head.slice(notesAt + NOTES_HEADING.length)),
    criteria: criteria.map((m) => ({
      given: quiet(m?.[1] ?? ""),
      when: quiet(m?.[2] ?? ""),
      // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
      then: quiet(m?.[3] ?? ""),
    })),
  };
}
