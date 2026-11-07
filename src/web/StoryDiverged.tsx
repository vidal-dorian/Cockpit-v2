import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useMemo } from "react";
import { client } from "./api.ts";
import { type DiffLine, diffLines } from "./diff.ts";
import { fetchMe } from "./Shell.tsx";
import { useStoryValidation } from "./StoryDecisions.tsx";
import { decisionError } from "./tickets.ts";
import { alertBox, button, card, primaryButton, sectionLabel } from "./ui.ts";
import { ago } from "./when.ts";

const MARKS = {
  same: { word: "", prefix: " ", style: "" },
  removed: { word: "Retirée", prefix: "-", style: "text-dim line-through" },
  added: {
    word: "Ajoutée",
    prefix: "+",
    style: "bg-raised shadow-[inset_2px_0_0_var(--color-muted-foreground)]",
  },
};

/** One side of the diff (S26): its lines in a code block, the marks always in words as well as in style (decision 003). */
function DiffColumn({
  title,
  meta,
  lines,
}: {
  title: string;
  meta?: string | null;
  lines: DiffLine[];
}) {
  return (
    <section aria-label={title} className="grid content-start gap-2">
      <div className="flex items-baseline gap-2">
        <span className={sectionLabel}>{title}</span>
        {meta && (
          <span className="text-[12.5px] text-muted-foreground">{meta}</span>
        )}
      </div>
      <ul className="min-h-40 overflow-x-auto rounded-xl border border-border bg-sunken py-2.5 font-mono text-xs leading-[1.65]">
        {lines.map(({ type, text }, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines are never reordered, and two can be equal
          <li key={index} className={`flex gap-2 px-3.5 ${MARKS[type].style}`}>
            <span aria-hidden="true">{MARKS[type].prefix}</span>
            {MARKS[type].word && (
              <span className="sr-only">{MARKS[type].word}</span>
            )}
            <span className="whitespace-pre-wrap break-words">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  const validation = useStoryValidation(id);
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
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
    <section className="px-[26px] pt-[22px]" aria-labelledby="issue-diverged">
      <h2 id="issue-diverged" className={sectionLabel}>
        Issue modifiée sur GitHub
      </h2>
      <p className="mt-1 text-muted-foreground">
        Modifiée le {new Date(diverged.at).toLocaleString("fr-FR")}. Cockpit
        n'écrit plus sur cette issue tant que tu n'as pas choisi.
      </p>
      {diverged.githubTitle !== diverged.cockpitTitle && (
        <p className="mt-2">
          <span className="font-semibold">Titre</span> {diverged.githubTitle}
        </p>
      )}
      {lines ? (
        <div className="mt-3 grid gap-3.5 md:grid-cols-2">
          <DiffColumn
            title="Dans Cockpit"
            meta={
              validation.data &&
              `validée ${ago(validation.data.at)} par ${me.data?.name ?? "toi"}`
            }
            lines={lines.filter((l) => l.type !== "added")}
          />
          <DiffColumn
            title="Sur GitHub"
            meta={`modifiée ${ago(diverged.at)}`}
            lines={lines.filter((l) => l.type !== "removed")}
          />
        </div>
      ) : (
        <div className={`mt-3 overflow-x-auto p-3 ${card}`}>
          <h3 className={sectionLabel}>Version de Cockpit</h3>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-sm">
            {diverged.cockpitBody}
          </pre>
          <h3 className={`mt-3 ${sectionLabel}`}>Version de GitHub</h3>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-sm">
            {diverged.githubBody}
          </pre>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={archived || resolve.isPending}
          onClick={() => resolve.mutate("take-github")}
          className={primaryButton}
        >
          Garder la version GitHub
        </button>
        <button
          type="button"
          disabled={archived || resolve.isPending}
          onClick={() => resolve.mutate("keep-cockpit")}
          className={button}
        >
          Garder la version Cockpit
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
