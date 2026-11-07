import { useInfiniteQuery } from "@tanstack/react-query";
import { client } from "./api.ts";
import { StateSentence } from "./Shell.tsx";
import {
  alertBox,
  badge,
  button,
  listCard,
  primaryButton,
  sectionLabel,
  urgentBadge,
} from "./ui.ts";

/** A page of the caller's entries (25), the one after the entry `before`; null when the server answers 401. */
export async function fetchHistory(before: number | undefined) {
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
// The word always comes with the style, so the result never relies on color alone (decision 003); only an error is red (045 C).
export const RESULTS: Record<string, { label: string; style: string }> = {
  ok: { label: "Réussie", style: badge },
  refused: { label: "Refusée", style: badge },
  error: {
    label: "Erreur",
    style: urgentBadge,
  },
};

type Entry = NonNullable<
  Awaited<ReturnType<typeof fetchHistory>>
>["entries"][number];

/** A row of the journal: in a `listCard` on the journal page, laid down as its own card in a `grid` list (the home). */
export function JournalEntry({ entry }: { entry: Entry }) {
  const result = RESULTS[entry.result];
  return (
    <li className="flex min-h-[50px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 [.grid>&]:rounded-[14px] [.grid>&]:border [.grid>&]:border-border [.grid>&]:bg-card">
      <div className="min-w-0 flex-1">
        <span className="block font-semibold">
          {ACTIONS[entry.action] ??
            (entry.origin === "mcp" ? "Outil inconnu" : entry.action)}
          {"event" in entry && ` (${entry.event})`}
        </span>
        <p className="text-[13px] text-muted-foreground">
          <span>{ORIGINS[entry.origin] ?? entry.origin}</span>
          {entry.project && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{entry.project}</span>
            </>
          )}
        </p>
      </div>
      <span className={result?.style ?? badge}>
        {result?.label ?? entry.result}
      </span>
      <time
        dateTime={entry.at}
        className="text-[13px] text-muted-foreground tabular-nums"
      >
        {new Date(entry.at).toLocaleString("fr-FR")}
      </time>
    </li>
  );
}

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
    <main>
      <StateSentence
        title="Tout ce qui s'est passé, par qui."
        rest="Rien ne s'efface ; chaque appel de Claude y est."
      />
      <div className="mt-6 px-[26px] pb-8" aria-live="polite">
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
            <div className="mb-2 flex items-baseline gap-2 text-[13px] text-muted-foreground">
              <h2 className={sectionLabel}>Journal</h2>
              <span>
                · {entries.length} {entries.length === 1 ? "entrée" : "entrées"}
              </span>
            </div>
            <ul className={listCard}>
              {entries.map((entry) => (
                <JournalEntry key={entry.id} entry={entry} />
              ))}
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
