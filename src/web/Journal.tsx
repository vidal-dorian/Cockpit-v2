import { useInfiniteQuery } from "@tanstack/react-query";
import { client } from "./api.ts";
import { alertBox, button, card, primaryButton } from "./ui.ts";

/** A page of the caller's entries (25), the one after the entry `before`; null when the server answers 401. */
async function fetchHistory(before: number | undefined) {
  const res = await client.api.history.$get({
    query: before === undefined ? {} : { before: String(before) },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const ACTIONS: Record<string, string> = {
  login: "Connexion",
  logout: "Déconnexion",
  create_ticket: "Ticket créé",
  update_ticket: "Ticket modifié",
  delete_ticket: "Ticket supprimé",
  create_token: "Jeton créé",
  revoke_token: "Jeton révoqué",
  purge_revoked_tokens: "Jetons révoqués supprimés",
  mcp_auth: "Connexion MCP refusée",
  oauth_authorize: "Demande de connexion de Claude",
  oauth_token: "Jeton du connecteur Claude émis",
  list_projects: "Projets listés",
  get_project: "Projet consulté",
  search: "Recherche",
  get_ticket: "Ticket consulté",
  list_tickets_needing_us: "Tickets à écrire listés",
  create_user_stories: "User stories écrites",
  get_user_story: "User story consultée",
  validate_story: "User story validée",
  update_story: "User story modifiée",
  send_back_story: "User story renvoyée",
  abandon_story: "User story abandonnée",
  abandon_ticket: "Ticket abandonné",
  update_user_story: "User story réécrite",
  start_run: "Run démarré",
  report_step: "Étape signalée",
  report_criterion: "Critère signalé",
  ask_user: "Question posée",
  get_answer: "Réponse consultée",
  answer_question: "Question répondue",
  request_stop: "Arrêt demandé",
  close_run: "Run fermé à la main",
  link_pull_request: "PR liée",
  pull_request_merged: "PR mergée",
  pull_request_closed: "PR fermée sans merge",
  finish_run: "Run terminé",
  sync_issue: "Issue GitHub synchronisée",
  connect_routine: "Tâche d'écriture des US connectée",
  disconnect_routine: "Tâche d'écriture des US retirée",
  schedule_routine: "Planning d'écriture des US modifié",
  fire_write_us: "Écriture des US lancée",
  change_public_url: "Adresse publique modifiée",
  receive_webhook: "Webhook reçu",
  process_webhook: "Webhook non traité",
  issue_diverged: "Issue modifiée sur GitHub",
  keep_cockpit_issue: "Version de Cockpit gardée",
  take_github_issue: "Version de GitHub reprise",
  prepare_repo: "Préparer pour Claude",
  save_agent: "Agent enregistré",
  delete_agent: "Agent supprimé",
  save_team: "Équipe enregistrée",
  delete_team: "Équipe supprimée",
};
const ORIGINS: Record<string, string> = {
  ui: "Interface",
  mcp: "Claude",
  webhook: "GitHub",
  system: "Cockpit",
};
// The word always comes with the color, so the result never relies on color alone (decision 003).
export const RESULTS: Record<string, { label: string; style: string }> = {
  ok: { label: "Réussie", style: "bg-done-soft text-done-text" },
  refused: { label: "Refusée", style: "bg-destructive-soft text-destructive" },
  error: { label: "Erreur", style: "bg-destructive-soft text-destructive" },
};

export function Journal() {
  const pages = useInfiniteQuery({
    queryKey: ["history"],
    queryFn: ({ pageParam }) => fetchHistory(pageParam),
    initialPageParam: undefined as number | undefined,
    // The next page starts after the last entry shown (decision 028 F).
    getNextPageParam: (last) =>
      last?.hasMore ? last.entries.at(-1)?.id : undefined,
  });
  const entries = pages.data?.pages.flatMap((page) => page?.entries ?? []);
  const signedOut = pages.data?.pages[0] === null;

  return (
    <main className="mx-auto max-w-[880px] px-4 py-8 sm:px-7">
      <h1 className="font-heading text-3xl font-extrabold">Journal</h1>
      <div className="mt-6" aria-live="polite">
        {pages.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {pages.isError && !pages.data && (
          <div role="alert" className={alertBox}>
            <p>Impossible de lire le journal : {pages.error.message}</p>
            <button
              type="button"
              onClick={() => pages.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {signedOut && (
          <a href="/api/auth/login" className={primaryButton}>
            Se connecter avec GitHub
          </a>
        )}
        {pages.isSuccess && entries?.length === 0 && !signedOut && (
          <p className="text-muted-foreground">Aucune entrée pour l'instant.</p>
        )}
        {entries && entries.length > 0 && (
          <>
            <ul className="grid gap-2">
              {entries.map((entry) => {
                const result = RESULTS[entry.result];
                return (
                  <li
                    key={entry.id}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-4 ${card}`}
                  >
                    <span className="font-semibold">
                      {ACTIONS[entry.action] ??
                        (entry.origin === "mcp"
                          ? "Outil inconnu"
                          : entry.action)}
                      {"event" in entry && ` (${entry.event})`}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 font-semibold ${result?.style ?? ""}`}
                    >
                      {result?.label ?? entry.result}
                    </span>
                    <span className="text-muted-foreground">
                      {ORIGINS[entry.origin] ?? entry.origin}
                    </span>
                    <time
                      dateTime={entry.at}
                      className="text-muted-foreground sm:ml-auto"
                    >
                      {new Date(entry.at).toLocaleString("fr-FR")}
                    </time>
                  </li>
                );
              })}
            </ul>
            {pages.isFetchNextPageError && (
              <div role="alert" className={`mt-3 ${alertBox}`}>
                <p>Impossible de lire la suite du journal.</p>
                <button
                  type="button"
                  onClick={() => pages.fetchNextPage()}
                  className={`mt-3 ${button}`}
                >
                  Réessayer
                </button>
              </div>
            )}
            {pages.hasNextPage && !pages.isFetchNextPageError && (
              <button
                type="button"
                onClick={() => pages.fetchNextPage()}
                disabled={pages.isFetchingNextPage}
                className={`mt-3 ${button}`}
              >
                {pages.isFetchingNextPage ? "Chargement…" : "Afficher plus"}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
