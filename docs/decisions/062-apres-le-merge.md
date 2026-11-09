# 062 — Après le merge : le changelog et les branches à nettoyer

- **Statut** : validée ; le code est construit (tranche 11.5)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [033 — Le run minimal](033-run-minimal.md) (la branche d'une US), [035 — Critères et PR](035-criteres-et-pr.md) (la PR d'une US), [038 — Le suivi de la PR](038-suivi-de-la-pr.md), [053 — Le journal filtrable et l'historique d'un projet](053-journal-filtrable.md) (l'onglet Historique), [010 — Historique](010-historique.md) (D)
- **Tranche** : 11.5 du [découpage](../decoupage.md)
- **Écran** : [S17](../ecrans/S17_Changelog.png)

## Contexte

Le brief (§6.8) veut un **changelog** par projet, et pouvoir **supprimer la branche** d'une US mergée, sur clic seulement, après avoir revérifié sur GitHub que rien ne serait perdu. Le brief dit « les US terminées, par date de merge » ; la maquette S17 groupe par version, une ligne par PR écrite à partir de son titre. Le 2026-11-08, Dorian a choisi :
- **le changelog** suit S17 : une ligne par PR mergée sur la branche par défaut, groupée sous la release GitHub qui la contient, et « pas encore publiée » pour les autres ;
- **la place** : l'onglet Historique du projet gagne deux puces, « Journal » (ce qui existe, 053) et « Ce qui a été livré » (le changelog, avec les branches à nettoyer en bas).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Lire le changelog ? | `GET /api/projects/:id/changelog`, réservé aux membres, lisible sur un projet archivé. Cockpit lit sur GitHub, avec le jeton de l'installation : les **PR fermées** dont la base est la branche par défaut (100 par page, **3 pages au plus**, les plus récemment mises à jour d'abord), dont il ne garde que les **mergées** ; et les **releases** publiées du repo (100 au plus, sans les brouillons). Rien n'est stocké : la page relit GitHub à chaque affichage. GitHub injoignable : 502 `github_unavailable`. La lecture ne laisse pas d'entrée |
| B | Grouper par version ? | Les releases sont triées par date de publication. Une PR va sous la **première release publiée après son merge** : « Version `<nom ou tag>` · `<date>` ». Les PR mergées après la dernière release vont sous **« Pas encore publiée »**, en tête. Un repo **sans release** groupe par **jour de merge** (« Aujourd'hui », « Hier », « 6 novembre »). Dans un groupe, la plus récente d'abord |
| C | Une ligne ? | **Le titre de la PR**, sans son préfixe de commit conventionnel (`feat(11.1): `, `fix: `, `chore(x)!: `…). Un titre `fix…` est écrit **« Corrigé : … »** avec l'icône ✕ ; les autres ont ⇄. En dessous : « PR #51 », suivi de « · US 40 » (un lien vers l'US) quand une US du projet a cette PR (035). Le numéro de PR est un lien vers GitHub |
| D | Les branches à nettoyer ? | En bas de « Ce qui a été livré », **« Branches à nettoyer · après le merge »** : les US **terminées** du projet dont la PR est **mergée** et dont la **branche existe encore** sur GitHub. Cockpit liste les branches du repo (100 par page, 10 pages au plus) et garde celles des US. Une ligne donne le nom de la branche, « PR #51 mergée · plus utilisée » et le bouton **« Supprimer la branche »**. La section n'apparaît pas quand il n'y a rien à nettoyer. Seulement les branches des US de Cockpit, jamais une autre |
| E | Supprimer une branche ? | `POST /api/stories/:id/branch/delete`, réservé aux membres, sur un projet actif (409 `project_archived` sinon). **Juste avant de supprimer, Cockpit revérifie sur GitHub** que rien ne serait perdu : l'US est terminée et sa PR est mergée (409 `pr_not_merged`) ; la branche existe encore (409 `branch_gone`) ; elle n'est pas la branche par défaut ni une branche protégée (409 `branch_protected`) ; **son dernier commit est celui de la PR mergée**, sans rien de plus (409 `branch_has_new_commits`) ; aucune PR ouverte ne part d'elle (409 `branch_has_open_pr`). Alors seulement, il supprime la référence (`DELETE /repos/{owner}/{repo}/git/refs/heads/<branche>`). Un refus dit pourquoi, en français. L'historique garde `delete_branch` avec `{ storyId }` ; jamais le nom de la branche (010 D) |
| F | L'écran ? | L'onglet **Historique** (053 I) a deux puces en haut : **« Journal »** (par défaut, ce qui existe) et **« Ce qui a été livré »**, sur `/projets/:id/historique/livre`. Phrase d'état : « Ce que `<projet>` a livré. », puis « Une ligne par PR, écrite à partir de son titre. ». Puis les groupes de versions (« Version 1.9.0 · 6 novembre », ou « Pas encore publiée », sans date), puis les branches à nettoyer. « Supprimer la branche » demande une confirmation sur place (« Supprimer la branche us/40-… ? Rien ne sera perdu : elle est déjà mergée. »), puis la ligne disparaît. Sans PR mergée : « Rien de livré pour l'instant. » |
| G | La couleur ? | Le budget de la 045 : les icônes ⇄ et ✕ sont grises, « Corrigé » est un mot ; « Supprimer la branche » est un bouton secondaire, pas rouge |

## Ce qui est repoussé

- **Le prochain numéro de version** du groupe « Pas encore publiée » (S17 écrit « Version 1.9.0 · aujourd'hui · pas encore publiée ») : Cockpit ne le connaît pas avant la release.
- **Qui a écrit et relu** chaque PR (S17 : « Claude, relu par Dorian »).
- **Plus de 300 PR** : les plus anciennes ne sont pas listées.
- **Supprimer d'un coup toutes les branches** à nettoyer.

## Ce que le code a précisé (tranche 11.5)

- **La lecture** : `GET /api/projects/:id/changelog` rend `{ groups, branches, repo }`. Un groupe est `{ kind, name, date, entries }` avec `kind` parmi `unreleased` (ni nom ni date), `release` (`name` : le nom de la release, ou son tag s'il n'en a pas ; `date` : sa date de publication ISO), `day` (`date` : le jour `AAAA-MM-JJ`) et `older` (ni nom ni date). Une entrée est `{ number, title, fix, storyId }` (`storyId` nul sans US du projet pour cette PR). Une branche est `{ storyId, branch, prNumber }`. `repo` est le `owner/name`, dont la page tire les liens des PR (`https://github.com/<repo>/pull/<n>`). Les groupes vont du plus récent au plus ancien ; les groupes `release` sont clés par le **tag** (deux releases de même nom restent deux groupes).
- **Les lectures** (`github.ts`) : `listMergedPulls` lit les PR fermées sur la base (`sort=updated`, 3 pages de 100) et ne garde que celles qui ont `merged_at` ; `listReleases` lit **une page de 100**, sans les brouillons ni les releases sans date de publication ; `listBranches` lit 10 pages de 100 au plus. Les branches ne sont lues que s'il y a une US à nettoyer.
- **Le groupe « Versions plus anciennes »** (`older`) : quand GitHub renvoie une page pleine de releases (100, **brouillons compris**), d'autres releases plus anciennes peuvent exister sans avoir été lues. Toute PR mergée **avant la plus ancienne release publiée lue** va alors dans ce groupe, au lieu d'être rangée sous une release qui n'est peut-être pas la sienne. Aucun intervalle n'est deviné.
- **Le titre** : le préfixe n'est retiré que pour les types conventionnels `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `style` et `revert`, avec une portée facultative et un `!`, sans tenir compte de la casse (`Fix(x)!: …` compte). Un autre préfixe (`wip: …`) reste dans le titre. Seul `fix` donne « Corrigé : … » et ✕ ; les autres ont ⇄.
- **Les jours** sont en **UTC**, côté serveur (le jour de merge) comme dans la page (« Aujourd'hui », « Hier », les dates de version).
- **Supprimer** : `POST /api/stories/:id/branch/delete` répond 204. Les refus sont des 409 `{ error }`, dans cet ordre : `project_archived` (avant tout appel à GitHub), `pr_not_merged` (l'US n'est pas terminée, n'a pas de PR ou de branche, ou GitHub dit la PR non mergée), `branch_gone`, `branch_protected` (la branche est protégée **ou** est la branche par défaut du projet), `branch_has_new_commits` (la branche ne pointe plus sur le dernier commit de la PR), `branch_has_open_pr`. Une US d'un autre projet que ceux de l'utilisateur : 404. La relecture sur GitHub et le `DELETE` se font **hors de toute transaction** ; l'entrée d'historique `delete_branch` `{ storyId }` est écrite **après**, une seule fois : réussie, refusée avec la raison, ou en erreur. Toute autre panne de GitHub : 502 `github_unavailable`.
- **Pourquoi une PR de fork ne peut pas être celle d'une US** : le lien d'une PR à une US (035 C, `pr_wrong_branch`) refuse une PR dont la branche n'est pas celle de l'US ou qui part d'un autre repo. La branche à supprimer est donc toujours une branche du repo du projet, et la PR ouverte qu'on cherche (`head=<owner>:<branche>`) est une PR du même repo.
- **La page** (`ProjectDelivered.tsx`) : les puces « Journal » et « Ce qui a été livré » sont des liens (`NavLink`) dans un `<nav aria-label="Vues de l'historique">`, partagé avec `ProjectHistory.tsx` ; la seconde est sur `/projets/:id/historique/livre`. Les groupes s'intitulent « Pas encore publiée », « Versions plus anciennes », « Version `<nom>` · 6 novembre » ou, par jour, « Aujourd'hui », « Hier », « 6 novembre ». Le numéro de PR est un lien vers GitHub, « US N » un lien vers `/us/N`. Sans groupe : « Rien de livré pour l'instant. » ; erreur de lecture : « Impossible de lire ce qui a été livré. ». « Supprimer la branche » demande « Supprimer la branche `<nom>` ? Rien ne sera perdu : elle est déjà mergée. » avec **« Oui, supprimer »** et **« Annuler »** ; la ligne disparaît quand la page relit le changelog. Un refus s'écrit sous la ligne, en français (par exemple « La branche a des commits que la PR mergée n'a pas : rien n'est supprimé. ») ; le 502 dit « GitHub ne répond pas : vérifie sur GitHub si la branche a été supprimée. ». Sur un projet archivé, il n'y a pas de bouton de suppression.
- **Le Journal** (`Journal.tsx`) a de nouveaux libellés français : « Branche supprimée » (`delete_branch`) et, qui manquaient aux tranches 11.3 et 11.4, « Issues importées », « Pièce jointe ajoutée », « Pièce jointe retirée » et « Pièce jointe lue ».
- **Pas de migration** : rien n'est stocké.

## Limites connues

- **Une PR est rangée sous une release par les dates**, pas en regardant les commits que contient la release : une release publiée depuis une autre branche, ou une PR mergée pendant la publication, peut tomber dans le mauvais groupe.
- **Le changelog relit GitHub à chaque affichage** : quelques appels par visite (les PR, les releases et les branches).
- **Entre la relecture et le `DELETE`, un `push` peut être perdu** : l'API REST de GitHub ne permet pas de supprimer « seulement si la branche est encore à tel commit ». Les commits poussés entre les deux disparaissent de la référence (ils restent dans le clone de celui qui a poussé).
- **Un plantage entre le `DELETE` et l'écriture de l'historique** laisse une branche supprimée sans entrée.
- **« Aujourd'hui » et « Hier » sont en UTC** : près de minuit, à Paris, un merge peut être rangé au jour d'avant ou d'après.
- **Une page de releases faite que de brouillons** (100) ne donne aucune release publiée : le changelog retombe sur les groupes par jour.
