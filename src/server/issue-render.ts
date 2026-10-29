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
 * User text, made inert on GitHub: a mention would notify someone, and a comment (`<!--`) or its end could hide the footer or forge the marker, so
 * `@` gets a zero-width space after it and `<!--` and `-->` become HTML entities. Nothing else can trigger anything.
 */
const inert = (text: string) =>
  text
    .replaceAll("@", "@\u200B")
    .replaceAll("<!--", "&lt;!--")
    .replaceAll("-->", "--&gt;");

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
  const title = inert(story.iWant);
  return {
    title: title.length > TITLE_MAX ? `${clip(title, TITLE_MAX - 1)}…` : title,
    body,
    label: `cockpit: ${french}`,
    state: closedAs ? ("closed" as const) : ("open" as const),
    stateReason: closedAs,
  };
}
