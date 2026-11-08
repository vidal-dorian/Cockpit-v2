import { useState } from "react";
import { ACTIONS, type Entry, RESULTS } from "./Journal.tsx";
import {
  exportLink,
  JournalList,
  PeriodMenu,
  sinceOf,
} from "./JournalView.tsx";
import { chipLink, focusRing } from "./ui.ts";

const CHIPS: { label: string; filter: Record<string, string> }[] = [
  { label: "Tout", filter: {} },
  { label: "Toi", filter: { actor: "human" } },
  { label: "Claude", filter: { actor: "claude" } },
  { label: "GitHub", filter: { actor: "github" } },
  { label: "Refus et erreurs", filter: { result: "refused,error" } },
];

const AUTHORS: Record<string, string> = {
  human: "toi",
  claude: "Claude",
  github: "GitHub",
  system: "Cockpit",
};

/** The row as a sentence in French (decision 053 I): a step of a run is told, any other action by its label. */
function sentence(entry: Entry) {
  const args = "args" in entry ? entry.args : undefined;
  const who = entry.actor === "human" ? "Tu" : AUTHORS[entry.actor];
  const has = entry.actor === "human" ? "as" : "a";
  if (entry.action === "report_step" && typeof args?.agent === "string")
    return `${who} ${has} ${args.event === "finished" ? "fini" : "lancé"} l'étape ${args.agent}`;
  return ACTIONS[entry.action] ?? entry.action;
}

/** The Historique tab of a project (S16, decision 053 I): the journal filtered on the project, one chip at a time. */
export function ProjectHistory({ projectId }: { projectId: string }) {
  const [chip, setChip] = useState(CHIPS[0]);
  const [period, setPeriod] = useState("");
  const since = sinceOf(period);
  const filters = {
    project: projectId,
    ...chip?.filter,
    ...(since && { since }),
  };
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2 px-[26px]">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={c === chip}
            onClick={() => setChip(c)}
            className={chipLink({ isActive: c === chip })}
          >
            {c.label}
          </button>
        ))}
        <PeriodMenu slug={period} onChoose={setPeriod} />
        <span className="ml-auto">{exportLink(filters)}</span>
      </div>
      <JournalList
        filters={filters}
        row={(entry, open) => {
          const result = RESULTS[entry.result];
          const at = new Date(entry.at);
          return (
            <li>
              <button
                type="button"
                onClick={open}
                className={`grid min-h-[50px] w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 px-[18px] py-2 text-left hover:bg-raised ${focusRing}`}
              >
                <span className="truncate font-semibold">
                  {sentence(entry)}
                </span>
                {entry.result !== "ok" && result ? (
                  <span className={result.style}>{result.label}</span>
                ) : (
                  <span />
                )}
                <time
                  dateTime={entry.at}
                  className="text-[12.5px] text-muted-foreground tabular-nums"
                >
                  {at.toLocaleTimeString("fr-FR", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <span className="min-w-14 text-right text-[12.5px] text-muted-foreground">
                  {AUTHORS[entry.actor] ?? entry.actor}
                </span>
              </button>
            </li>
          );
        }}
      />
    </>
  );
}
