# 058 — La file d'attente

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md) (le lanceur, `launchCloud`), [056 — Les routines](056-routines.md) (la passe de chaque minute), [033](033-run-minimal.md) et [037](037-arreter-relancer-fermer.md) (fin et fermeture d'un run), [040 — L'accueil](040-accueil.md)
- **Modifiée par** : [094 — PR à ouvrir](094-pr-a-ouvrir.md) : un run `pr_to_open` ne met pas la file en pause (F)
- **Tranche** : 14.3 du [découpage](../decoupage.md)
- **Écrans** : [S28](../ecrans/S28_Claude_Runs.png)

## Contexte

Brief §6.15 : l'humain met des US prêtes en file, dans un ordre qu'il peut changer ; Cockpit les lance une par une, en sautant celles qui attendent une dépendance (et en disant pourquoi) ; la file se met en pause ; un échec la met en pause. Démo : « Trois US en file, la suivante démarre quand la précédente est finie ».

Cockpit lance par le lanceur de la 054 : chaque US a **sa propre session cloud**. Le brief demande d'« enchaîner les US d'un même projet dans la même conversation Claude » : ce n'est pas possible avec `/fire`, qui ouvre une session à chaque lancement. S28 dit « une à la fois par projet » ; **le brief (« une par une ») l'emporte** : une seule US de la file à la fois **par utilisateur**, ce qui use moins l'abonnement et prépare la nuit (14.6).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La file ? | Table **`queue_items`** : `user_id`, `story_id` (unique : une US n'est qu'une fois en file), `position`, `added_at`. Colonnes `users.queue_paused_at` et `users.queue_paused_reason` (texte fermé, voir E). Une file par utilisateur |
| B | Ajouter, retirer, ordonner ? | `GET /api/queue` (`{ paused, pausedReason, items: [{ storyId, iWant, projectId, projectName, waiting }] }`, dans l'ordre ; `waiting` dit pourquoi une US est sautée : `not_ready` ou `dependency` avec l'US attendue, sinon `null`). `POST /api/queue` `{ storyId }` : une US `ready` d'un projet actif, coché dans le lanceur (054 D) ; refus 409 `already_queued`, `wrong_status`, `project_not_in_launcher`, `project_archived` ; elle va en fin de file. `DELETE /api/queue/:storyId`. `PUT /api/queue` `{ storyIds }` : le nouvel ordre, exactement les US de la file (400 sinon). `POST /api/queue/pause` et `/resume` |
| C | Lancer ? | La passe de chaque minute (022 E, 056 B), et aussitôt après qu'un run de la file finit (`finish_run`, fermeture 037 B) : pour chaque utilisateur dont la file n'est pas en pause et qui n'a **aucun lancement de la file en cours**, Cockpit prend la première US qui n'est pas sautée et la lance par `launchCloud` (054 E), sur sa branche si elle en a une, sinon `us/<id>-<titre court>` (la règle de la 034, une seule fonction pour la fenêtre et la file), sans équipe ni consigne. Le lancement est marqué `cloud_launches.from_queue`. Lancée, l'US **sort de la file**. Un lancement de la file est « en cours » tant que son run tourne, ou, sans run, tant qu'il a moins de 15 minutes et ni signalement ni échec |
| D | Sauter ? | Une US qui n'est plus `ready` (lancée à la main, renvoyée), d'un projet archivé, ou qui a un lancement en attente de son run (la règle `launch_pending` de 054 E) est **sautée** et affichée « pas prête » (`not_ready`) ; une US dont une dépendance n'est pas `done` l'est aussi (`dependency`). Elle reste en file avec sa raison (B), et la suivante part. Elle repart d'elle-même quand la raison tombe |
| E | Une pause ? | La file se met en pause, avec sa raison, quand un lancement de la file échoue (`fire_failed`, « à reconnecter »), qu'un run de la file finit `failed` ou est arrêté ou fermé à la main, ou qu'un lancement reste 15 minutes sans run (la session n'a pas démarré) : `launch_failed`, `run_failed`, `no_session`. « Reprendre » vide la raison. Le lanceur à reconnecter met aussi la file en pause (`launch_failed`) |
| F | L'écran ? | La page **« Claude »** (S28, `/claude` ; ses données viennent de `GET /api/claude`, `claudeRoutes` de `home.ts` : questions, runs en cours, finis aujourd'hui, US prêtes à mettre en file ; et de `GET /api/queue`), l'entrée « Claude » de la barre latérale ; « Tâches programmées » (056) devient un lien de cette page) : la phrase d'état (« Claude travaille sur N runs. »), **« Maintenant »** (les questions en attente, « Répondre » mène au run), **« En cours »** (les runs qui tournent, avec leur étape et « cloud » ou « ce PC »), **« File d'attente »** (une ligne par US : titre, projet, raison si elle est sautée ; ↑ ↓ ✕ ; « + Ajouter une US » parmi les US prêtes des projets cochés ; « Mettre en pause » / « Reprendre », et la raison d'une pause), **« Finis aujourd'hui »** (les runs finis depuis minuit, avec leur verdict). Dans « Développer avec Claude », en cible cloud, **« Mettre en file »** à côté de « Lancer dans le cloud » |
| G | L'historique ? | `queue_story`, `unqueue_story` (`args: { storyId }`), `reorder_queue` et `pause_queue`, `resume_queue` (`args: {}`), `launch_story` (054 J) avec l'acteur `system` pour un lancement de la file, `pause_queue` (acteur `system`, `detail: { reason }`) pour une pause d'office. Journal : « US mise en file », « US retirée de la file », « File réordonnée », « File en pause », « File reprise » |

## Ce qui est repoussé

- **Enchaîner dans la même conversation** : impossible avec `/fire` (une session par lancement).
- **Plusieurs US de la file en parallèle** (une par projet, S28) : à reprendre si une à la fois est trop lent.
- **Le plafond de budget par défaut** des runs que Cockpit lance seul (brief §6.15) : la 14.5.

## Limites connues

- Celles de la 054 : `/fire` en préversion, un seul modèle, tous les repos clonés à chaque US.
- **Une US de la file ne démarre pas avant la minute suivante** quand la précédente finit par fermeture d'office (C ne réagit qu'à `finish_run` et à la fermeture).
