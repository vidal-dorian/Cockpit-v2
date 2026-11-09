import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./api.ts";
import { duration, OUTCOMES } from "./Night.tsx";
import { plural } from "./tickets.ts";
import { button, card } from "./ui.ts";

type Item = {
  storyId: number;
  iWant: string;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

const BOXES: Record<string, string> = {
  pr: "✓ bg-raised border border-border-strong",
  paused: "✦ bg-you-ground border border-you-line text-you-text",
};
const HOUR = 3_600_000;

/** « 4 h 10 »: the time of day, in the browser's time zone. */
const clock = (iso: string) => {
  const at = new Date(iso);
  return `${at.getHours()} h ${String(at.getMinutes()).padStart(2, "0")}`;
};

/** Decision 044 J: the morning block of the home, the night told in a sentence and a frise, until « Masquer ». */
export function NightMorning({
  night,
  questions,
}: {
  night: {
    id: number;
    startsAt: string;
    endsAt: string;
    delivered: number;
    total: number;
    workSeconds: number;
    criteriaProven: number;
    failures: number;
    items: Item[];
  };
  questions: number;
}) {
  const queryClient = useQueryClient();
  const hide = useMutation({
    mutationFn: async () => {
      const res = await client.api.nights[":id"].hide.$post({
        param: { id: String(night.id) },
      });
      if (!res.ok) throw new Error("Refusé");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  // The axis runs to the end of the last run when it finished after the night (decision 070 F).
  const from = new Date(night.startsAt).getTime();
  const finished = night.items.flatMap((i) =>
    i.finishedAt ? [new Date(i.finishedAt).getTime()] : [],
  );
  const to = Math.max(new Date(night.endsAt).getTime(), ...finished);
  const place = (at: number) => ((at - from) / (to - from)) * 100;
  const ticks: number[] = [];
  const hourStart = new Date(from);
  hourStart.setMinutes(0, 0, 0);
  for (let t = hourStart.getTime(); t <= to; t += HOUR)
    if (t >= from) ticks.push(t);
  const lastEnd = Math.max(...finished);
  const lastItem = night.items.find(
    (i) => i.finishedAt && new Date(i.finishedAt).getTime() === lastEnd,
  );
  const { workSeconds: work, criteriaProven: proven, failures } = night;
  return (
    <section
      aria-labelledby="cette-nuit"
      className={`mx-[26px] mt-[22px] grid gap-3 px-[18px] py-4 ${card}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cette-nuit" className="font-semibold">
          ☾ Cette nuit, Claude a livré {night.delivered} PR sur {night.total}
        </h2>
        <button
          type="button"
          className={button}
          disabled={hide.isPending}
          onClick={() => hide.mutate()}
        >
          Masquer
        </button>
      </div>
      {questions > 0 && (
        <p>
          {questions}{" "}
          {questions > 1 ? "questions t'attendent" : "question t'attend"}
        </p>
      )}
      <p>
        La nuit · {work === 0 ? "0 min" : duration(work)} de travail · {proven}{" "}
        {plural(proven, "critère prouvé", "critères prouvés")} ·{" "}
        {failures === 0
          ? "aucun échec"
          : `${failures} ${plural(failures, "échec", "échecs")}`}
      </p>
      <div aria-hidden="true" className="relative h-4 text-[11px] text-dim">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${place(t)}%` }}
          >
            {new Date(t).getHours()} h
          </span>
        ))}
      </div>
      <ol aria-label="Frise de la nuit" className="grid gap-2">
        {night.items.map((item) => {
          const box =
            item.startedAt || item.outcome === "paused"
              ? (BOXES[item.outcome ?? ""] ??
                "✕ bg-raised border border-border-strong text-muted-foreground")
              : null;
          const start = item.startedAt
            ? new Date(item.startedAt).getTime()
            : from;
          const end = item.finishedAt
            ? new Date(item.finishedAt).getTime()
            : start;
          return (
            <li key={item.storyId} className="grid gap-1">
              <span className="flex flex-wrap gap-x-3">
                <span>
                  <span className="sr-only">US {item.storyId} · </span>
                  {item.iWant}
                </span>
                <span className="text-muted-foreground">
                  {item.outcome ? (OUTCOMES[item.outcome] ?? item.outcome) : ""}
                  {item.startedAt &&
                    item.finishedAt &&
                    ` · ${clock(item.startedAt)} → ${clock(item.finishedAt)}`}
                  {item === lastItem &&
                    ` · fini à ${clock(item.finishedAt ?? "")}`}
                </span>
              </span>
              {box && (
                <span aria-hidden="true" className="relative h-6">
                  <span
                    className={`absolute min-w-max rounded-md px-2 text-[12px] font-semibold ${box.slice(2)}`}
                    style={{
                      left: `${place(start)}%`,
                      width: `${((end - start) / (to - from)) * 100}%`,
                    }}
                  >
                    {box.slice(0, 1)} US {item.storyId}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {hide.isError && (
        <p role="alert" className="text-destructive">
          Impossible de masquer le bloc, réessaie.
        </p>
      )}
    </section>
  );
}
