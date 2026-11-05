# 037 — Arrêter, relancer, fermer un run

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [004 — Outils MCP](004-outils-mcp.md) (`stop_requested`, `finish_run`, la table des droits, point ouvert 1), [002 — Modèle de données](002-modele-donnees.md) (`stop_requested_at`, `stopped`, `closed_manually`), [033](033-run-minimal.md), [035](035-criteres-et-pr.md), [036](036-questions-de-claude.md), [034](034-developper-avec-claude.md)
- **Modifie** : la [004](004-outils-mcp.md), point ouvert 1, tranché (E) ; la table des droits gagne `in_review` → `in_progress` par `start_run` et le retour à `in_review` d'un run qui ne réussit pas
- **Modifiée par** : [038 — Le suivi de la PR](038-suivi-de-la-pr.md) (lève la limite d'un `pr_number` resté d'une PR fermée)
- **Tranche** : 7.5 du [découpage](../decoupage.md)

## Contexte

La 004 et la 002 ont fixé l'essentiel : l'arrêt est **demandé** par l'humain et **lu** par Claude à la prochaine étape (`stop_requested`) ; un run arrêté qui ne réussit pas est noté `stopped` ; un run muet se ferme à la main (`closed_manually`) et son US redevient `ready`. Démo : je demande l'arrêt, Claude s'arrête à l'étape suivante. Il reste à dire les routes, l'écran, la relance, et à trancher la relance d'une US en revue.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Demander l'arrêt ? | **`POST /api/runs/:id/stop`** (membre du projet), dans un `act` : remplit `stop_requested_at`. 409 `run_finished`, `stop_already_requested`, `project_archived` ; 404 pour un non-membre. Entrée `request_stop`. Dès lors, `report_step` et `get_answer` rendent **`stop_requested: true`** ; `finish_run` note `stopped` un run arrêté qui ne réussit pas (004) |
| B | Fermer à la main ? | **`POST /api/runs/:id/close`** (membre), dans un `act` : le run `running` passe `closed_manually` avec sa fin, ses étapes ouvertes sont closes `failed`, et son US quitte `in_progress` (règle de D). 409 `run_finished`, `project_archived` ; 404. Entrée `close_run`. C'est l'humain qui juge qu'un run est muet : rien ne le détecte. Ensuite, les outils de Claude sur ce run sont refusés `run_finished` |
| C | Où va l'US d'un run qui ne réussit pas ? | Pour `finish_run` (`failed`, ou `stopped`) comme pour la fermeture : une US encore `in_progress` revient à **`in_review` si elle a une PR liée** (`pr_number`), sinon à `ready`. Une PR ouverte reste en revue : le run de relance n'a pas réussi, la PR d'avant est toujours là |
| D | Relancer ? | Rien de nouveau : la fenêtre « Développer avec Claude » (034) reprend la branche de l'US et prend le prompt complémentaire, qui devient le `comment` du run (034 I). La page d'un run fini offre un lien **« Relancer »** vers la page de l'US, quand l'US peut être relancée (E) |
| E | Une US en revue (point ouvert 1 de la 004) ? | **`start_run` accepte aussi une US `in_review`**, sur sa branche : elle passe `in_progress`, et garde sa PR. La fenêtre de la 034 s'ouvre donc aussi pour une US `in_review`. Le skill pousse sur la même branche, puis rappelle `link_pull_request` avec le même numéro, ce qui la remet `in_review` ; `finish_run` `succeeded` reste possible, puisque la PR est liée (035 D) |
| F | L'écran ? | Sur la page d'un run `running` : **« Demander l'arrêt »**, puis « Arrêt demandé : Claude s'arrêtera à la prochaine étape. » ; et **« Fermer le run »**, qui demande confirmation (« Confirmer la fermeture », comme les suppressions de la 030) en disant que Claude ne pourra plus rien y signaler. Sur la page d'un run fini : « Relancer » (D). Rechargement sur `change` (033 G) |
| G | L'historique et le temps réel ? | Entrées `request_stop` et `close_run` (acteur humain, `run_id`) ; journal : « Arrêt demandé », « Run fermé à la main ». Les deux routes envoient `change` `run:<id>` et `story:<id>` après la transaction ; la fermeture resynchronise l'issue si l'US a changé de statut (020) |
| H | Le skill ? | `/dev-us` du catalogue : dès que `report_step` ou `get_answer` rend `stop_requested: true`, il appelle `finish_run` `failed` avec « Arrêt demandé par l'utilisateur » et s'arrête, sans rien pousser de plus. Pour une US `in_review`, il ne rouvre pas de PR : il pousse sur la branche et rappelle `link_pull_request` avec le `pr_number` de l'US |

## Ce qui est repoussé

- **La relance automatique** sur une CI rouge (004, après le MVP) : la relance reste humaine.
- **Détecter un run muet** (pas d'appel depuis longtemps) : l'humain voit les heures des étapes et ferme lui-même.
- **Annuler une demande d'arrêt** : on relance plutôt.

## Limites connues

- **L'arrêt n'est lu qu'à la prochaine étape** ou au prochain passage de `get_answer` : un agent long ne s'arrête pas au milieu.
- **Une PR fermée sur GitHub** laisse `pr_number` sur l'US jusqu'à la 7.6 (035, limites) : C la renverrait à tort en revue.
