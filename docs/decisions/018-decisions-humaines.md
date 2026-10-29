# 018 — Les décisions humaines sur une US

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-28
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md), [004 — Outils MCP](004-outils-mcp.md), [010 — Historique](010-historique.md), [014 — Tickets](014-tickets.md), [017 — Claude écrit les US](017-user-stories.md)
- **Tranche** : 4.4 du [découpage](../decoupage.md)
- **Modifie** : la [004](004-outils-mcp.md), table des droits (choix B : l'humain valide aussi une US à réécrire)

## Contexte

Claude écrit les US (017) ; seul l'humain les valide, les renvoie ou les abandonne (brief §5, règle centrale du produit). Cette tranche donne ces décisions à l'humain, la réécriture à Claude (`update_user_story`), teste la table des droits ligne par ligne et montre l'historique de l'US. Elle ajoute l'abandon d'un ticket, repoussé par la 014.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quelles actions humaines ? | Quatre routes, mêmes barrières que celles des tickets (503, 401, 404 pour l'US d'un autre) : `POST /api/stories/:id/validate`, `PATCH /api/stories/:id` (modifier), `POST /api/stories/:id/send-back` (corps `{ comment }`), `POST /api/stories/:id/abandon`. Et `POST /api/tickets/:id/abandon` |
| B | Depuis quels statuts ? | **Valider** : `to_validate` ou `to_rewrite` → `ready`, `rewrite_comment` vidé (l'humain qui a renvoyé une US peut changer d'avis ou la corriger lui-même ; la 004 ne prévoyait que `to_validate`). **Modifier** : `to_validate`, `to_rewrite` ou `ready` ; le statut ne change pas. **Renvoyer** : `to_validate` → `to_rewrite`, commentaire obligatoire, gardé dans `rewrite_comment`. **Abandonner** : tout statut sauf `abandoned`. Un autre statut répond **409 `wrong_status`** (entrée `refused`) |
| C | Que modifie « Modifier » ? | Le récit (`as_a`, `i_want`, `so_that`), les notes et **la liste complète des critères** (au moins un), remplacée d'un bloc ; mêmes limites que la 017 B. Les dépendances ne changent pas. Remplacer les critères est sans risque : aucun résultat de critère n'existe avant les runs (7.x), qui fixeront leur propre règle. **Des notes absentes du corps sont gardées** (seule une valeur, même vide, les remplace) |
| D | Et l'abandon d'un ticket ? | `abandoned_at` est rempli, et **ses US non terminées passent `abandoned`** dans la même transaction : aucune US d'un ticket abandonné ne reste prête à développer. Les US `done` restent `done`. Un ticket abandonné ne se rouvre pas, ne se modifie plus et sort de `list_tickets_needing_us` (017 F). Un ticket déjà abandonné répond 409 `ticket_abandoned`. C'est aussi ainsi qu'on clôt un ticket dont Claude n'a jamais fini d'écrire les US (017, limites connues) |
| E | `update_user_story` (Claude) ? | Comme la 004 : `story_id`, `as_a`, `i_want`, `so_that`, `notes_md` facultatives, la liste complète des critères (au moins un). Seulement `to_rewrite` → `to_validate` ; `rewrite_comment` est vidé, les critères remplacés, les dépendances gardées. Refus : `not_found`, `wrong_status` (l'US n'est pas à réécrire ; le texte dit son statut), `ticket_abandoned`, `project_archived`, arguments invalides. `notes_md` absent : les notes sont **gardées** ; une chaîne vide les efface |
| F | Concurrence ? | Chaque action relit l'US **`FOR UPDATE`** (et le ticket pour son abandon) dans sa transaction, après `assertActive` (projet `FOR SHARE`, 014 D) : le statut vérifié est celui qui est changé. Une validation et un renvoi simultanés : l'un passe, l'autre reçoit `wrong_status` |
| G | Comment la table des droits est-elle tenue ? | Par **ce qui n'existe pas** (004) : aucun outil MCP ne valide, ne renvoie, n'abandonne ni ne modifie une US qui n'est pas à réécrire, et aucune route humaine ne crée ni ne réécrit une US à la place de Claude. Un test par ligne de la table de la 004 qui existe à cette tranche, des deux côtés : Claude (l'outil manque → refus `unknown_tool` journalisé, ou l'outil refuse) et l'humain (la route refuse). Les lignes des runs et de GitHub auront leurs tests avec leurs tranches (7.x, 5.x) |
| H | Que garde l'historique ? | `validate_story`, `update_story`, `send_back_story`, `abandon_story` (humain, origine `ui`) et `update_user_story` (Claude, `mcp`), avec `args: { storyId }` et les colonnes `project_id`, `ticket_id`, `story_id`. `abandon_ticket` : `args: { ticketId, abandonedStories }` (un nombre). **Jamais le commentaire de renvoi ni le texte de l'US** (010 D) |
| I | Quel historique sur la page de l'US ? | `GET /api/stories/:id/history` : les entrées **de l'utilisateur** (010 G) qui portent sur cette US (`story_id`), plus la création de son ticket (`create_user_stories` du même `ticket_id`, 017 limites connues) et l'abandon du ticket. **Les lectures (`get_*`, `list_*`, `search`) ne sont pas montrées.** Chaque ligne dit la date, l'action en français, le résultat, et **qui** : « Claude » (acteur `claude`) ou « Toi » (acteur `human`). Section repliée (003, règle 9). Les entrées du ticket ne sont montrées que réussies ; au plus les 100 plus récentes |
| J | Quels écrans ? | Sur `/us/:id` : « Valider », « Modifier » (formulaire sur place : récit, notes, critères qu'on ajoute ou retire), « Renvoyer » (commentaire obligatoire), « Abandonner » (confirmation sur place, 003 règle 4), chacun montré seulement quand le statut le permet, et désactivé sur un projet archivé. Le commentaire de renvoi est affiché tant que l'US est à réécrire. Sur `/tickets/:id` : « Abandonner le ticket », avec confirmation. Erreurs en français, jamais les codes du serveur. Le Journal nomme les nouvelles actions. Le panneau de validation de l'accueil (003, `?valider=`) viendra avec l'accueil. Les confirmations d'abandon **nomment ce qui sera perdu** (003, règle 4) : pour un ticket, le nombre d'US non terminées abandonnées avec lui et qu'il ne se rouvre pas. Après chaque décision, le focus va sur un élément qui existe encore : le statut de l'US (ou « Modifier » après une modification, le bouton qui l'a ouverte), le titre du ticket après son abandon. La page du ticket décide de « Modifier » et « Abandonner le ticket » d'après **`abandonedAt`** (exposé par l'API), pas d'après l'étape : un ticket dont toutes les US sont abandonnées affiche « Abandonné » mais reste à clore |
| K | Et le skill `/write-us` ? | Il traite aussi `stories_to_rewrite` : lire l'US (`get_user_story`) et le commentaire, puis `update_user_story` avec la liste complète des critères, en gardant ce qui allait |

## Ce qui est repoussé

- Modifier les dépendances d'une US : rien ne le demande encore.
- Le panneau de validation et l'accueil (« À toi de jouer ») : leur tranche.
- La publication en issue GitHub à la validation : tranche 4.6.

## Limites connues

- **Modifier une US `ready` ne la renvoie pas en validation** : c'est l'humain qui la modifie, il n'a pas à se valider lui-même.
- **Un ticket abandonné ne se rouvre pas** : on en crée un autre. Rouvrir viendra si le besoin se présente.
