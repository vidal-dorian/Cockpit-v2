import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { fetchLauncher, fetchNightHours } from "./LauncherSettings.tsx";
import { NightMorning } from "./NightMorning.tsx";
import { refusedError } from "./roles.ts";
import { Dot, fetchNight, repoName, StateSentence, useHome } from "./Shell.tsx";
import { toast } from "./toast.tsx";
import {
  alertBox,
  button,
  focusRing,
  iconButton,
  listCard,
  moved,
  primaryButton,
  row,
  sectionLabel,
} from "./ui.ts";

const REFUSED = "Cette action a été refusée : recharge la page.";

/** What the night did with a story (decision 044 I). */
export const OUTCOMES: Record<string, string> = {
  pr: "PR ouverte",
  paused: "En pause : attend ta réponse",
  ci_failed: "CI en échec",
  failed: "Échouée",
  skipped: "Sautée : plus prête",
  not_started: "Non lancée",
};

/** The next instant, in the browser's time zone, when the clock reads `hour` o'clock. */
const nextHour = (hour: number) => {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return at.getTime() <= Date.now() ? at.getTime() + 86_400_000 : at.getTime();
};

const RULES = [
  "Une US à la fois : Claude lance la suivante dès que la précédente est finie.",
  "Rien de nouveau ne part après l'heure de fin ; un run déjà parti va jusqu'au bout.",
  "Une question met l'US en pause : tu réponds le matin, Claude la reprend.",
  "Une CI en échec est relancée une seule fois.",
  "Un run muet pendant 60 minutes est fermé.",
];

/** « 1 h 30 », « 25 min »: the estimate of a story. */
export const duration = (seconds: number | null) => {
  if (seconds === null) return "durée inconnue";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60}` : ""}`;
};

/** Decision 044 C, K, M': « ☾ Cette nuit », the evening (the programme), then the night as it runs. */
export function Night() {
  const queryClient = useQueryClient();
  const night = useQuery({ queryKey: ["home", "night"], queryFn: fetchNight });
  const launcher = useQuery({ queryKey: ["launcher"], queryFn: fetchLauncher });
  const hours = useQuery({
    queryKey: ["night-hours"],
    queryFn: fetchNightHours,
  });
  const home = useHome().data;
  const morning = home?.night;
  const questions = (home?.forYou ?? []).filter(
    (item) => item.kind === "answer",
  ).length;
  // The order the user gave; until they touch it, the ready stories as the server gave them.
  const [order, setOrder] = useState<number[]>();
  const act = useMutation({
    mutationFn: async (call: () => Promise<Response>) => {
      const res = await call();
      if (!res.ok) throw await refusedError(res, REFUSED);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const validate = useMutation({
    meta: { done: "User story validée." },
    mutationFn: async (id: number) => {
      const res = await client.api.stories[":id"].validate.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw await refusedError(res, REFUSED);
      return id;
    },
    onSuccess: (id) => setOrder([...program, id]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const data = night.data;
  const stories = [...(data?.ready ?? []), ...(data?.toValidate ?? [])];
  const open = data?.night ?? null;
  // The order typed in the evening gives way to the server's once the night is posted.
  const program = open
    ? open.items.map((s) => s.storyId)
    : (order ?? (data?.ready ?? []).map((s) => s.storyId));
  const inProgram = program.flatMap((id) => {
    const story = stories.find((s) => s.storyId === id);
    return story ? [story] : [];
  });
  const maybe = (data?.toValidate ?? []).filter(
    (s) => !program.includes(s.storyId),
  );
  // Before the start the programme is the server's: each change is saved at once.
  const reorder = (next: number[]) =>
    open
      ? act.mutate(() =>
          client.api.nights.current.$put({ json: { storyIds: next } }),
        )
      : setOrder(next);
  const move = (at: number, by: number) => reorder(moved(program, at, by));
  const shown = open
    ? open.items
    : inProgram.map((s) => ({ ...s, outcome: null }));
  const known = shown.flatMap((s) =>
    s.estimatedSeconds === null ? [] : [s.estimatedSeconds],
  );
  const reason = !launcher.data?.connected
    ? "Connecte le lanceur dans les Réglages."
    : inProgram.length === 0
      ? "Aucune user story à lancer."
      : null;
  const count = shown.length;
  const planned = open?.status === "planned";
  const running = open?.status === "running";
  const finished = shown.filter((s) => s.outcome).length;
  // One story at a time (044): the first without outcome is the one running.
  const current = running ? shown.find((s) => !s.outcome) : undefined;
  // The end: the start (the night's, or the next start hour) and the total, when every story has an estimate.
  const total = known.reduce((a, b) => a + b, 0);
  const start = open
    ? Math.max(Date.parse(open.startsAt), Date.now())
    : hours.data && nextHour(hours.data.startHour);
  const probableEnd =
    start && known.length === count && count > 0
      ? new Date(start + total * 1000)
      : null;

  return (
    <main>
      <StateSentence
        title={
          open?.status === "running"
            ? "Claude développe pendant que tu dors."
            : `Claude peut développer ${count} user ${count > 1 ? "stories" : "story"} pendant que tu dors.`
        }
        rest={
          known.length > 0
            ? `Durée estimée : ${duration(total)}${known.length < count ? " et plus" : ""}${probableEnd ? `, fin vers ${probableEnd.getHours()} h ${String(probableEnd.getMinutes()).padStart(2, "0")}` : ""}.`
            : undefined
        }
      />
      {data && (
        <div className="flex flex-wrap items-center gap-3 px-[26px] pt-6">
          {!open && (
            <>
              <button
                type="button"
                className={primaryButton}
                disabled={reason !== null || act.isPending}
                aria-busy={act.isPending}
                onClick={() =>
                  act.mutate(
                    () =>
                      client.api.nights.$post({
                        json: { storyIds: program },
                      }),
                    {
                      onSuccess: () => toast("Nuit programmée."),
                    },
                  )
                }
              >
                ☾ Lancer la nuit · {count}{" "}
                {count > 1 ? "user stories" : "user story"}
              </button>
              {reason && (
                <span className="text-muted-foreground">
                  {reason}
                  {!launcher.data?.connected && (
                    <>
                      {" "}
                      <Link
                        to="/reglages/taches-cloud"
                        className="font-semibold underline"
                      >
                        Réglages
                      </Link>
                    </>
                  )}
                </span>
              )}
            </>
          )}
          {open?.status === "planned" && (
            <button
              type="button"
              className={button}
              onClick={() =>
                act.mutate(() => client.api.nights.current.cancel.$post(), {
                  onSuccess: () => toast("Nuit annulée."),
                })
              }
            >
              Annuler la nuit
            </button>
          )}
          {open?.status === "running" && (
            <button
              type="button"
              className={button}
              onClick={() =>
                act.mutate(() => client.api.nights.current.stop.$post(), {
                  onSuccess: () => toast("Arrêt de la nuit demandé."),
                })
              }
            >
              Arrêter la nuit
            </button>
          )}
        </div>
      )}
      {morning && <NightMorning night={morning} questions={questions} />}
      <div className="grid gap-6 px-[26px] py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {(night.isError || launcher.isError) && (
          <p role="alert" className={`lg:col-span-2 ${alertBox}`}>
            Impossible de lire la page. Recharge-la ; si cela continue, réessaie
            plus tard.
          </p>
        )}
        {(act.isError || validate.isError) && (
          <p role="alert" className={`lg:col-span-2 ${alertBox}`}>
            {(act.error ?? validate.error)?.message}
          </p>
        )}
        {data && (
          <>
            <div className="grid content-start gap-6">
              <section aria-labelledby="programme">
                <h2 id="programme" className={sectionLabel}>
                  Au programme
                </h2>
                {running && (
                  <div className="mt-2 grid gap-1.5">
                    <p>
                      {finished} sur {count} finies
                    </p>
                    <div
                      role="progressbar"
                      aria-label="Avancement de la nuit"
                      aria-valuenow={finished}
                      aria-valuemin={0}
                      aria-valuemax={count}
                      className="h-2 overflow-hidden rounded-full bg-raised"
                    >
                      <div
                        className="h-full bg-claude"
                        style={{ width: `${(finished / count) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                <ul className={`mt-2 ${listCard}`}>
                  {shown.map((s, at) => (
                    <li key={s.storyId} className={row}>
                      <span className="grid size-6 flex-none place-items-center rounded-full bg-raised text-[12px] font-semibold">
                        {at + 1}
                      </span>
                      <span className="grid min-w-0 flex-[1_1_10rem]">
                        <b id={`night-${s.storyId}`}>{s.iWant}</b>
                        <span className="text-muted-foreground">
                          {repoName(s.project.name)} ·{" "}
                          {duration(s.estimatedSeconds)}
                        </span>
                      </span>
                      {open && !planned ? (
                        <span className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
                          <Dot
                            tone={
                              s.outcome
                                ? s.outcome === "pr"
                                  ? "done"
                                  : s.outcome === "paused"
                                    ? "you"
                                    : "none"
                                : s === current
                                  ? "claude"
                                  : "none"
                            }
                            live={s === current}
                          />
                          {s.outcome
                            ? (OUTCOMES[s.outcome] ?? s.outcome)
                            : s === current
                              ? "En cours"
                              : "À venir"}
                        </span>
                      ) : (
                        <span className="ml-auto flex gap-1.5">
                          <button
                            type="button"
                            aria-label="Monter"
                            aria-describedby={`night-${s.storyId}`}
                            disabled={at === 0}
                            className={`${iconButton} max-md:size-11`}
                            onClick={() => move(at, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="Descendre"
                            aria-describedby={`night-${s.storyId}`}
                            disabled={at === shown.length - 1}
                            className={`${iconButton} max-md:size-11`}
                            onClick={() => move(at, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label="Retirer"
                            aria-describedby={`night-${s.storyId}`}
                            className={`${iconButton} max-md:size-11`}
                            onClick={() =>
                              reorder(program.filter((id) => id !== s.storyId))
                            }
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                  {count === 0 && (
                    <li className={`${row} text-muted-foreground`}>
                      Aucune user story prête dans les projets du lanceur.
                    </li>
                  )}
                </ul>
              </section>
              {!open && (
                <section aria-labelledby="peut-etre">
                  <h2 id="peut-etre" className={sectionLabel}>
                    Pourrait s'ajouter
                  </h2>
                  <ul className={`mt-2 ${listCard}`}>
                    {maybe.map((s) => (
                      <li key={s.storyId} className={row}>
                        <b>{s.iWant}</b>
                        <span className="text-muted-foreground">
                          {s.project.name}
                        </span>
                        <button
                          type="button"
                          className={`ml-auto ${button}`}
                          disabled={validate.isPending}
                          aria-busy={validate.isPending}
                          onClick={() => validate.mutate(s.storyId)}
                        >
                          Valider et ajouter
                        </button>
                      </li>
                    ))}
                    {maybe.length === 0 && (
                      <li className={`${row} text-muted-foreground`}>
                        Aucune US à valider.
                      </li>
                    )}
                  </ul>
                </section>
              )}
            </div>
            <details>
              <summary className={`cursor-pointer ${focusRing}`}>
                <h2 className={`inline ${sectionLabel}`}>
                  Les règles de la nuit
                </h2>
              </summary>
              <ul className={`mt-2 grid gap-2 ${listCard} px-[18px] py-3.5`}>
                {RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </details>
          </>
        )}
        {night.isPending && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
      </div>
    </main>
  );
}
