# 035 — Critères et PR

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [004 — Outils MCP](004-outils-mcp.md) (`report_criterion`, `link_pull_request`, `finish_run`), [002 — Modèle de données](002-modele-donnees.md) (le résultat d'un critère est le dernier compte rendu), [033 — Le run minimal](033-run-minimal.md), [020 — Issues GitHub](020-issues-github.md)
- **Modifie** : la [033](033-run-minimal.md) D, qui prend fin : `finish_run` refuse de nouveau `succeeded` sans PR liée, comme le voulait la 004
- **Tranche** : 7.3 du [découpage](../decoupage.md)

## Contexte

La 004 a fixé `report_criterion` et `link_pull_request` ; la 002, le résultat sur le critère avec le run qui l'a donné, et le numéro de PR sur l'US. Démo : à la fin du run, chaque critère a son résultat et la PR est liée. Il reste à dire ce que la base reçoit, comment la PR est vérifiée et ce que montrent les pages.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La base ? | Sur `acceptance_criteria` : **`result`** (`passed`, `failed` ou vide, `CHECK`), **`evidence`** (texte) et **`result_run_id`** (clé étrangère vers `runs`). Sur `user_stories` : **`pr_number`**. L'état de la CI et de la revue viennent avec la 7.6 |
| B | `report_criterion` ? | Comme la 004 : `result` et `evidence` (1 à 10 000 caractères, sans NUL) **remplacent** le compte rendu précédent du critère, avec ce run (002, décision 3). Refus : `run_finished`, `project_archived`, `not_found` (run d'un autre), **`wrong_criterion`** (le critère n'est pas de l'US du run). Rend `{ criterion_id, result }` |
| C | `link_pull_request` ? | **Lit la PR sur GitHub avant la transaction** (`GET /repos/{owner}/{repo}/pulls/{n}`, comme l'App), puis, dans la transaction, vérifie le run et l'US. Refus : **`pr_not_found`** (404), **`pr_wrong_branch`** (sa branche n'est pas celle de l'US, ou elle part d'un fork), `wrong_status` (US qui n'est pas `in_progress`), `run_finished`, `project_archived`, `not_found`. GitHub injoignable : erreur, à réessayer (004). Enregistre `pr_number` (une PR déjà liée est remplacée : après une PR fermée, la relance en ouvre une autre) et passe l'US à `in_review`, puis resynchronise l'issue (020), comme `start_run` (033 B). Rend `{ pr_number, story_status }` |
| D | `finish_run` ? | Fin de l'écart de la 033 D : `succeeded` sans `pr_number` sur l'US est refusé **`no_pull_request`**. L'US `in_review` le reste ; seule une US encore `in_progress` redevient `ready` (004) |
| E | Les lectures ? | `get_user_story` rend `pr_number`, et pour chaque critère `result` et `evidence` (004). `GET /api/stories/:id` rend `story.prNumber` et, sur chaque critère, `result`, `evidence`, `resultRunId`. `GET /api/runs/:id` rend les critères de l'US avec le résultat **donné par ce run** (vide sinon) |
| F | Les écrans ? | Sur la page du run, une section « Critères » : chaque Given/When/Then avec « Réussi », « Échoué » ou « Non signalé dans ce run », et sa preuve. Sur la page de l'US, le résultat et la preuve sous chaque critère, et la PR en lien (`https://github.com/<full_name>/pull/<n>`, « PR n° 12 »). Les deux pages se rechargent sur `change` (033 G) |
| G | L'historique ? | L'entrée MCP de chaque appel (016), avec `run_id`. Le journal : « Critère signalé », « PR liée » |
| H | Le skill ? | `/dev-us` du catalogue (027), dans « Finish » : après les vérifications, un `report_criterion` par critère, avec pour preuve le test qui le prouve ; une fois la PR ouverte, `link_pull_request` avec son numéro, puis `finish_run` `succeeded` |

## Ce qui est repoussé

- **L'état de la CI et de la revue de la PR**, les webhooks qui le tiennent à jour, et une PR mergée ou fermée : 7.6.
- **Le verdict** « acceptable » ou « à vérifier » : 7.7.
- **Les résultats des runs précédents** : seul le dernier compte rendu est gardé, les autres restent dans l'historique (002, décision 3).

## Limites connues

- **Une PR liée puis fermée sur GitHub** reste liée tant que la 7.6 ne suit pas les webhooks.
- **Un `pr_number` resté d'une PR fermée** suffirait à `finish_run` `succeeded` : rien ne ramène encore une US `in_review` à `ready`. À régler avec la 7.6, qui le fera (vider `pr_number` au `start_run`, ou exiger `in_review`).
- **La preuve est déclarée par Claude** : Cockpit ne relance pas le test. Le verdict de la 7.7 la croisera avec la CI.
