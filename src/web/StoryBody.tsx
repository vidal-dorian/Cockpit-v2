// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { Link } from "react-router";
import type { fetchStory } from "./StoryDecisions.tsx";
import { badge, card, focusRing, sectionLabel } from "./ui.ts";

type Found = Exclude<
  Awaited<ReturnType<typeof fetchStory>>,
  "not_found" | null
>;

const label = "font-semibold text-foreground";
const value = "text-muted-foreground";

/** What the user reads to decide on a story (decision 084 A): the narrative, the comment of a send back, the criteria; on the page of the story and in the panel of a card. */
export function StoryBody({ found }: { found: Found }) {
  return (
    <>
      <div className="grid gap-3">
        <p className={`${card} px-[18px] py-4 text-[15px] leading-[1.6]`}>
          <span className={label}>En tant que</span>{" "}
          <span className={value}>{found.story.asA}</span>,{" "}
          <span className={label}>je veux</span>{" "}
          <span className={value}>{found.story.iWant}</span>{" "}
          <span className={label}>afin de</span>{" "}
          <span className={value}>{found.story.soThat}</span>
        </p>
        {found.story.status === "to_rewrite" && found.story.rewriteComment && (
          <section className={`${card} p-4`}>
            <h2 className={sectionLabel}>Ton commentaire pour Claude</h2>
            <p className="mt-1 whitespace-pre-wrap">
              {found.story.rewriteComment}
            </p>
          </section>
        )}
      </div>
      <section className="pt-3">
        <h2
          className={`mb-2 flex items-baseline gap-2 ${found.story.criteria.some((k) => k.result) ? "" : "sr-only"}`}
        >
          <span className={sectionLabel}>Les critères</span>
          {found.story.criteria.some((k) => k.result) && (
            <span className="text-[12.5px] text-muted-foreground">
              · résultat de Claude, avec la preuve
            </span>
          )}
        </h2>
        <ol className="grid gap-3">
          {found.story.criteria.map((criterion, index) => (
            <li
              key={criterion.id}
              className={`${card} min-w-0 px-3.5 py-3 text-[13.5px] leading-normal break-words`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className={sectionLabel}>Critère {index + 1}</p>
                {criterion.result && (
                  <span className="ml-auto max-w-[70%] truncate rounded-[5px] bg-raised px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {criterion.result === "passed" ? "✓ passe" : "✕ échoue"}
                    {criterion.evidence &&
                      ` · ${criterion.evidence.split("\n")[0]}`}
                  </span>
                )}
              </div>
              {criterion.summary && (
                <p className="mt-1.5 font-semibold">{criterion.summary}</p>
              )}
              <p className="mt-1.5 leading-relaxed">
                <span className={label}>Étant donné</span>{" "}
                <span className={value}>{criterion.given}</span>
              </p>
              <p className="mt-1">
                <span className={label}>Quand</span>{" "}
                <span className={value}>{criterion.when}</span>
              </p>
              <p className="mt-1">
                <span className={label}>Alors</span>{" "}
                <span className={value}>{criterion.then}</span>
              </p>
              {criterion.takeoverState && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
                  <span className={badge}>
                    {criterion.takeoverState === "kept"
                      ? found.story.kind === "takeover" &&
                        found.story.status === "done" &&
                        criterion.result === "passed"
                        ? "figée"
                        : "validée"
                      : "à relire"}
                  </span>
                  <Link
                    to={`/projets/${found.project.id}/conception/regles?regle=${criterion.id}`}
                    className={`font-semibold underline ${focusRing}`}
                  >
                    Juger dans l'écran de reprise
                  </Link>
                </p>
              )}
              {criterion.result && criterion.evidence && (
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-muted-foreground">
                  {criterion.evidence}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
