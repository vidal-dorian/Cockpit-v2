# 014 — Les tickets

- **Statut** : validée
- **Date** : 2026-10-25
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md), [010 — Historique](010-historique.md), [011 — Importer un projet](011-import-projets.md)
- **Tranche** : 3.1 du [découpage](../decoupage.md)
- **Modifiée par 017** : les lignes F et G (étape « Nouveau » pour tous les tickets, suppression « vraie d'office ») sont remplacées par les règles de la 002, appliquées avec les US, et par le refus `ticket_has_stories` ; dans la ligne I, « Supprimer » n'est plus montré dès que le ticket a des US — voir la [017](017-user-stories.md), choix I, J et L
- **Modifiée par 054** : dans la ligne I, le formulaire « Nouveau ticket » quitte l'onglet Tickets (un ticket se crée par la barre « Noter une idée ») ; la priorité, les étiquettes et la recherche, repoussées ci-dessous, sont faites par la tranche 11.2 — voir la [054](054-tickets-complets.md)

## Contexte

Un ticket est une idée brute d'un projet (brief §6.2) : un titre suffit, une description en markdown l'enrichit. La 002 a décrit la table `tickets` et son étape calculée ; cette tranche la crée, avec ses routes, sa page et ses entrées d'historique. Les user stories (4.3 et suivantes) viendront ensuite.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quelle table ? | `tickets` : `id` (identité), `project_id` (clé étrangère vers `projects`, `RESTRICT` : 002), `title`, `description_md` (vide par défaut), `abandoned_at` (vide ; rien ne le remplit avant l'abandon, plus tard), `created_at`, `updated_at`. `history` reçoit une colonne `ticket_id`, **sans clé étrangère** (002, 010 B) : une entrée garde l'identifiant d'un ticket supprimé |
| B | Quelles routes ? | `POST` et `GET /api/projects/:id/tickets` (création ; liste, du plus récent au plus ancien) ; `GET`, `PATCH` et `DELETE /api/tickets/:id`. Mêmes barrières que les routes de projet : 503 si l'App n'est pas configurée (avant la session), 401, puis 404. La barrière de `projectRoutes` couvre aussi `/api/tickets/*`. L'accès passe par `memberProject` (011 E), pour `/api/tickets/:id` via le projet du ticket : le ticket d'un autre, un identifiant invalide ou inconnu répondent tous 404, sans entrée d'historique |
| C | Quelles limites ? | Validation par zod, **avant** `act` : rien n'est écrit, pas même une entrée, et la réponse est 400. Titre : texte **rogné** de 1 à 200 caractères. Description : au plus 50 000 caractères, gardée telle quelle (elle peut être vide). Le caractère NUL est refusé (400) : le texte PostgreSQL ne peut pas le contenir. Un corps JSON de plus de **256 Kio** est refusé (413) sur **toutes** les routes `/api/*`, avant la session et la validation, car il est lu entier en mémoire. `PATCH` demande au moins une des deux clés |
| D | Et si le projet est archivé ? | **Lecture seule** : lister et lire marchent, créer, modifier et supprimer répondent 409 `project_archived`. Le refus passe par `act` (`Refused`) : une entrée `refused` est écrite (010 C). L'état d'archivage est relu **dans la transaction** avec `FOR SHARE` : un archivage simultané attend la fin de l'action, aucun ne passe entre la vérification et l'écriture |
| E | Que garde l'historique ? | `create_ticket`, `update_ticket`, `delete_ticket`, avec `args: { ticketId }` et les colonnes `project_id` et `ticket_id` remplies. **Jamais le titre ni la description** (010 D) : le texte reste dans la table, d'où il peut être effacé |
| F | Comment l'étape est-elle donnée ? | Calculée, jamais stockée (002), par une seule fonction pure, `ticketStep`. Sans US, tous les tickets sont « Nouveau » (`new`). Les tranches des US (4.3 et suivantes) y ajouteront les autres règles de la 002 |
| G | Peut-on supprimer ? | Oui. La règle 2 de la 002 (un ticket ne se supprime que sans US) est **vraie d'office** tant qu'il n'y a pas d'US ; la tranche 4.3 (les US) la vérifiera. La page demande une confirmation sur place (003, règle 4), puis revient au projet |
| H | Comment la description est-elle affichée ? | En markdown, par `react-markdown`, **sans HTML brut** : le HTML tapé dans une description reste du texte ou disparaît, jamais un élément. Les **images distantes sont bloquées** (`disallowedElements`, le texte alternatif n'est pas gardé) : une image serait un pixel espion dès que Claude ou une issue importée écrira les descriptions. La page est chargée à la demande, pour que `react-markdown` reste hors du paquet principal. Pourquoi : la description peut venir d'ailleurs que de l'utilisateur (Claude, plus tard une issue GitHub), et du HTML brut serait une faille XSS. On n'ajoute pas `rehype-raw`. L'adresse d'un lien est filtrée par la transformation par défaut de `react-markdown` : un lien `javascript:` perd son `href` |
| I | Quels écrans ? | Une section « Tickets » sur `/projets/:id` (liste, étape, formulaire « Nouveau ticket » : titre obligatoire, description markdown facultative, toujours visible, choix de Dorian le 2026-10-25 ; un champ vide n'est pas envoyé, un texte est gardé tel quel, espaces compris, comme dans « Modifier »), une page `/tickets/:id` (rendu, « Modifier », « Supprimer »). Erreurs en français, jamais les codes du serveur. Le Journal sait nommer les trois actions |

## Ce qui est repoussé

- Le bouton global « Nouveau ticket » et le raccourci `N` : section 6.20 du brief.
- Pièces jointes, import d'issues GitHub : tranches suivantes. *Priorité, étiquettes et recherche sont faites par la [054](054-tickets-complets.md) (11.2).*
- L'abandon d'un ticket (tranche 4.4) et les étapes autres que « Nouveau » (4.3 et suivantes).

## Limites connues

- **La limite de 256 Kio passe en premier, sur toutes les routes `/api/*`** : la tranche 5.1 (webhooks GitHub, dont les charges utiles peuvent être plus grandes) devra en exempter la route des webhooks ou la relever.
- **Pas de pagination** de la liste : un projet n'a qu'un utilisateur et peu de tickets au MVP.

## Pistes écartées

- **Stocker l'étape** : elle se calcule (002) ; une colonne pourrait contredire les US.
- **Autoriser le HTML brut avec un assainisseur** (`rehype-raw` et `rehype-sanitize`) : plus de code et une liste blanche à tenir, pour une fonction dont personne n'a besoin.
