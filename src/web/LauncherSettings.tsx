import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { fetchBudgets } from "./Cost.tsx";
import { fetchProjects } from "./Projects.tsx";
import { ConnectStep, failure, PromptStep, useTask } from "./TaskCard.tsx";
import {
  alertBox,
  button,
  field,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** The launcher of the user (decision 054 C), read by Réglages and by the « Développer avec Claude » panel. */
export async function fetchLauncher() {
  const res = await client.api.me.launcher.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

export async function fetchNightHours() {
  const res = await client.api.me["night-hours"].$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

/** Decision 044 C': the hours of the night of Claude, in the browser's time zone, and the cap of a night (060 C). */
function NightStep() {
  const queryClient = useQueryClient();
  const hours = useQuery({
    queryKey: ["night-hours"],
    queryFn: fetchNightHours,
  });
  const budgets = useQuery({ queryKey: ["budgets"], queryFn: fetchBudgets });
  const [typed, setTyped] = useState<Record<string, string>>({});
  const save = useMutation({
    meta: { done: "Réglages enregistrés." },
    mutationFn: async () => {
      if (!hours.data || !budgets.data) return;
      const value = (key: string, saved: number | null) =>
        key in typed ? typed[key] : `${saved ?? ""}`;
      const night = value("night", budgets.data.nightUsd);
      const [start, end] = [
        value("start", hours.data.startHour),
        value("end", hours.data.endHour),
      ];
      if (start === "" || end === "" || start === end)
        throw new Error("Indique deux heures différentes, de 0 à 23.");
      const [put, caps] = await Promise.all([
        client.api.me["night-hours"].$put({
          json: {
            startHour: Number(start),
            endHour: Number(end),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
        client.api.me.budgets.$put({
          json: { ...budgets.data, nightUsd: night ? Number(night) : null },
        }),
      ]);
      if (!put.ok || !caps.ok)
        throw new Error(
          "Heures ou plafond refusés : des heures de 0 à 23, un montant positif.",
        );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["night-hours"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
  if (!hours.data || !budgets.data) return null;
  const input = (
    key: string,
    label: string,
    saved: number | null,
    max?: number,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={max}
        required={max !== undefined}
        step={max === undefined ? "any" : 1}
        className={field}
        value={key in typed ? typed[key] : `${saved ?? ""}`}
        onChange={(e) => setTyped({ ...typed, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <li className="px-[18px] py-3.5">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="font-semibold">La nuit de Claude</p>
        <p className="text-[12.5px] text-muted-foreground">
          Claude développe les US de la page « Cette nuit » entre ces heures (de
          0 à 23, dans le fuseau de ton navigateur).
        </p>
        {input("start", "Début", hours.data.startHour, 23)}
        {input("end", "Fin", hours.data.endHour, 23)}
        {input("night", "Plafond par nuit", budgets.data.nightUsd)}
        {save.isError && (
          <p role="alert" className={alertBox}>
            {save.error.message}
          </p>
        )}
        {save.isSuccess && <p role="status">Heures enregistrées.</p>}
        <button
          type="submit"
          disabled={save.isPending}
          aria-busy={save.isPending}
          className={`justify-self-start ${button}`}
        >
          Enregistrer les heures
        </button>
      </form>
    </li>
  );
}

/** Decision 060 F: the variables that make Claude Code report its cost to this Cockpit; they go on the cloud environment, not on the task. */
function CostStep() {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const variables = [
    "CLAUDE_CODE_ENABLE_TELEMETRY=1",
    "OTEL_METRICS_EXPORTER=otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=${window.location.origin}/v1/metrics`,
  ].join("\n");
  return (
    <li className="px-[18px] py-3.5">
      <p className="font-semibold">Coût</p>
      <p className="mt-1">
        Pour que Cockpit affiche le coût des runs, ajoute ces variables à
        l'environnement cloud de la tâche, et autorise l'hôte{" "}
        <code>{window.location.host}</code> dans son accès réseau.
      </p>
      <pre className="mt-2 overflow-x-auto font-mono text-[12.5px]">
        {variables}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() =>
            navigator.clipboard.writeText(variables).then(
              () => setCopy("done"),
              () => setCopy("failed"),
            )
          }
        >
          Copier
        </button>
        <span className={copy === "failed" ? "text-destructive" : undefined}>
          {copy === "done" && "Copiées."}
          {copy === "failed" &&
            "Copie impossible : sélectionne les variables à la main."}
        </span>
      </div>
    </li>
  );
}

/** Decision 054 A and D: the user creates the « Lanceur Cockpit » task once, pastes its address and token, and ticks the projects whose repo they added to it. */
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
  const relaunch = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await client.api.me.launcher["auto-relaunch"].$put({
        json: { enabled },
      });
      if (!res.ok) throw failure(res);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["launcher"] }),
  });
  const data = launcher.data;
  const error = task.error ?? tick.error ?? relaunch.error;

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
          <p className="loading text-muted-foreground">Chargement…</p>
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
                          aria-busy={tick.isPending}
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
            <li className="px-[18px] py-3.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.autoRelaunch}
                  disabled={relaunch.isPending}
                  aria-busy={relaunch.isPending}
                  onChange={(e) => relaunch.mutate(e.target.checked)}
                />
                Relancer Claude quand la CI d'une PR échoue
              </label>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Cockpit relance Claude sur la même branche, 3 fois au plus
                d'affilée, pour les projets cochés ci-dessus.
              </p>
            </li>
            <NightStep />
            <CostStep />
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
