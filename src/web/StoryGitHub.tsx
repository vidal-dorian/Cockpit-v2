import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./api.ts";
import { alertBox, button, focusRing } from "./ui.ts";

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

  return (
    <section className="mt-4">
      <h2 className="font-heading text-xl font-bold">GitHub</h2>
      <p className="mt-2">
        <a
          href={`https://github.com/${fullName}/pull/${story.prNumber}`}
          className={`underline ${focusRing}`}
        >
          PR n° {story.prNumber}
        </a>
      </p>
      <p>État : {story.status === "done" ? "Mergée" : "Ouverte"}</p>
      <p>CI : {story.prCiState ? CI[story.prCiState] : "Aucune"}</p>
      <p>
        Revue :{" "}
        {story.prReviewState ? REVIEW[story.prReviewState] : "En attente"}
      </p>
      <button
        type="button"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
        className={`mt-2 ${button}`}
      >
        Actualiser
      </button>
      {refresh.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {refresh.error.message}
        </p>
      )}
    </section>
  );
}
