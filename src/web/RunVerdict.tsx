import { primaryButton } from "./ui.ts";

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
  prUrl,
}: {
  verdict: { acceptable: boolean; reasons: string[] };
  criteria: { result: string | null }[];
  prUrl: string | null;
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
      <p className="font-heading text-xl font-bold">
        {verdict.acceptable ? "Acceptable" : "À vérifier"}
      </p>
      <ul className="mt-2 list-disc pl-5">
        {verdict.reasons.map((code) => (
          <li key={code}>{texts[code] ?? code}</li>
        ))}
      </ul>
      {prUrl && (
        <a href={prUrl} className={`mt-3 inline-block ${primaryButton}`}>
          Relire et merger sur GitHub
        </a>
      )}
    </section>
  );
}
