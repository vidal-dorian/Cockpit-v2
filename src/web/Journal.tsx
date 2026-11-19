import { Link } from "react-router";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

/** A page of the caller's entries (25), the one after the entry `before`, narrowed by the filters (decision 053 A); null when the server answers 401. */
export async function fetchHistory(
  before: number | undefined,
  filters: Record<string, string> = {},
) {
  const res = await client.api.history.$get({
    query:
      before === undefined ? filters : { ...filters, before: String(before) },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const ACTIONS: Record<string, string> = {
  delete_branch: "Branche supprimée",
  import_issues: "Issues importées",
  add_attachment: "Pièce jointe ajoutée",
  delete_attachment: "Pièce jointe retirée",
  get_attachment: "Pièce jointe lue",
  login: "Connexion",
  logout: "Déconnexion",
  create_ticket: "Ticket créé",
  refused_role: "Refusé : rôle insuffisant",
  refused_plan: "Refusé : abonnement Gratuit",
  create_invitation: "Invitation créée",
  renew_invitation: "Invitation renouvelée",
  cancel_invitation: "Invitation annulée",
  accept_invitation: "Invitation acceptée",
  change_member_role: "Rôle d'un membre changé",
  remove_member: "Membre retiré",
  archive_project: "Projet archivé",
  ask_workflow_help: "Aide demandée à Claude sur un workflow",
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
  connect_launcher: "Lanceur relié",
  disconnect_launcher: "Lanceur retiré",
  // shortcut: one label for both directions (the entry's args are not read here), split when the journal shows them.
  set_launcher_project: "Projet ajouté ou retiré du lanceur",
  launch_story: "US lancée dans le cloud",
  save_routine: "Routine enregistrée",
  delete_routine: "Routine supprimée",
  save_agent_team: "Équipe d'agents enregistrée",
  delete_agent_team: "Équipe d'agents supprimée",
  pause_routine: "Routine en pause",
  resume_routine: "Routine reprise",
  fire_routine: "Routine lancée",
  finish_launch: "Passage fini",
  queue_story: "US mise en file",
  unqueue_story: "US retirée de la file",
  reorder_queue: "File réordonnée",
  pause_queue: "File en pause",
  resume_queue: "File reprise",
  plan_night: "Nuit programmée",
  cancel_night: "Nuit annulée",
  reorder_night: "Nuit réordonnée",
  stop_night: "Nuit arrêtée",
  start_night: "Nuit commencée",
  finish_night: "Nuit finie",
  set_night_hours: "Heures de la nuit réglées",
  hide_night: "Nuit masquée de l'accueil",
  set_auto_relaunch: "Relance automatique réglée",
  set_budgets: "Plafonds réglés",
  get_launch: "Lancement lu par Claude",
  report_launch: "Repo absent de la tâche",
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
  submit_code_map: "Carte du code déposée",
  submit_findings: "Constats déposés",
  list_findings: "Constats listés",
  ticket_finding: "Constat transformé en ticket",
  dismiss_finding: "Constat rejeté",
  later_finding: "Constat remis à plus tard",
  refresh_github_alerts: "Alertes GitHub actualisées",
  add_dependabot: ".github/dependabot.yml ajouté",
  create_takeover_stories: "Règles de reprise écrites",
  keep_rule: "Règle validée",
  unkeep_rule: "Validation de la règle annulée",
  edit_rule: "Règle corrigée",
  bug_rule: "Règle notée comme bug",
  update_catalog: "Fichiers de Claude mis à jour",
};
const ORIGINS: Record<string, string> = {
  ui: "Interface",
  mcp: "Claude",
  webhook: "GitHub",
  system: "Cockpit",
};
const tagShape = "rounded-[5px] px-2 py-1 text-xs font-semibold";
const tag = `${tagShape} bg-raised text-muted-foreground`;
// The word always comes with the style, so the result never relies on color alone (decision 003); only an error is red (045 C).
export const RESULTS: Record<string, { label: string; style: string }> = {
  ok: { label: "Réussie", style: tag },
  refused: { label: "Refusée", style: tag },
  error: {
    label: "Erreur",
    style: `${tagShape} bg-you-soft text-you-text`,
  },
};

export type Entry = NonNullable<
  Awaited<ReturnType<typeof fetchHistory>>
>["entries"][number];

// The glyph of the row: what failed, else who acted.
const GLYPHS: Record<string, string> = {
  mcp: "✦",
  ui: "●",
  webhook: "⇄",
  system: "⟳",
};

const rowGrid =
  "grid min-h-[50px] grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-[18px] py-2";

/** The page of the object an entry names: its run, else its story, else its ticket (decision 085 C). */
export const objectPath = (e: Entry) =>
  e.runId !== null
    ? `/runs/${e.runId}`
    : e.storyId !== null
      ? `/us/${e.storyId}`
      : e.ticketId !== null
        ? `/tickets/${e.ticketId}`
        : null;

/** « Run 17 · US 43 · Ticket 12 »: the objects an entry names, in plain text. */
export const objectWords = (e: Entry) =>
  [
    e.runId !== null && `Run ${e.runId}`,
    e.storyId !== null && `US ${e.storyId}`,
    e.ticketId !== null && `Ticket ${e.ticketId}`,
  ].filter(Boolean);

/** A row of the journal: in a `listCard` on the journal page, laid down as its own card in a `grid` list (the home). The page shows the time only: its day group has the date. */
export function JournalEntry({
  entry,
  timeOnly = false,
  onOpen,
  to,
}: {
  entry: Entry;
  timeOnly?: boolean;
  /** Makes the whole row a button that opens the entry in the panel (decision 053 G). */
  onOpen?: () => void;
  /** Makes the whole row a link to the object of the entry (decision 085 C). */
  to?: string | null;
}) {
  const result = RESULTS[entry.result];
  const at = new Date(entry.at);
  const cells = (
    <>
      <div
        aria-hidden="true"
        className="text-center text-[13px] font-bold text-dim"
      >
        {entry.result === "ok" ? (GLYPHS[entry.origin] ?? "●") : "✕"}
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {/* The label stays the first span of the row. */}
          <b className="font-semibold">
            {ORIGINS[entry.origin] ?? entry.origin}
          </b>
          ·{" "}
          <span>
            {ACTIONS[entry.action] ??
              (entry.origin === "mcp" ? "Outil inconnu" : entry.action)}
            {"event" in entry && ` (${entry.event})`}
          </span>
        </p>
        {entry.project && (
          <span className="block truncate text-[12.5px] font-medium text-muted-foreground">
            {entry.project}
          </span>
        )}
      </div>
      <span className={result?.style ?? tag}>
        {result?.label ?? entry.result}
      </span>
      <time
        dateTime={entry.at}
        className="min-w-[50px] text-right text-[12.5px] text-muted-foreground tabular-nums"
      >
        {timeOnly
          ? at.toLocaleTimeString("fr-FR", {
              hour: "numeric",
              minute: "2-digit",
            })
          : at.toLocaleString("fr-FR")}
      </time>
    </>
  );
  return to ? (
    <li className="[.grid>&]:rounded-[14px] [.grid>&]:border [.grid>&]:border-border [.grid>&]:bg-card">
      <Link
        to={to}
        className={`${rowGrid} w-full rounded-[inherit] text-left hover:bg-raised ${focusRing}`}
      >
        {cells}
      </Link>
    </li>
  ) : onOpen ? (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`${rowGrid} w-full text-left hover:bg-raised ${focusRing}`}
      >
        {cells}
      </button>
    </li>
  ) : (
    <li
      className={`${rowGrid} [.grid>&]:rounded-[14px] [.grid>&]:border [.grid>&]:border-border [.grid>&]:bg-card`}
    >
      {cells}
    </li>
  );
}
