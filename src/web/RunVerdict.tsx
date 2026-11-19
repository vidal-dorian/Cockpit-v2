import { Link } from "react-router";
import { button, card, focusRing, primaryButton, sectionLabel } from "./ui.ts";

export const REASONS: Record<string, string> = {
  run_not_succeeded: "Le run n'a pas réussi",
  no_pull_request: "Aucune PR liée",
  ci_failing: "La CI échoue",
  ci_pending: "La CI tourne encore",
  ci_missing: "Aucune CI sur la PR",
  changes_requested: "Des modifications sont demandées sur la PR",
  app_code_changed: "La PR modifie du code de l'app, pas seulement des tests",
};

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The decision aid of a finished run (decision 039 E): the verdict in words and its reasons; the main action is `RunAction`. */
export function RunVerdict({
  verdict,
  criteria,
  story,
  summary,
  prUrl,
  projectId,
  criteriaTo,
}: {
  verdict: { acceptable: boolean; reasons: string[] };
  criteria: { result: string | null }[];
  story: { prAppFiles: string[] | null; prAppFilesCount: number | null };
  /** What Claude wrote at the end of the run: the reason of a failure is read next to the verdict (decision 084 D). */
  summary: string | null;
  prUrl: string | null;
  projectId: number;
  /** Where « Les critères » is: an anchor on the run page, the run page itself elsewhere. */
  criteriaTo: string;
}) {
  const appFiles = story.prAppFiles ?? [];
  const more = (story.prAppFilesCount ?? 0) - appFiles.length;
  const failed = criteria.filter((k) => k.result === "failed").length;
  const unreported = criteria.filter((k) => k.result === null).length;
  const texts: Record<string, string> = {
    ...REASONS,
    criteria_failed: count(failed, "critère en échec", "critères en échec"),
    criteria_not_reported: count(
      unreported,
      "critère non signalé dans ce run",
      "critères non signalés dans ce run",
    ),
  };
  // Each reason leads to its cause (decision 084 D).
  const links: Record<string, string | null> = {
    ci_failing: prUrl && `${prUrl}/checks`,
    ci_pending: prUrl && `${prUrl}/checks`,
    changes_requested: prUrl,
    ci_missing: `/projets/${projectId}/ci`,
    criteria_failed: criteriaTo,
  };
  const linkOf = (code: string, text: string) => {
    const to = links[code];
    if (!to) return text;
    const className = `underline ${focusRing}`;
    return to.startsWith("/") ? (
      <Link to={to} className={className}>
        {text}
      </Link>
    ) : (
      <a href={to} className={className}>
        {text}
      </a>
    );
  };
  return (
    <section>
      <h2 className={sectionLabel}>Le verdict de Claude</h2>
      <div className={`${card} mt-2 p-[18px]`}>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="text-xl font-semibold">
            {verdict.acceptable ? "Acceptable" : "À vérifier"}
          </h3>
          <span className="text-[13px] text-muted-foreground">
            calculé à partir des critères et de la CI
          </span>
        </div>
        {verdict.reasons.length > 0 && (
          <ul className="mt-2 grid gap-1">
            {verdict.reasons.map((code) => (
              <li key={code}>
                <span aria-hidden="true" className="mr-2 text-muted-foreground">
                  ✕
                </span>
                {linkOf(code, texts[code] ?? code)}
                {code === "app_code_changed" && (
                  <ul className="ml-6 font-mono text-[13px] text-muted-foreground">
                    {appFiles.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                    {more > 0 && (
                      <li>
                        + {more} {more === 1 ? "autre" : "autres"}
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {summary && <p className="mt-2 whitespace-pre-wrap">{summary}</p>}
      </div>
    </section>
  );
}

/** The one main action (decision 039 E): review and merge, or only look once the PR is merged. */
export function RunAction({
  prUrl,
  merged,
}: {
  prUrl: string;
  merged: boolean;
}) {
  return (
    <a href={prUrl} className={merged ? button : primaryButton}>
      {merged ? "Voir la PR sur GitHub" : "Relire et merger sur GitHub"}
    </a>
  );
}
