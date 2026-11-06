import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useMemo } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { decisionError } from "./tickets.ts";
import { alertBox, button, card } from "./ui.ts";

/** An issue edited on GitHub (decision 025 E to G): the date, the title if it changed, the line by line diff of the bodies, and the choice of the user. */
export function StoryDiverged({
  id,
  diverged,
  archived,
  statusRef,
}: {
  id: number;
  diverged: {
    at: string;
    githubTitle: string;
    githubBody: string;
    cockpitTitle: string;
    cockpitBody: string;
  };
  archived: boolean;
  /** The status of the story on the page (tabIndex -1): where the focus goes once this section is gone. */
  statusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: async (choice: "keep-cockpit" | "take-github") => {
      const param = { param: { id: String(id) } };
      const res =
        choice === "keep-cockpit"
          ? await client.api.stories[":id"].issue["keep-cockpit"].$post(param)
          : await client.api.stories[":id"].issue["take-github"].$post(param);
      if (!res.ok) throw await decisionError(res);
    },
    onSuccess: () => statusRef.current?.focus(),
    // Also after a refusal: show the real state of the story.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["story"] }),
        queryClient.invalidateQueries({ queryKey: ["stories"] }),
        queryClient.invalidateQueries({
          queryKey: ["story-history", String(id)],
        }),
      ]),
  });
  const lines = useMemo(
    () => diffLines(diverged.cockpitBody, diverged.githubBody),
    [diverged.cockpitBody, diverged.githubBody],
  );

  return (
    <section className={`mt-4 ${card} p-4`} aria-labelledby="issue-diverged">
      <h2 id="issue-diverged" className="font-semibold">
        Issue modifiée sur GitHub
      </h2>
      <p className="mt-1">
        Modifiée le {new Date(diverged.at).toLocaleString("fr-FR")}. Cockpit
        n'écrit plus sur cette issue tant que tu n'as pas choisi.
      </p>
      {diverged.githubTitle !== diverged.cockpitTitle && (
        <p className="mt-2">
          <span className="font-semibold">Titre</span> {diverged.githubTitle}
        </p>
      )}
      {lines ? (
        <DiffList lines={lines} />
      ) : (
        <>
          <h3 className="mt-3 font-semibold">Version de Cockpit</h3>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-sm">
            {diverged.cockpitBody}
          </pre>
          <h3 className="mt-3 font-semibold">Version de GitHub</h3>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-sm">
            {diverged.githubBody}
          </pre>
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={archived || resolve.isPending}
          onClick={() => resolve.mutate("keep-cockpit")}
          className={button}
        >
          Garder la version de Cockpit
        </button>
        <button
          type="button"
          disabled={archived || resolve.isPending}
          onClick={() => resolve.mutate("take-github")}
          className={button}
        >
          Reprendre la version de GitHub
        </button>
      </div>
      {resolve.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {resolve.error.message}
        </p>
      )}
    </section>
  );
}
