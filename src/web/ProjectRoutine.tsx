import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { fetchRoutine } from "./RoutineSettings.tsx";
import {
  alertBox,
  badge,
  button,
  card,
  field,
  focusRing,
  primaryButton,
  sectionLabel,
  urgentBadge,
} from "./ui.ts";

const FREQUENCIES = {
  off: "Désactivée",
  on_demand: "À la demande",
  daily: "Chaque jour",
  weekly: "Chaque semaine",
};
type Frequency = keyof typeof FREQUENCIES;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

// The server's refusals, in French; its codes are not meant to be read.
const RUN_REFUSALS: Record<string, string> = {
  routine_not_connected:
    "Aucune tâche n'est connectée : connecte-la dans Réglages.",
  routine_needs_reconnect:
    "La tâche est à reconnecter : colle un nouveau jeton dans Réglages.",
  project_archived: "Ce projet est archivé : plus rien ne s'y écrit.",
  fire_failed: "Claude n'a pas pu être lancé, réessaie dans un instant.",
};

async function failure(res: Response, refusals: Record<string, string>) {
  const body: { error?: string } | null = await res.json().catch(() => null);
  return new Error(
    (body?.error && refusals[body.error]) || "L'opération a échoué, réessaie.",
  );
}

async function fetchSchedule(id: string) {
  const res = await client.api.projects[":id"].routine.$get({ param: { id } });
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

/** Decisions 022 D and H: the frequency of the writing of the stories of the project, the button, the last and the next run. */
export function ProjectRoutine({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const schedule = useQuery({
    queryKey: ["routine-schedule", projectId],
    queryFn: () => fetchSchedule(projectId),
  });
  const routine = useQuery({ queryKey: ["routine"], queryFn: fetchRoutine });
  // What the user chose and did not save yet; nothing means what the server holds.
  const [draft, setDraft] = useState<{
    frequency: Frequency;
    hour: number;
    weekday: number;
  }>();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["routine-schedule", projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["routine"] }),
    ]);
  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      // The hour is the one of the browser's time zone (decision 022 D).
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const param = { id: projectId };
      const json =
        form.frequency === "daily"
          ? { frequency: form.frequency, hour: form.hour, timeZone }
          : form.frequency === "weekly"
            ? {
                frequency: form.frequency,
                weekday: form.weekday,
                hour: form.hour,
                timeZone,
              }
            : { frequency: form.frequency, timeZone };
      const res = await client.api.projects[":id"].routine.$put({
        param,
        json,
      });
      if (!res.ok)
        throw await failure(res, {
          project_archived:
            "Ce projet est archivé : son planning ne change plus.",
        });
      setDraft(undefined);
    },
    onSettled: refresh,
  });
  const run = useMutation({
    mutationFn: async () => {
      const res = await client.api.projects[":id"].routine.run.$post({
        param: { id: projectId },
      });
      if (!res.ok) throw await failure(res, RUN_REFUSALS);
    },
    onSettled: refresh,
  });

  const saved = schedule.data;
  const form =
    draft ??
    (saved && {
      frequency: saved.frequency,
      hour: saved.hour ?? 7,
      weekday: saved.weekday ?? 1,
    });
  const canRun = routine.data?.connected && !routine.data.needsReconnect;
  const lastRun = saved?.lastRun;

  return (
    <section className="mx-[26px] mt-6" aria-labelledby="ecriture-auto">
      <h2 id="ecriture-auto" className={`mb-2 ${sectionLabel}`}>
        Écriture automatique des US
      </h2>
      <div aria-live="polite">
        {(schedule.isPending || routine.isPending) && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {(schedule.isError || routine.isError) && (
          <p role="alert" className={alertBox}>
            Impossible de lire l'écriture automatique. Recharge la page ; si
            cela continue, réessaie plus tard.
          </p>
        )}
        {saved && form && routine.data && (
          <div className={`grid gap-4 p-4 ${card}`}>
            {!canRun && (
              <p className="text-muted-foreground">
                {routine.data.needsReconnect
                  ? "La tâche de claude.ai est à reconnecter : colle un nouveau jeton dans "
                  : "Aucune tâche n'est connectée : connecte-la dans "}
                <Link
                  to="/reglages/ecriture-us"
                  className={`underline ${focusRing}`}
                >
                  Réglages
                </Link>
                .
              </p>
            )}
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <label>
                Fréquence
                <select
                  value={form.frequency}
                  onChange={(e) =>
                    setDraft({
                      ...form,
                      frequency: e.target.value as Frequency,
                    })
                  }
                  className={field}
                >
                  {Object.entries(FREQUENCIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {form.frequency === "weekly" && (
                <label>
                  Jour
                  <select
                    value={form.weekday}
                    onChange={(e) =>
                      setDraft({ ...form, weekday: Number(e.target.value) })
                    }
                    className={field}
                  >
                    {WEEKDAYS.map((label, i) => (
                      <option key={label} value={i + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(form.frequency === "daily" || form.frequency === "weekly") && (
                <label>
                  Heure
                  <select
                    value={form.hour}
                    onChange={(e) =>
                      setDraft({ ...form, hour: Number(e.target.value) })
                    }
                    className={field}
                  >
                    {HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {hour} h
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="submit"
                disabled={save.isPending}
                className={primaryButton}
              >
                Enregistrer
              </button>
            </form>
            <p className="text-muted-foreground">
              L'heure est celle du fuseau de ton navigateur. Au planning, rien
              n'est lancé s'il n'y a aucune US à écrire.
            </p>
            {saved.nextRunAt && (
              <p>
                <span className="font-semibold">Prochain passage</span> :{" "}
                {when(saved.nextRunAt)}
              </p>
            )}
            {lastRun && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <span className="font-semibold">Dernier lancement</span> :{" "}
                  {when(lastRun.at)}
                </span>
                {/* The word comes with the color (decision 003). */}
                <span className={lastRun.result === "ok" ? badge : urgentBadge}>
                  {lastRun.result === "ok" ? "Réussi" : "Échec"}
                </span>
                {lastRun.sessionUrl && (
                  <a
                    href={lastRun.sessionUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`underline ${focusRing}`}
                  >
                    Voir la session
                  </a>
                )}
              </p>
            )}
            <div>
              <button
                type="button"
                onClick={() => run.mutate()}
                disabled={!canRun || run.isPending}
                className={button}
              >
                Écrire les US maintenant
              </button>
            </div>
          </div>
        )}
        {(save.error ?? run.error) && (
          <p role="alert" className={`mt-3 ${alertBox}`}>
            {(save.error ?? run.error)?.message}
          </p>
        )}
      </div>
    </section>
  );
}
