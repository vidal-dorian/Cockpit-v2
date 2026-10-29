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
| B | Le gabarit ? | **Titre** : le « je veux » de l'US. **Corps** (markdown, en français) : le récit (« En tant que … je veux … afin de … »), le statut, les notes, les critères en cases à cocher (`- [ ] **Étant donné** … **quand** … **alors** …`), les dépendances (« Dépend de #12 » quand la dépendance a une issue, sinon son numéro d'US), puis une ligne « Géré par Cockpit : modifie cette user story dans Cockpit, pas ici. » et un marqueur caché `<!-- cockpit:story:<id> -->`. Le rendu est une **fonction pure** de l'US, testée seule |
| C | Le label de statut ? | Un seul label Cockpit par issue : `cockpit: prête`, `cockpit: en cours`, `cockpit: en revue`, `cockpit: terminée`, `cockpit: abandonnée`. Au changement, Cockpit retire l'ancien et pose le nouveau, **sans toucher aux autres labels** de l'issue. Un label absent du repo est créé (une erreur « existe déjà » est ignorée) |
| D | Ouverture et fermeture ? | Ouverte de `ready` à `in_review` ; **fermée** à `done` (`completed`) et à `abandoned` (`not_planned`). Une US abandonnée qui n'a jamais eu d'issue n'en reçoit pas |
| E | Que garde la base ? | Sur `user_stories` : `issue_number` (le numéro de l'issue) et `issue_body_hash` (SHA-256 du dernier corps publié, 002), plus `issue_claimed_at` (voir G). L'issue est **à jour** quand le hash du corps rendu maintenant est égal à `issue_body_hash` : le corps contient le récit, le statut et le reste, donc un même corps veut dire même titre, même label et même état |
| F | Quand Cockpit écrit-il sur GitHub ? | **Après** la décision, jamais pendant : la validation, la modification ou l'abandon est enregistrée et validée en base d'abord (une décision humaine ne doit pas échouer parce que GitHub ne répond pas), puis Cockpit synchronise l'issue, **hors transaction** (pas de connexion tenue pendant un appel de 10 s). L'abandon d'un ticket synchronise ensuite chacune de ses US publiées. Une page d'US dont l'issue n'est pas à jour le dit et propose « Republier » |
| G | Deux synchronisations en même temps ? | Pour une **création**, Cockpit **réserve** d'abord l'US dans une courte transaction (`issue_claimed_at` rempli si vide ou plus vieux d'une minute), crée l'issue, puis enregistre le numéro et libère la réserve. Une synchronisation qui trouve une réserve récente s'arrête : celle qui l'a posée publiera. Une **mise à jour** relit l'US au moment de l'appel ; si une autre l'a devancée avec un rendu plus ancien, le hash ne correspond plus et la page propose « Republier » |
| H | Que garde l'historique ? | Chaque synchronisation laisse une entrée `sync_issue` (acteur `system`, origine `system`, l'utilisateur de la décision), avec `args: { storyId }`, `story_id`, `project_id`, `ticket_id`, et dans **`github_effects`** (colonne de la 002, ajoutée ici) ce qui a été fait : `{ issueNumber, created, closed }`. Un échec est une entrée `error` (010 D : la raison précise ne va que dans les logs). Jamais le texte de l'US |
| I | Et si l'App n'a plus accès au repo ? | L'appel échoue, l'entrée est `error`, l'US reste décidée dans Cockpit et sa page dit que l'issue n'est pas à jour. « Republier » réessaie |
| J | Quels écrans ? | Sur `/us/:id` : « Issue #12 », lien vers l'issue sur GitHub, et, si elle n'est pas à jour, « L'issue GitHub n'est pas à jour. » avec « Republier » (`POST /api/stories/:id/publish`, mêmes barrières que les autres décisions, refusé sur un projet archivé). Le Journal nomme `sync_issue` |

## Ce qui est repoussé

- Les passages à `in_progress`, `in_review` et `done` viennent avec les runs et les webhooks (7.x, 5.x) : ils appelleront la même synchronisation.
- Une issue modifiée à la main sur GitHub : signalée avec le diff en 5.2, grâce à `issue_body_hash`.
- Une issue fermée ou supprimée à la main sur GitHub : 5.x (webhooks).
- La relance automatique des synchronisations en échec : « Republier » suffit tant qu'il n'y a qu'un utilisateur par projet.

## Limites connues

- **Un arrêt de Cockpit entre la création de l'issue et l'enregistrement de son numéro** laisse une issue orpheline : la synchronisation suivante, une minute plus tard, en crée une autre. Le marqueur `<!-- cockpit:story:<id> -->` permettra de la retrouver si cela arrive.
- **Une mise à jour plus ancienne qui arrive après une plus récente** laisse l'issue en retard d'une version ; la page le montre et « Republier » corrige.
