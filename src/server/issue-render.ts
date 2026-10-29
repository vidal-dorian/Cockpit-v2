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
  const sections = [
    `En tant que ${story.asA}, je veux ${story.iWant}, afin de ${story.soThat}.`,
    `**Statut** : ${french}`,
    story.notesMd && `## Notes\n\n${story.notesMd}`,
    `## Critères d'acceptation\n\n${story.criteria
      .map(
        (k) =>
          `- [ ] **Étant donné** ${k.given} **quand** ${k.when} **alors** ${k.then}`,
      )
      .join("\n")}`,
    story.dependsOn.length > 0 &&
      `## Dépendances\n\n${story.dependsOn
        .map(
          (d) =>
            `- Dépend de ${d.issueNumber ? `#${d.issueNumber}` : `US ${d.id}`}`,
        )
        .join("\n")}`,
    "Géré par Cockpit : modifie cette user story dans Cockpit, pas ici.",
    `<!-- cockpit:story:${story.id} -->`,
  ];
  return {
    title: story.iWant,
    body: sections.filter(Boolean).join("\n\n"),
    label: `cockpit: ${french}`,
    state: closedAs ? ("closed" as const) : ("open" as const),
    stateReason: closedAs,
  };
}
