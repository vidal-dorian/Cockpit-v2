import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { client } from "./api.ts";
import { duration } from "./Night.tsx";
import { Dot } from "./Shell.tsx";
import { plural } from "./tickets.ts";
import { button, card, focusRing } from "./ui.ts";

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

/** The outcome groups of decision 084 E3, in order; the bar of E2 has one part per group, in the colour of its `bar`. */
const GROUPS = [
  {
    name: "PR ouvertes",
    count: (n: number) => plural(n, "PR ouverte", "PR ouvertes"),
    outcomes: ["pr"],
    tone: "done",
    bar: "bg-done",
  },
  {
    name: "En pause : attend ta réponse",
    count: (n: number) => `${n} en pause`,
    outcomes: ["paused"],
    tone: "you",
    bar: "bg-you",
  },
  {
    name: "PR à ouvrir",
    count: (n: number) => `${n} à ouvrir`,
    outcomes: ["pr_to_open"],
    tone: "you",
    bar: "bg-you",
  },
  {
    name: "En échec",
    count: (n: number) => `${n} en échec`,
    outcomes: ["failed", "ci_failed"],
    tone: "none",
    bar: "bg-border-strong",
  },
  {
    name: "Sautées ou non lancées",
    count: (n: number) =>
      `${n} ${n === 1 ? "sautée ou non lancée" : "sautées ou non lancées"}`,
    outcomes: ["skipped", "not_started"],
    tone: "none",
    bar: "bg-raised",
  },
] as const;

/** « 4 h 10 »: the time of day, in the browser's time zone. */
const clock = (iso: string) => {
  const at = new Date(iso);
  return `${at.getHours()} h ${String(at.getMinutes()).padStart(2, "0")}`;
};

/** Decision 084 E: the morning block at the top of /nuit, the night at a glance (boxes, bar, stories by outcome, frise), until « Masquer ». */
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
  const groups = GROUPS.map((g) => ({
    ...g,
    items: night.items.filter(
      (i) => i.outcome && g.outcomes.some((o) => o === i.outcome),
    ),
  })).filter((g) => g.items.length > 0);
  const boxes = [
    ["PR livrées", `${night.delivered}/${night.total}`],
    ["Travail", work === 0 ? "0 min" : duration(work)],
    ["Critères prouvés", String(proven)],
    ["Échecs", failures === 0 ? "aucun" : String(failures)],
  ];
  const title = (g: (typeof groups)[number]) => (
    <span className="inline-flex items-center gap-2 font-semibold">
      {g.bar === "bg-raised" ? (
        <span
          aria-hidden="true"
          className="size-[7px] flex-none rounded-full border border-border-strong bg-raised"
        />
      ) : (
        <Dot tone={g.tone} />
      )}
      {g.name}
      <span className="font-normal text-muted-foreground">
        {g.items.length}
      </span>
    </span>
  );
  const lines = (items: Item[]) => (
    <ul className="grid gap-1.5 pl-4">
      {items.map((item) => (
        <li key={item.storyId} className="flex flex-wrap gap-x-3">
          <Link to={`/us/${item.storyId}`} className="underline">
            US {item.storyId} · {item.iWant}
          </Link>
          {item.startedAt && item.finishedAt && (
            <span className="text-muted-foreground">
              {clock(item.startedAt)} → {clock(item.finishedAt)}
            </span>
          )}
          {item === lastItem && (
            <span className="text-muted-foreground">
              fini à {clock(item.finishedAt ?? "")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <section
      aria-labelledby="cette-nuit"
      className={`mx-[26px] mt-[22px] grid gap-3 px-[18px] py-4 ${card}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cette-nuit" className="font-semibold">
          ☾ Cette nuit, Claude a livré {night.delivered} PR sur {night.total}
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={button}
            disabled={hide.isPending}
            aria-busy={hide.isPending}
            onClick={() => hide.mutate()}
          >
            Masquer
          </button>
        </div>
      </div>
      {questions > 0 && (
        <p>
          {/* The questions are answered in the right panel of the home (decision 085 E). */}
          <Link to="/" className={`font-semibold underline ${focusRing}`}>
            {questions}{" "}
            {questions > 1 ? "questions t'attendent" : "question t'attend"}
          </Link>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {boxes.map(([label, value]) => (
          <div key={label} className="grid rounded-[10px] bg-raised px-3 py-2">
            <b className="text-[22px] leading-tight">{value}</b>
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      {groups.length > 0 && (
        <div
          role="img"
          aria-label={groups.map((g) => g.count(g.items.length)).join(", ")}
          className="flex h-2.5 gap-px overflow-hidden rounded-full"
        >
          {groups.map((g) => (
            <span
              key={g.name}
              className={g.bar}
              style={{ flexGrow: g.items.length }}
            />
          ))}
        </div>
      )}
      <div className="grid gap-3">
        {groups.map((g) => {
          return g === groups.at(-1) && g.bar === "bg-raised" ? (
            <details key={g.name} className="grid gap-1.5">
              <summary className={`cursor-pointer ${focusRing}`}>
                {title(g)}
              </summary>
              <div className="mt-1.5">{lines(g.items)}</div>
            </details>
          ) : (
            <div key={g.name} className="grid gap-1.5">
              {title(g)}
              {lines(g.items)}
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="grid gap-2 max-md:hidden">
        <div className="relative h-4 text-[11px] text-dim">
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
            box && (
              <span key={item.storyId} className="relative h-6">
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
            )
          );
        })}
      </div>
      {hide.isError && (
        <p role="alert" className="text-destructive">
          Impossible de masquer le bloc, réessaie.
        </p>
      )}
    </section>
  );
}
