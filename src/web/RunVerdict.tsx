import { button, primaryButton } from "./ui.ts";

const REASONS: Record<string, string> = {
  run_not_succeeded: "Le run n'a pas réussi",
  no_pull_request: "Aucune PR liée",
  ci_failing: "La CI échoue",
  ci_pending: "La CI tourne encore",
  ci_missing: "Aucune CI sur la PR",
  changes_requested: "Des modifications sont demandées sur la PR",
};

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The decision aid of a finished run (decision 039 E): the verdict in words, its reasons, the one main action. */
export function RunVerdict({
  verdict,
  criteria,
}: {
  verdict: { acceptable: boolean; reasons: string[] };
  criteria: { result: string | null }[];
}) {
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
  return (
    <section className="mt-6">
      <h2 className="font-heading text-xl font-bold">
        {verdict.acceptable ? "Acceptable" : "À vérifier"}
      </h2>
      {verdict.reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {verdict.reasons.map((code) => (
            <li key={code}>{texts[code] ?? code}</li>
          ))}
        </ul>
      )}
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
    <a
      href={prUrl}
      className={`mt-6 inline-block ${merged ? button : primaryButton}`}
    >
      {merged ? "Voir la PR sur GitHub" : "Relire et merger sur GitHub"}
    </a>
  );
}
