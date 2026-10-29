# 020 — La publication d'une US en issue GitHub

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-29
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [009 — Connexion à GitHub](009-connexion-github.md), [010 — Historique](010-historique.md), [012 — Configuration automatique](012-configuration-automatique.md), [018 — Les décisions humaines](018-decisions-humaines.md)
- **Tranche** : 4.6 du [découpage](../decoupage.md)

## Contexte

Le brief (§6.3) veut que chaque US validée devienne une issue du repo, générée par Cockpit à partir d'un gabarit unique et tenue à jour : contenu, label de statut, ouverture et fermeture. L'US se modifie dans Cockpit, pas sur GitHub ; une modification faite sur GitHub sera signalée en 5.2. L'App demande déjà l'écriture sur les issues depuis sa création (012 D) : aucune permission nouvelle n'est à accepter.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quand une US a-t-elle une issue ? | À sa **validation** (`ready`). Une US à valider ou à réécrire n'est pas publiée : elle n'est pas encore décidée. Ensuite, l'issue suit l'US jusqu'au bout |
| B | Le gabarit ? | **Titre** : le « je veux » de l'US. **Corps** (markdown, en français) : le récit (« En tant que … je veux … afin de … »), le statut, les notes, les critères en cases à cocher (`- [ ] **Étant donné** … **quand** … **alors** …`), les dépendances (« Dépend de #12 » quand la dépendance a une issue, sinon son numéro d'US), puis une ligne « Géré par Cockpit : modifie cette user story dans Cockpit, pas ici. » et un marqueur caché `<!-- cockpit:story:<id> -->`. Le rendu est une **fonction pure** de l'US, testée seule. **Le texte de l'utilisateur ne doit rien déclencher sur GitHub** : un `@` est neutralisé (pas de notification), `<!--` et `-->` sont échappés en entités HTML (le pied de page reste visible, un seul marqueur), un critère tient sur une ligne (les retours à la ligne y deviennent des espaces). **Limites de GitHub** : le titre est coupé à 256 caractères (« … » à la fin) et le corps à 65 536, en coupant d'abord les notes, avec la mention « (tronqué : la version complète est dans Cockpit) » ; le pied de page et le marqueur restent toujours |
| C | Le label de statut ? | Un seul label Cockpit par issue : `cockpit: prête`, `cockpit: en cours`, `cockpit: en revue`, `cockpit: terminée`, `cockpit: abandonnée`. Cockpit pose le label du statut (sur une issue créée, après la création : l'issue naît sans label, puisqu'il peut manquer ; sur une issue qui l'a déjà, selon la réponse de GitHub à la mise à jour, rien n'est posé) ; la réponse de GitHub donne les labels de l'issue, et Cockpit retire seulement les **autres labels Cockpit** qui s'y trouvent, **sans toucher aux autres labels**. Si GitHub refuse le label parce qu'il n'existe pas dans le repo, Cockpit le crée (une erreur « existe déjà » est ignorée) et le pose de nouveau. Un label Cockpit renommé à la main sur GitHub n'est plus reconnu : il reste sur l'issue, et le label d'origine est recréé |
| D | Ouverture et fermeture ? | Ouverte de `ready` à `in_review` ; **fermée** à `done` (`completed`) et à `abandoned` (`not_planned`). Une US abandonnée qui n'a jamais eu d'issue n'en reçoit pas |
| E | Que garde la base ? | Sur `user_stories` : `issue_number` (le numéro de l'issue) et `issue_body_hash` (SHA-256 du dernier corps publié, 002), plus `issue_claimed_at` (voir G). L'issue est **à jour** quand le hash du corps rendu maintenant est égal à `issue_body_hash` : le corps contient le récit, le statut et le reste, donc un même corps veut dire même titre, même label et même état |
| F | Quand Cockpit écrit-il sur GitHub ? | **Après** la décision, jamais pendant : la validation, la modification ou l'abandon est enregistrée et validée en base d'abord (une décision humaine ne doit pas échouer parce que GitHub ne répond pas), puis Cockpit synchronise l'issue, **hors transaction** (pas de connexion tenue pendant un appel de 10 s). L'abandon d'un ticket synchronise ensuite ses US publiées, l'une après l'autre, **dans un budget de 30 secondes** : passé ce délai, aucune nouvelle synchronisation ne commence, la réponse part, et les US restantes montrent « Republier ». Une page d'US dont l'issue n'est pas à jour le dit et propose « Republier » |
| G | Deux synchronisations en même temps ? | Pour une **création**, Cockpit **réserve** d'abord l'US par une seule requête atomique (`issue_claimed_at` rempli si vide ou plus vieux d'une minute), crée l'issue, **enregistre son numéro aussitôt**, puis finit la mise à jour et libère la réserve. Une synchronisation qui trouve une réserve récente s'arrête : celle qui l'a posée publiera. Une **mise à jour** relit l'US au moment de l'appel. Deux mises à jour simultanées peuvent arriver sur GitHub dans le désordre (voir les limites connues) |
| H | Que garde l'historique ? | Chaque tentative qui appelle GitHub laisse une entrée `sync_issue` (acteur `system`, origine `system`, l'utilisateur de la décision), avec `args: { storyId }`, `story_id`, `project_id`, `ticket_id`, et dans **`github_effects`** (colonne de la 002, ajoutée ici) ce qui a été fait : `{ issueNumber, created, closed }`. Un échec est une entrée `error` (010 D : la raison précise ne va que dans les logs) ; elle garde `github_effects` si une issue a été créée avant l'échec. Dans l'interface, l'acteur `system` s'appelle « Cockpit ». Jamais le texte de l'US |
| I | Et si l'App n'a plus accès au repo ? | L'appel échoue, l'entrée est `error`, l'US reste décidée dans Cockpit et sa page dit que l'issue n'est pas à jour. « Republier » réessaie |
| J | Quels écrans ? | Sur `/us/:id` : « Issue #12 », lien vers l'issue sur GitHub, et, si elle n'est pas à jour, « L'issue GitHub n'est pas à jour. » avec « Republier » (`POST /api/stories/:id/publish` : 503, 401, 404 comme les autres décisions, 409 `project_archived` et 409 `wrong_status` pour une US qui ne doit pas avoir d'issue ; il reste permis sur une US d'un ticket abandonné, pour fermer son issue ; un refus n'écrit pas d'entrée, puisque rien n'a été tenté). Si « Republier » échoue encore, la page le dit. L'avertissement est annoncé aux lecteurs d'écran ; après une republication réussie, le focus va sur le lien de l'issue. Le Journal nomme `sync_issue` |

## Ce qui est repoussé

- Les passages à `in_progress`, `in_review` et `done` viennent avec les runs et les webhooks (7.x, 5.x) : ils appelleront la même synchronisation.
- Une issue modifiée à la main sur GitHub : signalée avec le diff en 5.2, grâce à `issue_body_hash`.
- Une issue fermée ou supprimée à la main sur GitHub : 5.x (webhooks).
- La relance automatique des synchronisations en échec : « Republier » suffit tant qu'il n'y a qu'un utilisateur par projet.

## Limites connues

- **Un arrêt de Cockpit entre la création de l'issue et l'enregistrement de son numéro** laisse une issue orpheline : la synchronisation suivante, une minute plus tard, en crée une autre. Le marqueur `<!-- cockpit:story:<id> -->` permettra de la retrouver si cela arrive.
- **Deux mises à jour simultanées** peuvent arriver sur GitHub dans le désordre : l'issue garde alors la version plus ancienne alors que la page la dit à jour. La modification suivante de l'US la corrige ; la 5.2 (comparaison avec GitHub) le détectera.
- **Une US dont une dépendance reçoit son issue plus tard** affiche « Dépend de US 5 » jusqu'à sa prochaine synchronisation ; sa page dit alors qu'elle n'est pas à jour, et « Republier » corrige.
- **L'enregistrement du numéro peut échouer** après la création de l'issue (base perdue à ce moment précis) : une issue en double suivra, comme pour un arrêt de Cockpit.
