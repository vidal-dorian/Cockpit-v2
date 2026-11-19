import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { client } from "./api.ts";
import { fetchSchedule } from "./ProjectRoutine.tsx";
import { fetchProjects } from "./Projects.tsx";
import { ConnectStep, PromptStep, useTask } from "./TaskCard.tsx";
import {
  alertBox,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** The routine of the user (decision 022 C), read by Réglages and by the project page. */
export async function fetchRoutine() {
  const res = await client.api.me.routine.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

const FREQUENCY_SENTENCES: Record<string, string> = {
  off: "désactivée",
  on_demand: "à la demande",
};

function FrequencyRow({ id, fullName }: { id: number; fullName: string }) {
  const schedule = useQuery({
    queryKey: ["routine-schedule", String(id)],
    queryFn: () => fetchSchedule(String(id)),
  });
  const { frequency, hour } = schedule.data ?? {};
  return (
    <li className="flex flex-wrap gap-x-2">
      <Link to={`/projets/${id}/reglages`} className={`underline ${focusRing}`}>
        {fullName}
      </Link>
      <span className="text-muted-foreground">
        {frequency === "daily" && `chaque jour à ${hour ?? 7} h`}
        {frequency === "weekly" && `chaque semaine à ${hour ?? 7} h`}
        {frequency && FREQUENCY_SENTENCES[frequency]}
      </span>
    </li>
  );
}

/** Decision 085 Q: the frequency stays set project by project, but is listed here with a link to each project's settings. */
function ProjectFrequencies() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const active = projects.data?.filter((p) => !p.archived) ?? [];
  if (active.length === 0) return null;
  return (
    <li className="px-[18px] py-3.5">
      <p className="font-semibold">Fréquence de chaque projet</p>
      <ul className="mt-2 grid gap-1.5">
        {active.map((p) => (
          <FrequencyRow key={p.id} id={p.id} fullName={p.fullName} />
        ))}
      </ul>
    </li>
  );
}

/** Decision 022 A: the user creates the scheduled task of claude.ai once, then pastes its address and its token here. */
export function RoutineSettings() {
  const routine = useQuery({ queryKey: ["routine"], queryFn: fetchRoutine });
  const task = useTask(
    "routine",
    (json) => client.api.me.routine.$put({ json }),
    () => client.api.me.routine.$delete(),
  );
  const data = routine.data;

  return (
    <section aria-labelledby="ecrire-us">
      <h2
        id="ecrire-us"
        ref={task.heading}
        tabIndex={-1}
        className={`${sectionLabel} ${focusRing}`}
      >
        Écrire les US automatiquement
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Cockpit lance lui-même l'écriture des user stories, à la fréquence que
        tu choisis pour chaque projet. Il faut pour cela créer une fois une
        tâche planifiée sur claude.ai.
      </p>
      <div className="mt-4" aria-live="polite">
        {routine.isPending && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
        {routine.isError && (
          <p role="alert" className={alertBox}>
            Impossible de lire la tâche. Recharge la page ; si cela continue,
            réessaie plus tard.
          </p>
        )}
        {data && (
          <ol className={listCard}>
            <li className="px-[18px] py-3.5">
              <p className="font-semibold">1. Créer la tâche sur claude.ai</p>
              <p className="mt-1">
                Choisis le déclencheur « API » seulement (ni planning, ni repo),
                le modèle que tu veux.
              </p>
              <a
                href="https://claude.ai/code/routines"
                target="_blank"
                rel="noreferrer noopener"
                className={`mt-2 ${primaryButton}`}
              >
                Ouvrir les tâches de claude.ai
              </a>
            </li>
            <li className="px-[18px] py-3.5">
              <p className="font-semibold">2. Décocher les connecteurs</p>
              <p className="mt-1">
                claude.ai coche tous tes connecteurs par défaut : décoche-les
                tous sauf Cockpit. La tâche n'a besoin que de lui pour écrire
                les US, et n'a ainsi accès à rien d'autre.
              </p>
            </li>
            <PromptStep n={3} prompt={data.prompt} />
            <ConnectStep
              n={4}
              task={task}
              connected={data.connected}
              needsReconnect={data.needsReconnect}
            />
            {data.connected && <ProjectFrequencies />}
          </ol>
        )}
        {task.error && (
          <p role="alert" className={`mt-3 ${alertBox}`}>
            {task.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
