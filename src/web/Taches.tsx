import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { fetchLauncher } from "./LauncherSettings.tsx";
import { fetchProjects } from "./Projects.tsx";
import { fetchRoutine } from "./RoutineSettings.tsx";
import { Panel, StateSentence } from "./Shell.tsx";
import {
  alertBox,
  badge,
  button,
  dangerButton,
  field,
  focusRing,
  listCard,
  panelPrimaryButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

async function fetchRoutines() {
  const res = await client.api.routines.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return (await res.json()).routines;
}
type Routine = Awaited<ReturnType<typeof fetchRoutines>>[number];

const WEEKDAYS = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];
const OUTCOMES = { succeeded: "réussi", failed: "échoué" } as const;
const when = (at: string) =>
  new Date(at).toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const planning = (r: Routine) =>
  r.frequency === "on_demand"
    ? "À la demande"
    : `Chaque ${r.frequency === "weekly" ? WEEKDAYS[(r.weekday ?? 1) - 1] : "jour"} à ${r.hour} h`;

/** Decision 055 F: the page « Tâches programmées », the write-US task and the routines of the user, and the panel of the open one. */
export function Taches() {
  const routines = useQuery({ queryKey: ["routines"], queryFn: fetchRoutines });
  const launcher = useQuery({ queryKey: ["launcher"], queryFn: fetchLauncher });
  const writeUs = useQuery({ queryKey: ["routine"], queryFn: fetchRoutine });
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const [open, setOpen] = useState<number | "new" | null>(null);
  const loaded = routines.data && launcher.data && writeUs.data;
  const list = routines.data ?? [];
  const names = new Map(projects.data?.map((p) => [p.id, p.fullName]));
  const next = list
    .filter((r) => r.nextRunAt && !r.pausedAt)
    .sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""));
  const running = next.length + (writeUs.data?.connected ? 1 : 0);
  const selected = list.find((r) => r.id === open);

  return (
    <main>
      <StateSentence
        title={`${running} ${running > 1 ? "tâches de Claude tournent" : "tâche de Claude tourne"} sans toi`}
        actions={
          launcher.data?.connected && (
            <button
              type="button"
              onClick={() => setOpen("new")}
              className={primaryButton}
            >
              + Nouvelle tâche
            </button>
          )
        }
      />
      <div className="grid gap-6 px-[26px] py-6" aria-live="polite">
        {(routines.isError || launcher.isError) && (
          <p role="alert" className={alertBox}>
            Impossible de lire les tâches. Recharge la page ; si cela continue,
            réessaie plus tard.
          </p>
        )}
        {!loaded && !routines.isError && !launcher.isError && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {loaded && !launcher.data.connected && (
          <p>
            Les routines passent par le lanceur Cockpit :{" "}
            <Link to="/reglages/taches-cloud" className="underline">
              relie-le dans les Réglages
            </Link>
            .
          </p>
        )}
        {loaded && (
          <>
            <section aria-labelledby="tes-taches">
              <h2 id="tes-taches" className={sectionLabel}>
                Tes tâches
              </h2>
              <ul className={`mt-2 ${listCard}`}>
                {writeUs.data?.connected && (
                  <li className="flex min-h-[50px] items-center justify-between gap-3 px-[18px] py-2.5">
                    <span className="font-semibold">Écrire les US</span>
                    <Link to="/reglages/taches-cloud" className="underline">
                      Réglages
                    </Link>
                  </li>
                )}
                {list.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(r.id)}
                      className={`flex min-h-[50px] w-full flex-wrap items-center gap-x-3 px-[18px] py-2.5 text-left hover:bg-raised ${focusRing}`}
                    >
                      <b>{r.name}</b>
                      <span className="text-muted-foreground">
                        {planning(r)} ·{" "}
                        {r.projectIds.map((id) => names.get(id)).join(", ")}
                      </span>
                      {r.pausedAt && <span className={badge}>En pause</span>}
                      <span className="ml-auto text-muted-foreground">
                        {r.lastLaunch
                          ? `${when(r.lastLaunch.at)} · ${r.lastLaunch.outcome ? OUTCOMES[r.lastLaunch.outcome] : "en cours"}`
                          : "Jamais lancée"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="prochains">
              <h2 id="prochains" className={sectionLabel}>
                Prochains lancements
              </h2>
              <ul className="mt-2 grid gap-1.5">
                {next.map((r) => (
                  <li key={r.id}>
                    {when(r.nextRunAt ?? "")} · {r.name}
                  </li>
                ))}
                {next.length === 0 && (
                  <li className="text-muted-foreground">
                    Aucun lancement programmé.
                  </li>
                )}
              </ul>
            </section>
          </>
        )}
      </div>
      {open !== null && (
        <RoutinePanel
          key={open}
          routine={selected}
          projects={(projects.data ?? []).filter((p) =>
            launcher.data?.projectIds.includes(p.id),
          )}
          onClose={() => setOpen(null)}
        />
      )}
    </main>
  );
}

/** The panel of a routine (or of a new one): its fields, then what can be done with it. */
function RoutinePanel({
  routine,
  projects,
  onClose,
}: {
  routine?: Routine;
  projects: { id: number; fullName: string }[];
  onClose: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState(routine?.name ?? "");
  const [instruction, setInstruction] = useState(routine?.instruction ?? "");
  const [agents, setAgents] = useState(routine?.agents.join(", ") ?? "");
  const [frequency, setFrequency] = useState(routine?.frequency ?? "on_demand");
  const [hour, setHour] = useState(routine?.hour ?? 9);
  const [weekday, setWeekday] = useState(routine?.weekday ?? 1);
  const [projectIds, setProjectIds] = useState(routine?.projectIds ?? []);
  const act = useMutation({
    mutationFn: async (
      call: () => Promise<{ ok: boolean; status: number }>,
    ) => {
      const res = await call();
      if (!res.ok)
        throw new Error(
          res.status === 409
            ? "Impossible pour l'instant : un passage est en cours, le lanceur est à reconnecter ou un projet n'est plus coché dans le lanceur."
            : "L'opération a échoué, réessaie.",
        );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["routines"] }),
  });
  const param = { id: String(routine?.id) };
  const common = {
    name,
    instruction,
    agents: agents
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    projectIds,
    timeZone:
      routine?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const json =
    frequency === "on_demand"
      ? { ...common, frequency }
      : frequency === "daily"
        ? { ...common, frequency, hour }
        : { ...common, frequency, hour, weekday };
  const save = () =>
    act.mutate(
      () =>
        routine
          ? client.api.routines[":id"].$put({ param, json })
          : client.api.routines.$post({ json }),
      { onSuccess: onClose },
    );
  const last = routine?.lastLaunch;

  return (
    <Panel
      label="Tâche"
      badge={routine?.pausedAt && <span className={badge}>En pause</span>}
      meta={
        <button type="button" onClick={onClose} className={focusRing}>
          Fermer
        </button>
      }
      footer={
        <button
          type="submit"
          form={ids}
          disabled={act.isPending}
          className={panelPrimaryButton}
        >
          Enregistrer
        </button>
      }
    >
      <form
        id={ids}
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <label htmlFor={`${ids}-name`}>Nom</label>
          <input
            id={`${ids}-name`}
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-instruction`}>Consigne</label>
          <textarea
            id={`${ids}-instruction`}
            required
            rows={5}
            maxLength={10_000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-agents`}>Agents</label>
          <input
            id={`${ids}-agents`}
            aria-describedby={`${ids}-agents-help`}
            value={agents}
            onChange={(e) => setAgents(e.target.value)}
            className={field}
          />
          <p
            id={`${ids}-agents-help`}
            className="text-[12.5px] text-muted-foreground"
          >
            Les noms d'agents de .claude/agents, séparés par des virgules.
          </p>
        </div>
        <div>
          <label htmlFor={`${ids}-when`}>Quand</label>
          <select
            id={`${ids}-when`}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            className={field}
          >
            <option value="on_demand">À la demande</option>
            <option value="daily">Chaque jour</option>
            <option value="weekly">Chaque semaine</option>
          </select>
        </div>
        {frequency === "weekly" && (
          <div>
            <label htmlFor={`${ids}-weekday`}>Jour</label>
            <select
              id={`${ids}-weekday`}
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className={field}
            >
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i + 1}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        )}
        {frequency !== "on_demand" && (
          <div>
            <label htmlFor={`${ids}-hour`}>Heure</label>
            <input
              id={`${ids}-hour`}
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className={field}
            />
          </div>
        )}
        <fieldset>
          <legend>Projets</legend>
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={projectIds.includes(p.id)}
                onChange={(e) =>
                  setProjectIds(
                    e.target.checked
                      ? [...projectIds, p.id]
                      : projectIds.filter((id) => id !== p.id),
                  )
                }
              />
              {p.fullName}
            </label>
          ))}
        </fieldset>
      </form>
      {routine && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Dernier lancement :{" "}
            {last
              ? `${when(last.at)} · ${last.outcome ? OUTCOMES[last.outcome] : "en cours"}`
              : "jamais"}
            {last?.sessionUrl && (
              <>
                {" · "}
                <a
                  href={last.sessionUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  voir la session ↗
                </a>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(() =>
                  client.api.routines[":id"].run.$post({ param }),
                )
              }
              className={button}
            >
              Lancer maintenant
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(() =>
                  routine.pausedAt
                    ? client.api.routines[":id"].resume.$post({ param })
                    : client.api.routines[":id"].pause.$post({ param }),
                )
              }
              className={button}
            >
              {routine.pausedAt ? "Reprendre" : "Mettre en pause"}
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(
                  () => client.api.routines[":id"].$delete({ param }),
                  {
                    onSuccess: onClose,
                  },
                )
              }
              className={dangerButton}
            >
              Supprimer
            </button>
          </div>
        </>
      )}
      {act.error && (
        <p role="alert" className={alertBox}>
          {act.error.message}
        </p>
      )}
    </Panel>
  );
}
