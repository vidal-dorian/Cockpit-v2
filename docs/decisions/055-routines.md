# 055 — Les routines

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md) (le lanceur, `get_launch`, `instructions`), [022 — Programmer l'écriture des US](022-routine-ecriture-us.md) (le planning tenu par Cockpit, `nextOccurrence`, la passe de chaque minute), [010 — Historique](010-historique.md)
- **Tranche** : 14.2 du [découpage](../decoupage.md)
- **Écrans** : [S32](../ecrans/S32_TachesProgrammees.png)

## Contexte

Brief §6.14 : une routine a un nom, une consigne (texte libre ou skill), des agents, des projets et une planification ; on la crée, la modifie, la met en pause, la supprime et la lance tout de suite ; Cockpit tient le planning et un lanceur cloud exécute chaque passage. Démo : « Je programme une routine de mon choix, elle se lance à l'heure dite ».

Le 2026-11-08, Dorian a choisi que les routines passent **par le même lanceur** que la 054 : aucune tâche de plus sur claude.ai, et le texte envoyé reste `launch_id: <id>`. La consigne de la routine, écrite par l'utilisateur dans Cockpit, est relue par Claude dans `get_launch` : elle ne voyage jamais dans `/fire`.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Une routine ? | Table **`routines`** : `user_id`, `name` (1 à 100 caractères), `instruction` (la consigne, 1 à 10 000 caractères : du texte libre, ou un skill comme `/write-us`), `agents` (0 à 10 noms d'agents de `.claude/agents/`, au format d'un nom d'agent), `project_ids` (1 projet au moins, chacun dont l'utilisateur est membre et **coché dans le lanceur**, 054 D), la planification (`on_demand`, `daily` à une heure, `weekly` un jour et une heure, fuseau du navigateur : les règles de la 022 D), `next_run_at`, `paused_at`, et le dernier passage (`last_launch_id`). Le modèle est celui de la tâche (054) : il n'est pas choisi par routine |
| B | Le passage ? | La passe de chaque minute de la 022 E lance les routines dues, non en pause, **réservées** en avançant `next_run_at` dans la même requête. **Un seul passage à la fois par utilisateur** : une routine due pendant qu'un autre passage de ses routines tourne attend la minute suivante. Un passage est un lancement : une ligne de `cloud_launches` avec `routine_id` (colonne ajoutée ; `project_id`, `story_id` et `branch` deviennent facultatifs, et une contrainte veut soit une US, soit une routine), puis `/fire` avec `launch_id: <id>`, comme la 054 E (« à reconnecter » sur `401`, `403`, `404`). Sans lanceur relié ou à reconnecter, rien n'est lancé et le passage est noté « non lancé » |
| C | Ce que Claude lit ? | `get_launch` d'une routine rend `kind: "routine"`, `projects` (`id`, `full_name`, `default_branch`) et les `instructions` : « Run the routine "<nom>" of the user in the repositories <liste>: <consigne>. Use the agents <liste> of .claude/agents. When done, call finish_launch. » La consigne est le texte de l'utilisateur lui-même, écrit dans Cockpit : c'est sa demande. La consigne fixe de la tâche (054 B) ne change pas |
| D | La fin d'un passage ? | Colonnes `finished_at`, `outcome` (`succeeded`, `failed`) et `summary` de `cloud_launches`. Nouvel outil MCP **`finish_launch`** `{ launch_id, outcome: succeeded \| failed, summary }` (résumé de 2 000 caractères au plus), au propriétaire du lancement, une seule fois (`launch_finished` sinon), refusé sur un lancement d'US (`not_a_routine` : une US finit par `finish_run`). Un passage sans `finish_launch` **2 heures** après son lancement compte en échec (« sans nouvelles »), et libère la place (B) |
| E | Ce qu'une routine ne peut pas faire ? | **Aucun outil MCP ne crée, ne modifie, ne met en pause ni ne lance une routine** : un passage ne peut donc modifier aucune routine (brief §6.14, protection contre une consigne glissée dans un ticket). Les routines créées par Claude sont repoussées |
| F | L'écran ? | Page **« Tâches programmées »** (S32, `/claude/taches`, nouvelle entrée « Claude » de la barre latérale, qui y mène jusqu'à la page des runs de la 14.3) : la phrase d'état (« N tâches de Claude tournent sans toi »), **« Tes tâches »** (l'écriture des US de la 022 en lecture, avec un lien vers ses réglages, puis chaque routine : nom, planning, projets, dernier passage), **« Prochains lancements »** dans l'ordre, et « + Nouvelle tâche ». Le panneau de droite d'une routine : nom, consigne, quand, projets (les projets cochés dans le lanceur), agents, « Dernier lancement : … · voir la session ↗ », **« Lancer maintenant »**, **« Mettre en pause »** / « Reprendre », « Supprimer ». Sans lanceur : un lien vers Réglages |
| G | Les routes ? | `GET /api/routines`, `POST /api/routines`, `PUT /api/routines/:id`, `DELETE /api/routines/:id`, `POST /api/routines/:id/pause` et `/resume`, `POST /api/routines/:id/run` (409 `launcher_not_connected`, `launcher_needs_reconnect`, `routine_running`, `project_not_in_launcher` ; 502 `fire_failed`). Une routine d'un autre utilisateur est introuvable |
| H | L'historique ? | `save_routine`, `delete_routine`, `pause_routine`, `resume_routine` (`args: { routineId }`), `fire_routine` (acteur `system` ou `human`, `args: { routineId, launchId, sessionId }`, `ok` ou `error`), `finish_launch` (acteur `claude`, `args: { launchId, outcome }`). Jamais la consigne. Journal : « Routine enregistrée », « Routine supprimée », « Routine en pause », « Routine reprise », « Routine lancée », « Passage fini » |

## Ce qui est repoussé

- **Les routines créées par Claude** (naissant en pause) : pas demandées par la démo ; E garde la porte fermée.
- **Un modèle par routine** : la tâche n'en a qu'un (054).
- **Des modèles prêts à l'emploi** : l'écriture des US reste la 022.

## Limites connues

- Mêmes limites que la 054 : `/fire` en préversion, tous les repos de la tâche clonés à chaque passage.
- **Le résultat d'un passage est celui que Claude déclare** (`finish_launch`) ; un passage muet compte en échec après 2 heures.
