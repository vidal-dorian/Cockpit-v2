import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { fetchProjects } from "./Projects.tsx";
import {
  alertBox,
  badge,
  button,
  field,
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

const failure = (res: Response) =>
  new Error(
    res.status === 400
      ? "L'adresse de lancement ou le jeton n'est pas valide : colle-les tels que claude.ai les affiche."
      : "L'opération a échoué, réessaie.",
  );

/** Decision 053 A and D: the user creates the « Lanceur Cockpit » task once, pastes its address and token, and ticks the projects whose repo they added to it. */
export function LauncherSettings() {
  const queryClient = useQueryClient();
  const launcher = useQuery({ queryKey: ["launcher"], queryFn: fetchLauncher });
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const [fireUrl, setFireUrl] = useState("");
  const [token, setToken] = useState("");
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const settled = {
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["launcher"] }),
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.launcher.$put({
        json: { fireUrl, token },
      });
      if (!res.ok) throw failure(res);
      // The token only lives in the field, and not any longer than the save.
      setToken("");
      setFireUrl("");
    },
    ...settled,
  });
  const remove = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.launcher.$delete();
      if (!res.ok) throw failure(res);
    },
    ...settled,
  });
  const tick = useMutation({
    mutationFn: async (v: { id: number; inLauncher: boolean }) => {
      const res = await client.api.projects[":id"].launcher.$put({
        param: { id: String(v.id) },
        json: { inLauncher: v.inLauncher },
      });
      if (!res.ok) throw failure(res);
    },
    ...settled,
  });

  const data = launcher.data;
  const connected = data?.connected && !data.needsReconnect;
  const error = save.error ?? remove.error ?? tick.error;

  return (
    <section aria-labelledby="lanceur">
      <h2 id="lanceur" className={sectionLabel}>
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
            <li className="px-[18px] py-3.5">
              <p className="font-semibold">2. Copier la consigne</p>
              <p className="mt-1">Colle-la comme consigne de la tâche.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText(data.prompt).then(
                      () => setCopy("done"),
                      () => setCopy("failed"),
                    )
                  }
                  className={button}
                >
                  Copier la consigne
                </button>
                <span
                  className={copy === "failed" ? "text-destructive" : undefined}
                >
                  {copy === "done" && "Copiée."}
                  {copy === "failed" && "Copie impossible, réessaie."}
                </span>
              </div>
            </li>
            <li className="px-[18px] py-3.5">
              <p className="font-semibold">3. Coller l'adresse et le jeton</p>
              {connected ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={badge}>Connecté</span>
                  <button
                    type="button"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className={button}
                  >
                    Retirer
                  </button>
                </div>
              ) : (
                <>
                  {data.needsReconnect && (
                    <p className={`mt-2 ${alertBox}`}>
                      Le lanceur est à reconnecter : claude.ai a refusé le
                      jeton. Clique « Régénérer » sur la tâche, puis colle le
                      nouveau jeton ici.{" "}
                      <button
                        type="button"
                        onClick={() => remove.mutate()}
                        disabled={remove.isPending}
                        className={button}
                      >
                        Retirer
                      </button>
                    </p>
                  )}
                  <form
                    className="mt-2 grid gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save.mutate();
                    }}
                  >
                    <label>
                      Adresse de lancement
                      <input
                        value={fireUrl}
                        onChange={(e) => setFireUrl(e.target.value)}
                        autoComplete="off"
                        className={`${field} font-mono`}
                      />
                    </label>
                    <label>
                      Jeton
                      <input
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        autoComplete="off"
                        className={`${field} font-mono`}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={save.isPending}
                      className={`justify-self-start ${primaryButton}`}
                    >
                      Enregistrer
                    </button>
                  </form>
                </>
              )}
            </li>
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
                      <label className={`flex items-center gap-2 ${focusRing}`}>
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
