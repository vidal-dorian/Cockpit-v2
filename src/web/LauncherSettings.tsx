import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "./api.ts";
import { fetchProjects } from "./Projects.tsx";
import { ConnectStep, failure, PromptStep, useTask } from "./TaskCard.tsx";
import {
  alertBox,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** The launcher of the user (decision 053 C), read by Réglages and by the « Développer avec Claude » panel. */
export async function fetchLauncher() {
  const res = await client.api.me.launcher.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

/** Decision 053 A and D: the user creates the « Lanceur Cockpit » task once, pastes its address and token, and ticks the projects whose repo they added to it. */
export function LauncherSettings() {
  const launcher = useQuery({ queryKey: ["launcher"], queryFn: fetchLauncher });
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const queryClient = useQueryClient();
  const task = useTask(
    "launcher",
    (json) => client.api.me.launcher.$put({ json }),
    () => client.api.me.launcher.$delete(),
  );
  const tick = useMutation({
    mutationFn: async (v: { id: number; inLauncher: boolean }) => {
      const res = await client.api.projects[":id"].launcher.$put({
        param: { id: String(v.id) },
        json: { inLauncher: v.inLauncher },
      });
      if (!res.ok) throw failure(res);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["launcher"] }),
  });
  const data = launcher.data;
  const error = task.error ?? tick.error;

  return (
    <section aria-labelledby="lanceur">
      <h2
        id="lanceur"
        ref={task.heading}
        tabIndex={-1}
        className={`${sectionLabel} ${focusRing}`}
      >
        Lanceur Cockpit
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Cockpit lance dans le cloud le développement d'une US, sans que ton PC
        soit allumé. Il faut pour cela créer une fois une tâche planifiée sur
        claude.ai.
      </p>
      <div className="mt-4" aria-live="polite">
        {(launcher.isPending || projects.isPending) && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {(launcher.isError || projects.isError) && (
          <p role="alert" className={alertBox}>
            Impossible de lire le lanceur. Recharge la page ; si cela continue,
            réessaie plus tard.
          </p>
        )}
        {data && projects.data && (
          <ol className={listCard}>
            <li className="px-[18px] py-3.5">
              <p className="font-semibold">1. Créer la tâche sur claude.ai</p>
              <p className="mt-1">
                Choisis le déclencheur « API » seulement, le connecteur Cockpit
                seulement, le modèle que tu veux, et ajoute les repos des
                projets à développer dans le cloud.
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
            <PromptStep n={2} prompt={data.prompt} />
            <ConnectStep
              n={3}
              task={task}
              connected={data.connected}
              needsReconnect={data.needsReconnect}
            />
            <li className="px-[18px] py-3.5">
              <p className="font-semibold">4. Cocher les projets de la tâche</p>
              <p className="mt-1">
                Coche chaque projet dont tu as ajouté le repo à la tâche : seuls
                ceux-là se lancent dans le cloud.
              </p>
              <ul className="mt-2 grid gap-1.5">
                {projects.data
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={data.projectIds.includes(p.id)}
                          disabled={tick.isPending}
                          onChange={(e) =>
                            tick.mutate({
                              id: p.id,
                              inLauncher: e.target.checked,
                            })
                          }
                        />
                        {p.fullName}
                        {data.missingProjectIds.includes(p.id) && (
                          <span className="text-destructive">
                            · Le repo n'est pas dans la tâche : ajoute-le sur
                            claude.ai, puis coche à nouveau
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
              </ul>
            </li>
          </ol>
        )}
        {error && (
          <p role="alert" className={`mt-3 ${alertBox}`}>
            {error.message}
          </p>
        )}
      </div>
    </section>
  );
}
