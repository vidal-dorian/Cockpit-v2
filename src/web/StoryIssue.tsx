import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  // Set after a successful publication; a callback ref, since the link may only appear once the story is read again (a first publication).
  const [focusLink, setFocusLink] = useState(false);
  const focusOnLink = (element: HTMLAnchorElement | null) => {
    if (!element || !focusLink) return;
    element.focus();
    setFocusLink(false);
  };
  const publish = useMutation({
    mutationFn: async () => {
      const res = await client.api.stories[":id"].publish.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw await decisionError(res);
      // 200 does not mean GitHub took it: the sync never throws, a failure only leaves the issue behind.
      const { story } = await res.json();
      if (!story.issue?.upToDate)
        throw new Error(
          "GitHub n'a pas pris la mise à jour : l'issue n'est toujours pas à jour. Réessaie dans un instant.",
        );
    },
    onSuccess: () => setFocusLink(true),
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
        <a
          ref={focusOnLink}
          href={issue.url}
          className={`underline ${focusRing}`}
        >
          Issue #{issue.number}
        </a>
      )}
      {/* Always rendered: a live region is only announced when its content changes. */}
      <div role="status">
        {!issue.upToDate && (
          <p className="mt-2">L'issue GitHub n'est pas à jour.</p>
        )}
      </div>
      {!issue.upToDate && (
        <button
          type="button"
          disabled={archived || publish.isPending}
          onClick={() => publish.mutate()}
          className={`mt-2 min-h-10 rounded-lg border border-border bg-card px-4 font-semibold disabled:opacity-50 ${focusRing}`}
        >
          Republier
        </button>
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
