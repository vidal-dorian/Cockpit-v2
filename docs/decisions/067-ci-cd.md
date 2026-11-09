# 067 — L'onglet CI / CD

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit (tranche 12.4)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude ([064](064-tranches-restantes.md) 12.4 A à D)
- **Dépend de** : [012 — La configuration automatique](012-configuration-automatique.md) (D, le manifeste), [026 — Écrire dans un repo](026-ecrire-dans-un-repo.md), [052 — Les constats de GitHub](052-constats-de-github-et-versions.md) (une permission ajoutée après coup), [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md) (le lanceur), [016 — Le serveur MCP](016-serveur-mcp.md)
- **Modifie** : 012 D (le manifeste demande `workflows` en écriture)
- **Tranche** : 12.4 du [découpage](../decoupage.md)
- **Écran** : [S15](../ecrans/S15_CICD.png)

## Contexte

Le brief (§6.10) veut lister les workflows d'un projet, proposer une CI de départ adaptée au repo, et que Claude puisse proposer un changement de workflow, que seul l'humain committe : un workflow s'exécute avec les secrets du repo, et une CD déploie. La 064 a tranché : « Demander à Claude » lance une session cloud qui rend sa proposition par un outil MCP ; la CI de départ vient de modèles du catalogue ; les chiffres viennent de l'API Actions, sans le nombre de tests ; la permission `workflows` s'approuve à la main.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où ? | Un onglet **« CI / CD »** du projet, entre Agents et Historique, sur `/projets/:id/ci` (S15). Phrase d'état : « La CI passe. » si chaque workflow a réussi sa dernière exécution, sinon « `<nom>` échoue depuis N exécutions. » (le premier en échec), « Pas encore de CI. » sans workflow ; en dessous, la phrase du plus ancien en échec s'il y en a plusieurs |
| B | Lire les workflows | `GET /api/projects/:id/workflows`, réservé aux membres, lisible sur un projet archivé, sans entrée d'historique. Cockpit lit la liste des workflows du repo (API Actions) et, pour chacun, ses **10 dernières exécutions sur la branche par défaut**. Il rend pour chacun : `path`, `name`, `event` de la dernière exécution, `lastRun` (`conclusion`, date, adresse) ou `null`, `failingSince` (le nombre d'exécutions en échec d'affilée, de la plus récente), `averageSeconds` (la durée moyenne des exécutions terminées parmi les 10, `null` sans exécution). Une ligne de S15 : ✓ ou ✕, « `<fichier>` · `<nom>` », « sur `<événement>` · N min en moyenne » ou « échoue depuis N exécutions », il y a combien de temps. Pas de nombre de tests (064 12.4 C). GitHub injoignable : 502 |
| C | La CI de départ | Sans aucun fichier dans `.github/workflows/`, l'onglet propose **« Une CI de départ »** : un modèle de `catalog/ci/` choisi d'après les fichiers à la racine, dans cet ordre : `package.json` → `node.yml`, `pyproject.toml` ou `requirements.txt` → `python.yml`, `go.mod` → `go.yml`, `Cargo.toml` → `rust.yml`. Rien de reconnu : « Cockpit ne reconnaît pas le langage de ce repo. » et pas de modèle. Le modèle est montré en entier, puis « Faire le commit » l'écrit dans `.github/workflows/ci.yml` (026 : un commit, refusé si le fichier existe déjà). `POST /api/projects/:id/workflows/starter/apply` avec `{ language }` ; le serveur relit le langage et refuse un autre (409 `wrong_language`). Historique `add_starter_ci` avec `{ language }`. Chaque modèle se lance sur `push` et `pull_request`, installe les dépendances et lance les tests (Node : `npm ci`, `npm test`, puis `lint` et `build` s'ils existent ; Python : les dépendances et `pytest` ; Go : `go build ./...` et `go test ./...` ; Rust : `cargo build` et `cargo test`), avec les versions stables du moment |
| D | La permission `workflows` | Le manifeste (012 D) demande `workflows` en **écriture**. Une installation qui ne l'a pas encore approuvée : « Faire le commit » est grisé avec « Cockpit n'a pas encore le droit d'écrire les workflows. Approuve la nouvelle permission sur GitHub. » et le lien vers l'installation, comme la 052 ; Cockpit lit les permissions de l'installation. Si GitHub refuse quand même l'écriture faute de permission : 409 `workflows_forbidden`, même message |
| E | Claude propose | Un nouvel outil MCP **`propose_workflow_change`** `{ project_id, path, content, reason }` : `path` est un fichier `.github/workflows/<nom>.yml` ou `.yaml` (nom au format des agents), `content` le texte complet proposé (200 000 caractères au plus : un workflow est petit, et le corps d'une requête MCP est borné à 256 Kio), `reason` la raison en une ou deux phrases (2 000 caractères au plus). Cockpit lit le fichier sur GitHub et garde la proposition avec ce texte (`before`, `null` pour un nouveau fichier) ; une proposition identique au fichier est refusée (`no_change`). **Claude ne committe jamais** : l'outil n'écrit rien sur GitHub. Une proposition en attente sur le même fichier est remplacée par la nouvelle. Historique `propose_workflow_change` (acteur Claude), avec `{ path }`. Réservé aux membres du projet, projet actif |
| F | L'humain décide | La section **« Ce que Claude propose · un changement à la fois »** montre la plus ancienne proposition en attente : sa raison, le fichier et le diff, puis **« Faire le commit »** et **« Ignorer »**, et dessous « Cockpit ne modifie un workflow qu'avec ton accord. ». `POST /api/workflow-proposals/:id/commit` écrit `content` avec le `before` gardé (026 : refusé si le fichier a changé depuis, `repo_changed`) ; `POST /api/workflow-proposals/:id/ignore` l'écarte. Historique `commit_workflow_change` et `ignore_workflow_change`. Une proposition traitée ne se traite plus (409 `already_decided`) |
| G | « Demander à Claude » | Sur un workflow en échec, **« Demander à Claude »** lance une session cloud par le lanceur de la 054, sur le repo du projet, avec la consigne : lire les journaux de la dernière exécution en échec de ce workflow, en trouver la cause, appeler `propose_workflow_change` si un changement de workflow la corrige, ne jamais committer ni pousser un workflow, puis finir par `finish_launch` avec un résumé. Les refus du lancement sont ceux de la 054 (pas de lanceur, budget du mois atteint…), dits à côté du bouton. Historique `ask_workflow_help` avec `{ path }` |
| H | La couleur | Le budget de la 045 : le ✕ d'un workflow en échec est la seule chose en rouge ; « Faire le commit » est le seul bouton blanc de la section |

## Ce que le code a précisé (tranche 12.4)

- **Rouge** : une exécution terminée en `failure`, `timed_out` ou `startup_failure`. Une exécution en cours, `cancelled` ou `skipped` est ignorée : elle ne compte ni dans « échoue depuis », ni dans la moyenne, ni comme dernière exécution.
- **Les workflows listés** sont les actifs de `.github/workflows/`. Un workflow sans exécution qui compte affiche « Pas encore d'exécution » ; si aucun n'en a, c'est la phrase d'état (au lieu de « La CI passe. »).
- **La permission (D)** : la permission de l'App elle-même est vérifiée d'abord (une App créée avant la 067 ne l'a pas) : le message renvoie alors aux réglages de l'App, avec `appMissing`. Sinon on regarde l'installation. `workflows_forbidden` se reconnaît au message de GitHub (« without `workflows` permission »), quel que soit le statut, y compris à la création de la branche d'une PR.
- **Une proposition (E)** sur un chemin qui n'est pas un fichier (dossier, lien symbolique) : `not_a_file`. Un index unique partiel garde **une seule proposition en attente par fichier** ; la décision (F) ne s'applique qu'à une proposition encore en attente, donc deux clics simultanés n'en font qu'une, et un commit déjà parti sur GitHub la marque décidée quoi qu'il arrive.
- **(G)** Pas d'abandon au bout de deux heures, contrairement à une routine : rien n'attend dessus. Le bouton n'est montré que pour un chemin que E accepte.

## Ce qui est repoussé

- **Le nombre de tests** en échec (« 2 tests sur 31 ») : il faudrait lire les journaux.
- **Plusieurs propositions à la fois** : une à la fois, la plus ancienne d'abord.
- **Proposer une CD** : seulement une CI de départ.
- **Les workflows d'une autre branche** que la branche par défaut.
