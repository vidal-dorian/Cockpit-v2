# 033 — Le run minimal

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md) (runs), [004 — Outils MCP](004-outils-mcp.md) (Développer), [001 — Stack](001-stack.md) (SSE minimal), [016 — Le serveur MCP](016-serveur-mcp.md), [029 — Équipe d'agents](029-equipe-d-agents.md) (B : nom d'agent)
- **Modifie** : la [004](004-outils-mcp.md), le temps des tranches 7.1 et 7.2 seulement (D : `finish_run` accepte `succeeded` sans PR, faute de pouvoir en lier une) et sur la réponse de `start_run` (B : l'US réduite)
- **Modifiée par** : [035 — Critères et PR](035-criteres-et-pr.md) (fin de l'écart D)
- **Tranche** : 7.1 du [découpage](../decoupage.md)

## Contexte

La 004 a fixé `start_run`, `report_step` et `finish_run` ; la 002, les tables `runs` et `run_steps` ; la 001, un SSE qui dit seulement « tel objet a changé ». Démo : depuis une session Claude Code, un run démarre et ses étapes s'affichent en direct dans Cockpit. Il reste à dire ce que la tranche ajoute à la base, ce que disent les outils dans les cas que la 004 laisse ouverts, et comment la page suit le run.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La base ? | Tables **`runs`** et **`run_steps`** de la 002 : `runs.status` ∈ `running`, `succeeded`, `failed`, `stopped`, `closed_manually` (`CHECK`), **index unique sur `story_id` où `status = 'running'`** ; `run_steps.status` ∈ `running`, `succeeded`, `failed` (`CHECK`). Colonne **`user_stories.branch`** (texte, vide tant qu'aucun run n'a démarré) et colonne **`history.run_id`** (sans clé étrangère, comme les autres, 010). `pr_number` et les résultats des critères viennent avec la 7.3 |
| B | `start_run` ? | Comme la 004. `branch` : 1 à 255 caractères parmi `A-Z a-z 0-9 . _ / -`, sans `..`, sans `/` ni `-` au début, sans `/` ni `.` à la fin (des caractères sûrs ; Cockpit ne fait que garder et afficher la branche, `/dev-us` la crée avec Git) ; `model` : 1 à 100 caractères ; `comment` : au plus 10 000. Refus : `wrong_status` (US qui n'est pas `ready`), `run_active` (l'index unique, filet de sécurité : l'US est verrouillée, un deuxième `start_run` simultané reçoit `wrong_status`), `branch_mismatch` (une autre branche est déjà enregistrée sur l'US), `project_archived`, `not_found`. Rend `run_id`, l'US réduite (`id`, `status`, `branch`, `active_run_id`) et ses critères, comme `update_user_story` : le skill a déjà lu l'US entière avec `get_user_story` (**écart à la 004**, qui la rendait entière). Les textes libres (`model`, `comment`, les résumés) refusent le caractère NUL, comme les autres. Une issue publiée (020) est resynchronisée après le changement de statut, au démarrage comme à la fin |
| C | `report_step` ? | Comme la 004. `agent` : le format d'un nom d'agent (029 B). `started` alors qu'une étape de cet agent est déjà ouverte : refus `step_open` ; `finished` sans étape ouverte : refus `no_open_step`. Une étape refaite (la boucle de la relecture, 029 B) est une **nouvelle ligne**. `summary` : au plus 10 000 caractères. Rend `{ step_id, stop_requested }` ; `stop_requested` vaut toujours `false` jusqu'à la 7.5, qui permet de demander l'arrêt |
| D | `finish_run` ? | `outcome` (`succeeded` ou `failed`) et `summary` (1 à 10 000 caractères). Les étapes encore ouvertes sont closes `failed` : rien ne reste « en cours » sur un run fini. L'US encore `in_progress` redevient `ready` (004). **Écart à la 004** : le refus « `succeeded` sans PR liée » arrive avec `link_pull_request` (7.3) ; d'ici là, `succeeded` est accepté, sinon aucun run ne pourrait réussir |
| E | Les refus communs ? | Un run d'un autre utilisateur, ou introuvable : `not_found` (004). Run qui n'est pas `running` : `run_finished`. Projet archivé : `project_archived` (004, écritures refusées). L'entrée du journal porte `project_id`, `ticket_id`, `story_id` et `run_id` dès qu'ils sont connus (004, Journal) |
| F | `get_user_story` ? | Rend en plus **`branch`** (ou `null`) et **`active_run_id`** (ou `null`), comme le prévoyait la 004 |
| G | Le temps réel ? | **`GET /api/events`** : un flux SSE par onglet, pour l'utilisateur de la session (401 sinon). Chaque événement est `change` avec pour seule donnée la clé de l'objet changé (`run:12`, `story:42`) ; le navigateur recharge par l'API normale (001). Un commentaire toutes les 25 secondes garde la connexion ouverte derrière Cloudflare. Les événements partent **après** la transaction, vers les membres du projet. Les abonnés sont **en mémoire** (une seule instance, 008) |
| H | La lecture ? | **`GET /api/runs/:id`** : le run (statut, branche, modèle, commentaire, résumé, début, fin), ses étapes dans l'ordre (agent, statut, résumé, début, fin), son US (`id`, « je veux ») et son projet (`id`, nom) ; tout membre du projet peut le lire, 404 pour un non-membre (les outils, eux, ne touchent qu'aux runs de leur utilisateur, E). **`GET /api/stories/:id`** rend en plus `runs` : les runs de l'US, le plus récent d'abord (`id`, statut, début, fin) |
| I | L'écran ? | Page **`/runs/:id`** (003) : « Run n° 12 », l'US en lien, le statut en clair (En cours, Réussi, Échoué, Arrêté, Fermé à la main), branche, modèle, consigne, puis les étapes (agent, état, résumé, durée), et le résumé à la fin. Elle se recharge à chaque `change` de `run:<id>`. La page de l'US liste ses runs, chacun menant à sa page, et se recharge à chaque `change` de `story:<id>` |
| J | L'historique ? | Les trois outils laissent leur entrée MCP (016). Le journal : « Run démarré », « Étape signalée », « Run terminé » |
| K | Le skill ? | `/dev-us` du catalogue (027) appelle `start_run` une fois la branche prête (avec le modèle de la session), `report_step` avant et après chaque étape, et `finish_run` à la fin : `succeeded` une fois la PR ouverte, `failed` s'il s'arrête sur un échec. Un repo déjà préparé garde son ancien skill (027, « repoussé ») |

## Ce qui est repoussé

- **Demander l'arrêt, relancer, fermer un run muet** : 7.5. `stop_requested_at` existe, rien ne le remplit encore.
- **Critères et PR** (`report_criterion`, `link_pull_request`, `pr_number`) : 7.3.
- **Les runs dans l'accueil** (« Claude travaille ») : 8.1.
- **Plusieurs instances** : les abonnés SSE passeront par `LISTEN` / `NOTIFY` (008).

## Limites connues

- **Un run sans `finish_run`** (session fermée, PC éteint) reste « En cours » et bloque un nouveau run sur l'US jusqu'à la fermeture à la main (7.5).
- **Un événement manqué** (connexion coupée) n'est pas rejoué : `EventSource` se reconnecte seul, mais la page n'est rechargée qu'au prochain événement ou à la prochaine visite.
- **D (`succeeded` sans PR)** : un run « réussi » de la 7.1 ne prouve pas qu'une PR existe.
