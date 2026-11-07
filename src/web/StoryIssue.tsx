import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { fetchMe } from "./Shell.tsx";
import { fetchStoryHistory } from "./StoryDecisions.tsx";
import { decisionError } from "./tickets.ts";
import { ago } from "./when.ts";
import { alertBox, button, focusRing } from "./ui.ts";

/** The GitHub issue of a story (decision 020 J): its link, and « Republier » when GitHub is behind the story. */
export function StoryIssue({
  id,
  issue,
  archived,
}: {
  id: number;
  issue: {
    number: number | null;
    url: string | null;
    upToDate: boolean;
    diverged?: unknown;
  };
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
  // Who validated the story and when: its latest validation in the history (the issue is published at that moment).
  const validation = useQuery({
    queryKey: ["story-history", String(id), "validation"],
    queryFn: async () =>
      (await fetchStoryHistory(id)).find(
        (e) => e.action === "validate_story" && e.result === "ok",
      ) ?? null,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
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
    <div className="px-[26px] pt-3 text-[12.5px] text-muted-foreground">
      {issue.url && (
        <a
          ref={focusOnLink}
          href={issue.url}
          className={`underline ${focusRing}`}
        >
          Issue GitHub #{issue.number}
        </a>
      )}
      {issue.url && validation.data && (
        <>
          {" "}
          · validée par {me.data?.name ?? me.data?.login ?? "toi"}{" "}
          {ago(validation.data.at)}
        </>
      )}
      {/* Always rendered: a live region is only announced when its content changes. */}
      <div role="status">
        {!issue.upToDate && (
          <p className="mt-2">L'issue GitHub n'est pas à jour.</p>
        )}
      </div>
      {/* While the issue is diverged the sync writes nothing: the choice is in the section below. */}
      {!issue.upToDate && !issue.diverged && (
        <button
          type="button"
          disabled={archived || publish.isPending}
          onClick={() => publish.mutate()}
          className={`mt-2 ${button}`}
        >
          Republier
        </button>
      )}
      {publish.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {publish.error.message}
        </p>
      )}
    </div>
  );
}
