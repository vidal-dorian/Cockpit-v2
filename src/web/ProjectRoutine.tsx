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
  dangerButton,
  field,
  focusRing,
  primaryButton,
  sectionLabel,
  urgentBadge,
} from "./ui.ts";

const FREQUENCIES = {
  off: { label: "Désactivée", hint: "" },
  on_demand: { label: "À la demande", hint: "seulement avec le bouton" },
  daily: {
    label: "Chaque jour",
    hint: "seulement s'il y a des tickets à traiter",
  },
  weekly: { label: "Chaque semaine", hint: "" },
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

export async function fetchSchedule(id: string) {
  const res = await client.api.projects[":id"].routine.$get({ param: { id } });
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

/** « Écrire les US maintenant » (decision 022 H), with the refusal of the server under it; `onlyConnected` hides it until a routine exists (the Tickets tab, 055 F). */
export function RunNowButton({
  projectId,
  onlyConnected = false,
}: {
  projectId: string;
  onlyConnected?: boolean;
}) {
  const queryClient = useQueryClient();
  const routine = useQuery({ queryKey: ["routine"], queryFn: fetchRoutine });
  const run = useMutation({
    mutationFn: async () => {
      const res = await client.api.projects[":id"].routine.run.$post({
        param: { id: projectId },
      });
      if (!res.ok) throw await failure(res, RUN_REFUSALS);
      return (await res.json()).sessionUrl;
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["routine-schedule", projectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["routine"] }),
      ]),
  });
  if (onlyConnected && !routine.data?.connected) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={
          !routine.data?.connected ||
          routine.data.needsReconnect ||
          run.isPending
        }
        className={button}
      >
        Écrire les US maintenant
      </button>
      {run.data && (
        <a
          href={run.data}
          target="_blank"
          rel="noreferrer noopener"
          className={`ml-3 underline ${focusRing}`}
        >
          Voir la session
        </a>
      )}
      {run.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {run.error.message}
        </p>
      )}
    </>
  );
}

/** Decisions 022 D and H: the frequency of the writing of the stories of the project, the button, the last and the next run. */
export function ProjectRoutine({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
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
    // The right column of the mockup: the clone folder and the archiving (the night belongs to another slice).
    <div className="mx-[26px] mt-5 grid items-start gap-3.5 md:grid-cols-2">
      <section
        aria-labelledby="ecriture-auto"
        className={`px-[18px] py-4 ${card}`}
      >
        <h2 id="ecriture-auto" className={`mb-3 ${sectionLabel}`}>
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
            <div className="grid gap-4">
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
                <fieldset className="grid basis-full gap-2">
                  <legend className="sr-only">Fréquence</legend>
                  {(
                    Object.entries(FREQUENCIES) as [
                      Frequency,
                      (typeof FREQUENCIES)[Frequency],
                    ][]
                  ).map(([value, { label, hint }]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 ${form.frequency === value ? "border-foreground bg-raised" : "border-border bg-card"}`}
                    >
                      <input
                        type="radio"
                        name="frequency"
                        value={value}
                        checked={form.frequency === value}
                        onChange={() => setDraft({ ...form, frequency: value })}
                        aria-labelledby={`frequency-${value}`}
                        aria-describedby={
                          hint ? `frequency-${value}-hint` : undefined
                        }
                        className={`mt-1 accent-foreground ${focusRing}`}
                      />
                      <span>
                        <span
                          id={`frequency-${value}`}
                          className="block text-[13.5px] font-semibold"
                        >
                          {label}
                        </span>
                        {hint && (
                          <span
                            id={`frequency-${value}-hint`}
                            className="block text-[12.5px] text-muted-foreground"
                          >
                            {hint}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
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
                {(form.frequency === "daily" ||
                  form.frequency === "weekly") && (
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
                  <span
                    className={lastRun.result === "ok" ? badge : urgentBadge}
                  >
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
                <RunNowButton projectId={projectId} />
              </div>
            </div>
          )}
          {save.error && (
            <p role="alert" className={`mt-3 ${alertBox}`}>
              {save.error.message}
            </p>
          )}
        </div>
      </section>
      <div className="grid gap-3.5">
        <CloneFolderCard projectId={projectId} />
        <ArchiveCard projectId={projectId} archived={archived} />
      </div>
    </div>
  );
}

/** « Archiver le projet » with its confirmation: there is no unarchive yet (decision 003, rule 4). */
function ArchiveCard({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const archive = useMutation({
    mutationFn: async () => {
      const res = await client.api.projects[":id"].archive.$post({
        param: { id: projectId },
      });
      if (!res.ok) throw await failure(res, {});
    },
    onSettled: () => {
      setConfirming(false);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["repositories"] }),
      ]);
    },
  });
  return (
    <section aria-labelledby="projet" className={`px-[18px] py-4 ${card}`}>
      <h2 id="projet" className={`mb-3 ${sectionLabel}`}>
        Projet
      </h2>
      {archived ? (
        <span className={badge}>Archivé</span>
      ) : confirming ? (
        <>
          <p>Archiver ce projet ? Il n'y a pas encore de désarchivage.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
              className={dangerButton}
            >
              Confirmer l'archivage
            </button>
            <button
              type="button"
              // The Archiver button is gone: keep the keyboard focus on the safe choice.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
              autoFocus
              onClick={() => setConfirming(false)}
              className={button}
            >
              Annuler
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={button}
        >
          Archiver le projet
        </button>
      )}
      <p className="mt-2.5 text-[12.5px] text-muted-foreground">
        Archivé, il disparaît de la barre latérale ; rien n'est supprimé, ni ici
        ni sur GitHub.
      </p>
      {archive.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {archive.error.message}
        </p>
      )}
    </section>
  );
}

// Same key as DevelopWindow.tsx (`storageKey`): the folder is shared with « Développer avec Claude ».
const cloneKey = (projectId: string) => `cockpit.clone.${projectId}`;

/** « Sur ce PC »: the folder of the clone, remembered by this browser (decision 034). */
function CloneFolderCard({ projectId }: { projectId: string }) {
  const [folder, setFolder] = useState(() => {
    try {
      return window.localStorage.getItem(cloneKey(projectId)) ?? "";
    } catch {
      return "";
    }
  });
  return (
    <section aria-labelledby="sur-ce-pc" className={`px-[18px] py-4 ${card}`}>
      <h2 id="sur-ce-pc" className={`mb-3 ${sectionLabel}`}>
        Sur ce PC
      </h2>
      <label className="text-[13px] font-semibold">
        Dossier du clone
        <input
          className={`${field} font-mono`}
          value={folder}
          placeholder="/home/dorian/code/mon-repo"
          onChange={(e) => {
            setFolder(e.target.value);
            try {
              window.localStorage.setItem(cloneKey(projectId), e.target.value);
            } catch {}
          }}
        />
      </label>
      <p className="mt-2.5 text-[12.5px] text-muted-foreground">
        Retenu par ce navigateur, pour lancer Claude Desktop au bon endroit.
      </p>
    </section>
  );
}
