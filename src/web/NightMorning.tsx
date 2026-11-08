import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./api.ts";
import { OUTCOMES } from "./Night.tsx";
import { button, card } from "./ui.ts";

type Item = {
  storyId: number;
  iWant: string;
  outcome: string | null;
  finishedAt: string | null;
};

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
  night: { id: number; delivered: number; total: number; items: Item[] };
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
      <ol aria-label="Frise de la nuit" className="grid gap-1.5">
        {night.items.map((item) => (
          <li key={item.storyId} className="flex flex-wrap gap-x-3">
            <span>{item.iWant}</span>
            <span className="text-muted-foreground">
              {item.outcome ? (OUTCOMES[item.outcome] ?? item.outcome) : ""}
              {item.finishedAt && ` · fini à ${clock(item.finishedAt)}`}
            </span>
          </li>
        ))}
      </ol>
      {hide.isError && (
        <p role="alert" className="text-destructive">
          Impossible de masquer le bloc, réessaie.
        </p>
      )}
    </section>
  );
}
