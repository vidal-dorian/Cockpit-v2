import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { fetchLauncher } from "./LauncherSettings.tsx";
import { fetchNight, StateSentence } from "./Shell.tsx";
import {
  alertBox,
  button,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const row = "flex min-h-[50px] flex-wrap items-center gap-x-3 px-[18px] py-2.5";
const iconButton = `grid size-[30px] place-items-center rounded-[10px] border border-border-strong bg-raised text-muted-foreground hover:bg-raised-hover disabled:opacity-40 ${focusRing}`;

/** What the night did with a story (decision 044 I). */
export const OUTCOMES: Record<string, string> = {
  pr: "PR ouverte",
  paused: "En pause : attend ta réponse",
  ci_failed: "CI en échec",
  failed: "Échouée",
  skipped: "Sautée : plus prête",
  not_started: "Non lancée",
};

const RULES = [
  "Une US à la fois : Claude lance la suivante dès que la précédente est finie.",
  "Rien de nouveau ne part après l'heure de fin ; un run déjà parti va jusqu'au bout.",
  "Une question met l'US en pause : tu réponds le matin, Claude la reprend.",
  "Une CI en échec est relancée une seule fois.",
  "Un run muet pendant 60 minutes est fermé.",
];

/** « 1 h 30 », « 25 min »: the estimate of a story. */
const duration = (seconds: number | null) => {
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
  // The order the user gave; until they touch it, the ready stories as the server gave them.
  const [order, setOrder] = useState<number[]>();
  const act = useMutation({
    mutationFn: async (call: () => Promise<Response>) => {
      if (!(await call()).ok) throw new Error("Refusé");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const validate = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.stories[":id"].validate.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw new Error("Refusé");
      return id;
    },
    onSuccess: (id) => setOrder([...program, id]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const data = night.data;
  const stories = [...(data?.ready ?? []), ...(data?.toValidate ?? [])];
  const program = order ?? (data?.ready ?? []).map((s) => s.storyId);
  const inProgram = program.flatMap((id) => {
    const story = stories.find((s) => s.storyId === id);
    return story ? [story] : [];
  });
  const maybe = (data?.toValidate ?? []).filter(
    (s) => !program.includes(s.storyId),
  );
  const move = (at: number, by: number) => {
    const next = [...program];
    next.splice(at + by, 0, ...next.splice(at, 1));
    setOrder(next);
  };
  const open = data?.night ?? null;
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
            ? `Durée estimée : ${duration(known.reduce((a, b) => a + b, 0))}${known.length < count ? " et plus" : ""}.`
            : undefined
        }
      />
      <div className="grid gap-6 px-[26px] py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {(night.isError || launcher.isError) && (
          <p role="alert" className={`lg:col-span-2 ${alertBox}`}>
            Impossible de lire la page. Recharge-la ; si cela continue, réessaie
            plus tard.
          </p>
        )}
        {(act.isError || validate.isError) && (
          <p role="alert" className={`lg:col-span-2 ${alertBox}`}>
            Cette action a été refusée : recharge la page.
          </p>
        )}
        {data && (
          <>
            <div className="grid content-start gap-6">
              <section aria-labelledby="programme">
                <h2 id="programme" className={sectionLabel}>
                  Au programme
                </h2>
                <ul className={`mt-2 ${listCard}`}>
                  {shown.map((s, at) => (
                    <li key={s.storyId} className={row}>
                      <b id={`night-${s.storyId}`}>{s.iWant}</b>
                      <span className="text-muted-foreground">
                        {s.project.name} · {duration(s.estimatedSeconds)}
                      </span>
                      {open ? (
                        <span className="ml-auto text-muted-foreground">
                          {s.outcome
                            ? (OUTCOMES[s.outcome] ?? s.outcome)
                            : "À venir"}
                        </span>
                      ) : (
                        <span className="ml-auto flex gap-1.5">
                          <button
                            type="button"
                            aria-label="Monter"
                            aria-describedby={`night-${s.storyId}`}
                            disabled={at === 0}
                            className={iconButton}
                            onClick={() => move(at, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="Descendre"
                            aria-describedby={`night-${s.storyId}`}
                            disabled={at === shown.length - 1}
                            className={iconButton}
                            onClick={() => move(at, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label="Retirer"
                            aria-describedby={`night-${s.storyId}`}
                            className={iconButton}
                            onClick={() =>
                              setOrder(program.filter((id) => id !== s.storyId))
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
              <div className="flex flex-wrap items-center gap-3">
                {!open && (
                  <>
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={reason !== null || act.isPending}
                      onClick={() =>
                        act.mutate(() =>
                          client.api.nights.$post({
                            json: { storyIds: program },
                          }),
                        )
                      }
                    >
                      ☾ Lancer la nuit · {count}{" "}
                      {count > 1 ? "user stories" : "user story"}
                    </button>
                    {reason && (
                      <span className="text-muted-foreground">{reason}</span>
                    )}
                  </>
                )}
                {open?.status === "planned" && (
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      act.mutate(() => client.api.nights.current.cancel.$post())
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
                      act.mutate(() => client.api.nights.current.stop.$post())
                    }
                  >
                    Arrêter la nuit
                  </button>
                )}
              </div>
            </div>
            <section aria-labelledby="regles">
              <h2 id="regles" className={sectionLabel}>
                Les règles de la nuit
              </h2>
              <ul className={`mt-2 grid gap-2 ${listCard} px-[18px] py-3.5`}>
                {RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </section>
          </>
        )}
        {night.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
      </div>
    </main>
  );
}
