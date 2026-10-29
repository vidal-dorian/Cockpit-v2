import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./api.ts";
import { decisionError } from "./tickets.ts";
import { focusRing } from "./ui.ts";

/** The GitHub issue of a story (decision 020 J): its link, and « Republier » when GitHub is behind the story. */
export function StoryIssue({
  id,
  issue,
  archived,
}: {
  id: number;
  issue: { number: number | null; url: string | null; upToDate: boolean };
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: async () => {
      const res = await client.api.stories[":id"].publish.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw await decisionError(res);
    },
    // Also after a refusal (wrong_status): show the real state of the story.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["story"] }),
        queryClient.invalidateQueries({
          queryKey: ["story-history", String(id)],
        }),
      ]),
  });

  return (
    <div className="mt-4">
      {issue.url && (
        <a href={issue.url} className={`underline ${focusRing}`}>
          Issue #{issue.number}
        </a>
      )}
      {!issue.upToDate && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p>L'issue GitHub n'est pas à jour.</p>
          <button
            type="button"
            disabled={archived || publish.isPending}
            onClick={() => publish.mutate()}
            className={`min-h-10 rounded-lg border border-border bg-card px-4 font-semibold disabled:opacity-50 ${focusRing}`}
          >
            Republier
          </button>
        </div>
      )}
      {publish.error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          {publish.error.message}
        </p>
      )}
    </div>
  );
}
