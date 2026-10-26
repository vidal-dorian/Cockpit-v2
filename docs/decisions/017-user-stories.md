# 017 — Claude écrit les user stories

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-26
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [004 — Outils MCP](004-outils-mcp.md), [010 — Historique](010-historique.md), [014 — Tickets](014-tickets.md), [016 — Le serveur MCP](016-serveur-mcp.md)
- **Tranche** : 4.3 du [découpage](../decoupage.md)

## Contexte

Un ticket est une idée brute ; Claude le découpe en user stories (US) que l'humain validera (4.4). Cette tranche crée les US et leurs critères, les trois outils MCP de la 004 qui les écrivent et les lisent, la page d'une US, l'étape calculée du ticket et le skill `/write-us`.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quelles tables ? | Celles de la 002, **réduites à ce que cette tranche remplit ou lit** : `user_stories` (`id`, `ticket_id`, `position`, `as_a`, `i_want`, `so_that`, `notes_md`, `status` avec son `CHECK` à sept valeurs, `rewrite_comment`, `created_at`, `updated_at`), `acceptance_criteria` (`id`, `story_id`, `position`, `given_text`, `when_text`, `then_text`), `story_dependencies` (clé primaire sur le couple, `CHECK` qu'une US ne dépend pas d'elle-même). Clés étrangères en `RESTRICT`. `history` reçoit `story_id`, sans clé étrangère. Les colonnes de branche, de PR, d'issue et de résultat des critères viendront avec leurs tranches (4.6, 7.x) : une colonne toujours vide ne se teste pas |
| B | Quelles limites ? | Validées par zod avant tout travail. `as_a`, `i_want`, `so_that` : texte rogné de 1 à 1 000 caractères. `given`, `when`, `then` : rognés, de 1 à 2 000. `notes_md` : au plus 50 000, gardées telles quelles. De 1 à 20 US par envoi, de 1 à 20 critères par US, au plus 19 positions dans `depends_on`. NUL refusé partout (`noNul`, 014 C). **L'appel entier reste sous 256 Kio** (016) : 20 US aux notes pleines n'y tiennent pas, et le transport répond 413, sans entrée d'historique. La description de l'outil et le skill demandent donc des notes courtes |
| C | Comment s'écrivent les dépendances ? | `depends_on` donne les **positions** d'US précédentes du même envoi, **à partir de 1** (la première US de l'envoi est la position 1, comme la colonne `position`). Une position qui n'est pas strictement antérieure, ou répétée, est un refus d'arguments qui nomme le champ (004) |
| D | Tout ou rien, et deux envois simultanés ? | Une seule transaction (`act`) crée toutes les US, leurs critères et leurs dépendances, au statut `to_validate`. Le ticket est relu **`FOR UPDATE`** dans la transaction, puis on vérifie qu'il n'a aucune US : un deuxième envoi simultané attend le premier, puis est refusé (`ticket_has_stories`). Le projet est relu `FOR SHARE` (`assertActive`, 014 D) |
| E | Quels refus pour `create_user_stories` ? | `not_found` (ticket d'un autre ou inconnu), `ticket_abandoned`, `ticket_has_stories` (un ticket n'est écrit qu'une fois, 004), `project_archived`, `invalid_arguments` (champ vide, US sans critère, dépendance invalide). Chacun laisse une entrée `refused` |
| F | Que rend `list_tickets_needing_us` ? | Deux listes, des projets **non archivés** du membre, tickets **non abandonnés** : `tickets` (sans aucune US : `id`, `project_id`, `project`, `title`, `description_md`) et `stories_to_rewrite` (statut `to_rewrite` : `id`, `ticket_id`, `project_id`, récit et `rewrite_comment`). **Au plus 20** éléments par liste, les plus anciens d'abord : un ticket écrit sort de la liste, l'appel suivant donne les suivants. Rien ne passe une US en `to_rewrite` avant la 4.4 : la seconde liste est vide en usage réel d'ici là. Le `project_id` d'un projet archivé du membre donne deux listes vides, comme `search`, et non un refus |
| G | Que rend `get_user_story` ? | L'US (récit, notes, statut, `rewrite_comment`), ses critères (`id`, position, Given/When/Then), ses dépendances (`id`, statut, « je veux »), son ticket (`id`, titre) et son projet (`id`, nom, branche par défaut, archivé ou non). Branche, PR, résultats des critères et run actif viendront avec leurs tranches. Lisible sur un projet archivé |
| H | Et `search`, `get_ticket`, `get_project` ? | `search` cherche aussi dans le **récit** des US (« en tant que », « je veux », « afin de », mis bout à bout) : chaque mot doit y apparaître. Un résultat d'US : `type: "story"`, `id`, `title` (« je veux »), `project_id`, `ticket_id`, `status`. Toujours 20 résultats au plus en tout. `get_ticket` rend ses US (`id`, position, statut, « je veux »). L'étape de chaque ticket est calculée partout avec ses US |
| I | Comment se calcule l'étape ? | `ticketStep(ticket, statuts de ses US)` applique les règles de la 002 dans leur ordre : `abandoned`, `new`, `in_progress`, `to_validate`, `done`, `in_progress`, `validated`. Libellés : Abandonné, Nouveau, En cours, À valider, Terminé, Validé |
| J | Que devient la suppression d'un ticket ? | La règle 2 de la 002 s'applique : un ticket qui a des US répond **409 `ticket_has_stories`** (entrée `refused`), vérifié dans la transaction avec le ticket relu `FOR UPDATE`, pour qu'un `create_user_stories` simultané ne passe pas entre les deux. La page du ticket ne montre plus « Supprimer » dès qu'il a des US |
| K | Que garde l'historique ? | `create_user_stories` : `args: { ticketId, count }`, colonnes `project_id` et `ticket_id`. `get_user_story` : `args: { storyId }` et la colonne `story_id`. `list_tickets_needing_us` : `args: { projectId }` s'il est donné. Jamais un texte d'US (010 D) |
| L | Quels écrans ? | La page du ticket liste ses US (position, « je veux », statut), chacune menant à `/us/:id`. La page `/us/:id` (chargée à la demande, comme celle du ticket) montre le récit, les notes en markdown (mêmes règles que la description d'un ticket, 014 H : sans HTML brut, sans image distante), les critères Given/When/Then, les dépendances et un lien vers le ticket. Elle ne change rien : valider, renvoyer et abandonner sont la 4.4. Libellés des statuts : à valider, à réécrire, prête, en cours, en revue, terminée, abandonnée. Route `GET /api/stories/:id`, mêmes barrières que celles des tickets |
| M | Où vit le skill `/write-us` ? | Dans `catalog/skills/write-us/SKILL.md`, le premier fichier du catalogue de Cockpit. La tranche 6.2 saura l'installer dans un repo ; d'ici là, on le copie à la main dans `.claude/skills/` du repo. Il s'appuie sur `list_tickets_needing_us`, `get_project`, `get_ticket` et `create_user_stories` ; la réécriture (`update_user_story`) s'y ajoutera en 4.4. Un test vérifie que chaque outil qu'il nomme existe |

## Ce qui est repoussé

- Valider, modifier, renvoyer et abandonner une US, `update_user_story` et l'historique de l'US : tranche 4.4.
- Les colonnes de branche, de PR, d'issue, de résultat des critères et le run actif de `get_user_story` : tranches 4.6 et 7.x.
- L'installation du skill dans un repo : tranche 6.2.

## Limites connues

- **`story_id` n'est pas rempli sur l'entrée `create_user_stories`** : un envoi crée plusieurs US, et une entrée n'a qu'un `story_id`. L'historique d'une US (4.4) retrouvera sa création par son ticket.
