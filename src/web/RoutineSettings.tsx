import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

const field = `mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 ${focusRing}`;
const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`;
const errorBox = "rounded-xl bg-destructive-soft p-4 text-destructive";

/** The routine of the user (decision 022 C), read by Réglages and by the project page. */
export async function fetchRoutine() {
  const res = await client.api.me.routine.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

/** A French sentence for a failed answer; the codes of the server are not meant to be read. */
const failure = (res: Response) =>
  new Error(
    res.status === 400
      ? "L'adresse de lancement ou le jeton n'est pas valide : colle-les tels que claude.ai les affiche."
      : "L'opération a échoué, réessaie.",
  );

/** Decision 022 A: the user creates the scheduled task of claude.ai once, then pastes its address and its token here. */
export function RoutineSettings() {
  const queryClient = useQueryClient();
  const routine = useQuery({ queryKey: ["routine"], queryFn: fetchRoutine });
  const [fireUrl, setFireUrl] = useState("");
  const [token, setToken] = useState("");
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  // The fields or the buttons are replaced when the state changes: the focus goes back to the heading, not to <body>.
  const heading = useRef<HTMLHeadingElement>(null);
  const settled = {
    onSuccess: () => heading.current?.focus(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["routine"] }),
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.routine.$put({
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
      const res = await client.api.me.routine.$delete();
      if (!res.ok) throw failure(res);
    },
    ...settled,
  });

  const data = routine.data;
  const connected = data?.connected && !data.needsReconnect;

  return (
    <section aria-labelledby="ecrire-us">
      <h2
        id="ecrire-us"
        ref={heading}
        tabIndex={-1}
        className={`font-heading text-xl font-bold ${focusRing}`}
      >
        Écrire les US automatiquement
      </h2>
      <p className="mt-1 text-muted-foreground">
        Cockpit lance lui-même l'écriture des user stories, à la fréquence que
        tu choisis pour chaque projet. Il faut pour cela créer une fois une
        tâche planifiée sur claude.ai.
      </p>
      <div className="mt-4" aria-live="polite">
        {routine.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {routine.isError && (
          <p role="alert" className={errorBox}>
            Impossible de lire la tâche. Recharge la page ; si cela continue,
            réessaie plus tard.
          </p>
        )}
        {data && (
          <ol className="grid gap-3">
            <li className="rounded-xl bg-card p-4">
              <p className="font-semibold">1. Créer la tâche sur claude.ai</p>
              <p className="mt-1">
                Choisis le déclencheur « API » seulement (ni planning, ni repo),
                le modèle que tu veux, et garde seulement le connecteur Cockpit
                : retire les autres (claude.ai les coche tous par défaut).
              </p>
              <a
                href="https://claude.ai/code/routines"
                target="_blank"
                rel="noreferrer noopener"
                className={`mt-2 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
              >
                Ouvrir les tâches de claude.ai
              </a>
            </li>
            <li className="rounded-xl bg-card p-4">
              <p className="font-semibold">2. Copier la consigne</p>
              <p className="mt-1">Colle-la comme consigne de la tâche.</p>
              <textarea
                readOnly
                aria-label="Consigne"
                rows={6}
                value={data.prompt}
                onFocus={(e) => e.currentTarget.select()}
                className={`${field} font-mono`}
              />
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
                  {copy === "failed" &&
                    "Copie impossible : sélectionne la consigne à la main."}
                </span>
              </div>
            </li>
            <li className="rounded-xl bg-card p-4">
              <p className="font-semibold">3. Coller l'adresse et le jeton</p>
              {connected ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-done-soft px-3 py-1 font-semibold text-done-text">
                    Connectée
                  </span>
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
                    <p className={`mt-2 ${errorBox}`}>
                      La tâche est à reconnecter : claude.ai a refusé le jeton.
                      Clique « Régénérer » sur la tâche, puis colle le nouveau
                      jeton ici.{" "}
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
                  <p className="mt-1">
                    Dans la tâche, ajoute le déclencheur API : claude.ai affiche
                    l'adresse de lancement et le jeton une seule fois.
                  </p>
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
                      className={`justify-self-start min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
                    >
                      Enregistrer
                    </button>
                  </form>
                </>
              )}
            </li>
          </ol>
        )}
        {(save.error ?? remove.error) && (
          <p role="alert" className={`mt-3 ${errorBox}`}>
            {(save.error ?? remove.error)?.message}
          </p>
        )}
      </div>
    </section>
  );
}
