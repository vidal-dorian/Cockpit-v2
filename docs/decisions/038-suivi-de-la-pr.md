# 038 — Le suivi de la PR

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [004 — Outils MCP](004-outils-mcp.md) (la table des droits : seul GitHub termine une US), [002 — Modèle de données](002-modele-donnees.md) (`pr_ci_state`, `pr_review_state`, copies de cache), [024](024-webhooks.md) et [025](025-issue-modifiee-sur-github.md) (livraisons enregistrées puis traitées), [020](020-issues-github.md), [012](012-configuration-automatique.md) (les événements de l'App), [035](035-criteres-et-pr.md), [037](037-arreter-relancer-fermer.md)
- **Modifie** : la [012](012-configuration-automatique.md) : l'App s'abonne aussi à `pull_request_review` ; et lève les limites de la 035 et de la 037 sur un `pr_number` resté d'une PR fermée
- **Tranche** : 7.6 du [découpage](../decoupage.md)

## Contexte

La table des droits (004) ne laisse qu'à GitHub deux transitions : une PR mergée termine l'US, une PR fermée sans merge la rend `ready`. La 002 garde l'état de la CI et de la revue en cache sur l'US. Les livraisons de webhooks sont déjà enregistrées puis traitées une à une (024, 025). Démo : je merge sur GitHub, et l'US passe « terminée » toute seule.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La base ? | Sur `user_stories` : **`pr_ci_state`** (`pending`, `success`, `failure`, ou vide quand la PR n'a aucune vérification) et **`pr_review_state`** (`approved`, `changes_requested`, ou vide), avec leur `CHECK` |
| B | Un seul chemin ? | **Une fonction relit la PR sur GitHub**, comme l'App, et met l'US à jour : `GET /pulls/{n}` (état, mergée, commit de tête), les check runs de ce commit, les revues. Les webhooks ne font que dire quelle PR relire ; le bouton « Actualiser » appelle la même fonction. On ne dépend ni de l'ordre ni du contenu des livraisons |
| C | Quels événements ? | `pull_request` (toutes actions), `check_suite` (la liste `pull_requests` de la livraison) et **`pull_request_review`**, ajouté aux événements de l'App (012). Le projet vient du repo de la livraison (025), l'US de son `pr_number` dans ce projet, pour une US `in_review` ou `in_progress`. Rien ne correspond : la livraison est traitée sans rien faire |
| D | Les transitions ? | **Mergée** : l'US `in_review` ou `in_progress` passe **`done`**, entrée `pull_request_merged`. **Fermée sans merge** : l'US `in_review` passe **`ready`** ; `pr_number` et les deux états sont vidés, entrée `pull_request_closed` ; une US `in_progress` (une relance en cours) garde son statut, mais perd sa PR, ce que la règle C de la 037 suivra. Acteur `github`, origine `webhook` ou `ui` (le bouton). L'issue est resynchronisée (020) |
| E | La CI ? | Les check runs du commit de tête : aucun → vide ; l'un en file ou en cours → `pending` ; l'un en `failure`, `timed_out`, `cancelled`, `action_required` ou `startup_failure` → `failure` ; sinon `success`. Les anciens statuts de commit (API *statuses*) sont ignorés |
| F | La revue ? | La dernière revue de chaque relecteur, sans les simples commentaires : l'une demande des modifications → `changes_requested` ; sinon l'une approuve → `approved` ; sinon vide. Pas d'entrée dans l'historique pour ces copies de cache |
| G | Le bouton ? | **`POST /api/stories/:id/pr/refresh`** (membre ; 409 `no_pull_request` sans `pr_number`, 404, 502 si GitHub échoue) rend l'US relue. Sur la page de l'US, un **bloc « GitHub »** : « PR n° 12 » en lien, l'état (« Ouverte », « Mergée », « Fermée »), la CI (« En cours », « Réussie », « En échec », « Aucune »), la revue (« Approuvée », « Modifications demandées », « En attente ») et **« Actualiser »** |
| H | Le temps réel et le journal ? | `change` `story:<id>` après chaque mise à jour. Journal : « PR mergée », « PR fermée sans merge » |

## Ce qui est repoussé

- **Une PR rouverte** après sa fermeture : l'US, `ready` et sans PR, n'est pas reliée de nouveau ; la relance en lie une (035 C).
- **Les anciens statuts de commit** et une CI hors GitHub qui ne publie pas de check runs.
- **Plus de 100 check runs ou de 100 revues** : seule la première page est lue.
- **Le verdict** (7.7) et la CI dans l'accueil (8.1).

## Limites connues

- **Une App créée avant cette tranche** n'est pas abonnée à `pull_request_review` : l'administrateur coche l'événement dans les réglages de l'App sur GitHub ; d'ici là, la revue ne se met à jour qu'avec « Actualiser » ou au prochain événement `pull_request`.
- **Chaque livraison coûte trois lectures** à l'API de GitHub (la PR, les check runs, les revues).
