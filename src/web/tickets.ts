import { client } from "./api.ts";

/** The step labels of a ticket (decision 002); the codes of the server are never shown. */
export const STEPS: Record<string, string> = {
  abandoned: "Abandonné",
  new: "Nouveau",
  in_progress: "En cours",
  to_validate: "À valider",
  done: "Terminé",
  validated: "Validé",
};

/** The status labels of a run and of its steps (decision 033 I). */
export const RUN_STATUSES: Record<string, string> = {
  running: "En cours",
  succeeded: "Réussi",
  failed: "Échoué",
  stopped: "Arrêté",
  closed_manually: "Fermé à la main",
};

/** The result labels of an acceptance criterion (decision 035 F). */
export const CRITERION_RESULTS: Record<string, string> = {
  passed: "Réussi",
  failed: "Échoué",
};

/** The status labels of a user story (decision 017 L). */
export const STORY_STATUSES: Record<string, string> = {
  to_validate: "à valider",
  to_rewrite: "à réécrire",
  ready: "prête",
  in_progress: "en cours",
  in_review: "en revue",
  done: "terminée",
  abandoned: "abandonnée",
};

/** The French error of a refused create, edit or delete; nothing of what the server said is shown. */
export async function ticketError(res: Response) {
  if (res.status === 400)
    return new Error(
      "Le titre doit faire de 1 à 200 caractères et la description 50 000 au plus.",
    );
  const body: unknown = await res.json().catch(() => null);
  if ((body as { error?: unknown } | null)?.error === "project_archived")
    return new Error("Ce projet est archivé : ses tickets ne changent plus.");
  if ((body as { error?: unknown } | null)?.error === "ticket_has_stories")
    return new Error("Ce ticket a des user stories : il ne se supprime plus.");
  return new Error("L'opération a échoué, réessaie.");
}

/** The French error of a refused decision on a story or a ticket (decision 018 J); nothing of what the server said is shown. */
export async function decisionError(res: Response) {
  if (res.status === 400)
    return new Error(
      "Le texte est refusé : chaque champ et chaque critère doit être rempli (1 000 caractères au plus pour le récit, 2 000 pour un critère ou le commentaire, 50 000 pour les notes).",
    );
  const body: unknown = await res.json().catch(() => null);
  const error = (body as { error?: unknown } | null)?.error;
  if (error === "project_archived")
    return new Error("Ce projet est archivé : plus rien n'y change.");
  if (error === "ticket_abandoned")
    return new Error("Ce ticket est abandonné : il ne change plus.");
  if (error === "wrong_status")
    return new Error(
      "Le statut de cette user story a changé entre-temps : la page montre son statut actuel.",
    );
  if (error === "takeover_story")
    return new Error(
      "Une US de reprise ne se réécrit pas : corrige ses règles dans l'écran de reprise.",
    );
  if (error === "rules_pending")
    return new Error("Des règles sont encore à trancher.");
  if (error === "no_divergence")
    return new Error("L'issue n'attend plus de choix : la page est à jour.");
  if (error === "not_template")
    return new Error(
      "La version de GitHub ne suit plus le gabarit de Cockpit : garde la version de Cockpit, ou recopie les changements avec « Modifier ».",
    );
  return new Error("L'opération a échoué, réessaie.");
}

/** « 1 critère », « 2 critères ». */
export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The tickets of a project, in the order of the list (priority, then newest first), or null when the server answers 401. */
export async function fetchTickets(id: string) {
  const res = await client.api.projects[":id"].tickets.$get({ param: { id } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).tickets;
}

/** The priorities of a ticket (decision 054 A), as the select of the idea panel and of the ticket page offers them. */
export const PRIORITIES = {
  low: "Priorité : basse",
  normal: "Priorité : normale",
  high: "Priorité : haute",
} as const;

/** A tag as the server keeps it (decision 054 A): trimmed, inner spaces reduced to one, lowercase. */
export const normalizeTag = (text: string) =>
  text.trim().replace(/\s+/g, " ").toLowerCase();

/** How old a ticket is, in the words of the list (« 10 min », « 2 j », « 2 sem. »). */
export function age(iso: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(iso)) / 60_000),
  );
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  if (days < 1) return `${Math.floor(minutes / 60)} h`;
  if (days < 7) return `${days} j`;
  return days < 60
    ? `${Math.floor(days / 7)} sem.`
    : `${Math.floor(days / 30)} mois`;
}
