import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { refusedError } from "./roles.ts";
import { StateSentence } from "./Shell.tsx";
import {
  alertBox,
  button,
  focusRing,
  iconButton,
  listCard,
  moved,
  row,
  sectionLabel,
} from "./ui.ts";

async function fetchClaude() {
  const res = await client.api.claude.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}
async function fetchQueue() {
  const res = await client.api.queue.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

const PAUSES: Record<string, string> = {
  launch_failed:
    "Un lancement a échoué : vérifie le lanceur dans les Réglages, puis reprends.",
  run_failed:
    "Un run de la file a échoué ou a été arrêté : regarde-le, puis reprends.",
  no_session:
    "Une session n'a pas démarré en 15 minutes : vérifie le lanceur, puis reprends.",
};

const REFUSED = "Cette action a été refusée : recharge la page.";

/** Decision 058 F: the page « Claude », what Claude does now and the queue of stories it launches one by one. */
export function Claude() {
  const queryClient = useQueryClient();
  // Under "home" so the stream of changes reloads them with the home.
  const claude = useQuery({
    queryKey: ["home", "claude"],
    queryFn: fetchClaude,
  });
  const queue = useQuery({ queryKey: ["home", "queue"], queryFn: fetchQueue });
  const [adding, setAdding] = useState(false);
  const change = useMutation({
    mutationFn: async (call: () => Promise<Response>) => {
      const res = await call();
      if (!res.ok) throw await refusedError(res, REFUSED);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const items = queue.data?.items ?? [];
  const ids = items.map((i) => i.storyId);
  const move = (at: number, by: number) =>
    change.mutate(() =>
      client.api.queue.$put({ json: { storyIds: moved(ids, at, by) } }),
    );
  const running = claude.data?.running ?? [];
  const pausedFor = queue.data?.pausedReason;

  return (
    <main>
      <StateSentence
        title={`Claude travaille sur ${running.length} ${running.length > 1 ? "runs" : "run"}.`}
        actions={
          <span className="flex gap-4">
            <Link to="/claude/cout" className="underline">
              Coût
            </Link>
            <Link to="/claude/taches" className="underline">
              Tâches programmées
            </Link>
          </span>
        }
      />
      <div className="grid gap-6 px-[26px] py-6">
        {(claude.isError || queue.isError) && (
          <p role="alert" className={alertBox}>
            Impossible de lire la page. Recharge-la ; si cela continue, réessaie
            plus tard.
          </p>
        )}
        {change.isError && (
          <p role="alert" className={alertBox}>
            {change.error.message}
          </p>
        )}
        {!claude.data && !claude.isError && !queue.isError && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
        {claude.data && queue.data && (
          <>
            <section aria-labelledby="maintenant">
              <h2 id="maintenant" className={sectionLabel}>
                Maintenant
              </h2>
              <ul className={`mt-2 ${listCard}`}>
                {claude.data.questions.map((q) => (
                  <li key={q.questionId} className={row}>
                    <b>
                      <Link to={`/us/${q.storyId}`}>{q.iWant}</Link>
                    </b>
                    <span className="text-muted-foreground">{q.question}</span>
                    <Link to={`/runs/${q.runId}`} className="ml-auto underline">
                      Répondre
                    </Link>
                  </li>
                ))}
                {claude.data.questions.length === 0 && (
                  <li className={`${row} text-muted-foreground`}>
                    Aucune question en attente.
                  </li>
                )}
              </ul>
            </section>
            <section aria-labelledby="en-cours">
              <h2 id="en-cours" className={sectionLabel}>
                En cours
              </h2>
              <ul className={`mt-2 ${listCard}`}>
                {running.map((r) => (
                  <li key={r.runId} className={row}>
                    <Link to={`/runs/${r.runId}`} className="font-semibold">
                      {r.iWant}
                    </Link>
                    <span className="text-muted-foreground">
                      {r.project.name}
                      {r.step && ` · ${r.step}`}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {r.cloud ? "cloud" : "ce PC"}
                    </span>
                  </li>
                ))}
                {running.length === 0 && (
                  <li className={`${row} text-muted-foreground`}>
                    Aucun run en cours.
                  </li>
                )}
              </ul>
            </section>
            <section aria-labelledby="file">
              <div className="flex items-center justify-between gap-3">
                <h2 id="file" className={sectionLabel}>
                  File d'attente
                </h2>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className={button}
                    onClick={() => setAdding(!adding)}
                  >
                    + Ajouter une US
                  </button>
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      change.mutate(() =>
                        queue.data.paused
                          ? client.api.queue.resume.$post()
                          : client.api.queue.pause.$post(),
                      )
                    }
                  >
                    {queue.data.paused ? "Reprendre" : "Mettre en pause"}
                  </button>
                </span>
              </div>
              {queue.data.paused && (
                <p role="status" className="mt-2 text-muted-foreground">
                  La file est en pause. {pausedFor && (PAUSES[pausedFor] ?? "")}
                </p>
              )}
              {adding && (
                <div className={`mt-2 grid gap-1 ${listCard}`}>
                  {claude.data.readyStories.length === 0 && (
                    <p className={`${row} text-muted-foreground`}>
                      Aucune US prête dans les projets cochés du lanceur.
                    </p>
                  )}
                  {claude.data.readyStories.map((s) => (
                    <button
                      key={s.storyId}
                      type="button"
                      className={`${row} text-left hover:bg-raised ${focusRing}`}
                      onClick={() => {
                        setAdding(false);
                        change.mutate(() =>
                          client.api.queue.$post({
                            json: { storyId: s.storyId },
                          }),
                        );
                      }}
                    >
                      <b>{s.iWant}</b>
                      <span className="text-muted-foreground">
                        {s.project.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <ul className={`mt-2 ${listCard}`}>
                {items.map((i, at) => (
                  <li key={i.storyId} className={row}>
                    <b id={`queue-${i.storyId}`}>
                      <Link to={`/us/${i.storyId}`}>{i.iWant}</Link>
                    </b>
                    <span className="text-muted-foreground">
                      {i.projectName}
                    </span>
                    {i.waiting && (
                      <span className="text-muted-foreground">
                        {i.waiting.reason === "dependency" ? (
                          <>
                            Attend{" "}
                            <Link
                              to={`/us/${i.waiting.storyId}`}
                              className="underline"
                            >
                              {`l'US ${i.waiting.storyId}`}
                            </Link>
                            , sautée en attendant.
                          </>
                        ) : (
                          "N'est plus prête, sautée en attendant."
                        )}
                      </span>
                    )}
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        aria-label="Monter"
                        aria-describedby={`queue-${i.storyId}`}
                        disabled={at === 0}
                        className={iconButton}
                        onClick={() => move(at, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Descendre"
                        aria-describedby={`queue-${i.storyId}`}
                        disabled={at === items.length - 1}
                        className={iconButton}
                        onClick={() => move(at, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label="Retirer"
                        aria-describedby={`queue-${i.storyId}`}
                        className={iconButton}
                        onClick={() =>
                          change.mutate(() =>
                            client.api.queue[":storyId"].$delete({
                              param: { storyId: String(i.storyId) },
                            }),
                          )
                        }
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className={`${row} text-muted-foreground`}>
                    La file est vide.
                  </li>
                )}
              </ul>
            </section>
            <section aria-labelledby="finis">
              <h2 id="finis" className={sectionLabel}>
                Finis aujourd'hui
              </h2>
              <ul className={`mt-2 ${listCard}`}>
                {claude.data.finishedToday.map((r) => (
                  <li key={r.runId} className={row}>
                    <Link to={`/runs/${r.runId}`} className="font-semibold">
                      {r.iWant}
                    </Link>
                    <span className="text-muted-foreground">
                      {r.project.name}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {r.outcome === "succeeded" ? "réussi" : "échoué"}
                    </span>
                  </li>
                ))}
                {claude.data.finishedToday.length === 0 && (
                  <li className={`${row} text-muted-foreground`}>
                    Rien de fini aujourd'hui.
                  </li>
                )}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
