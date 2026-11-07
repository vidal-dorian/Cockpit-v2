import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./api.ts";
import { alertBox, focusRing, ghostButton, sectionLabel } from "./ui.ts";

const CI = {
  pending: "En cours",
  success: "Réussie",
  failure: "En échec",
} as const;
const REVIEW = {
  approved: "Approuvée",
  changes_requested: "Modifications demandées",
} as const;

/** The pull request of a story (decision 038 G): its link, state, CI and review, and « Actualiser » which reads it again on GitHub. */
export function StoryGitHub({
  story,
  fullName,
}: {
  story: {
    id: number;
    status: string;
    branch?: string | null;
    prNumber: number;
    prCiState: keyof typeof CI | null;
    prReviewState: keyof typeof REVIEW | null;
  };
  fullName: string;
}) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: async () => {
      const res = await client.api.stories[":id"].pr.refresh.$post({
        param: { id: String(story.id) },
      });
      if (!res.ok)
        throw new Error(
          "GitHub n'a pas répondu : la pull request n'a pas pu être relue. Réessaie dans un instant.",
        );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["story"] }),
  });

  const rows: [string, string | null][] = [
    ["Branche", story.branch ?? null],
    // The state comes from the story: unknown once it is abandoned or back to ready.
    [
      "État",
      story.status === "done"
        ? "Mergée"
        : story.status === "in_review" || story.status === "in_progress"
          ? "Ouverte"
          : null,
    ],
    ["CI", story.prCiState ? CI[story.prCiState] : "Aucune"],
    ["Revue", story.prReviewState ? REVIEW[story.prReviewState] : "En attente"],
  ];

  return (
    <section className="grid gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={sectionLabel}>GitHub</h2>
        <button
          type="button"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
          className={ghostButton}
        >
          Actualiser
        </button>
      </div>
      <p className="text-lg font-semibold">
        <a
          href={`https://github.com/${fullName}/pull/${story.prNumber}`}
          className={`underline ${focusRing}`}
        >
          PR n° {story.prNumber}
        </a>
      </p>
      <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5 text-[13.5px]">
        {rows.map(
          ([term, value]) =>
            value && (
              <div key={term} className="contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd
                  className={
                    term === "Branche" ? "font-mono text-[12.5px]" : ""
                  }
                >
                  {value}
                </dd>
              </div>
            ),
        )}
      </dl>
      {refresh.error && (
        <p role="alert" className={alertBox}>
          {refresh.error.message}
        </p>
      )}
    </section>
  );
}
