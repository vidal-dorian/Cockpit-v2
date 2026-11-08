# 062 — Après le merge : le changelog et les branches à nettoyer

- **Statut** : proposée (à valider à la relecture de la PR)
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
| F | L'écran ? | L'onglet **Historique** (053 I) a deux puces en haut : **« Journal »** (par défaut, ce qui existe) et **« Ce qui a été livré »**, sur `/projets/:id/historique/livre`. Phrase d'état : « Ce que `<projet>` a livré. », puis « Une ligne par PR, écrite à partir de son titre. ». Puis les groupes de versions (« Version 1.9.0 · 6 novembre », ou « Pas encore publiée » avec « · pas encore publiée »), puis les branches à nettoyer. « Supprimer la branche » demande une confirmation sur place (« Supprimer la branche us/40-… ? Rien ne sera perdu : elle est déjà mergée. »), puis la ligne disparaît. Sans PR mergée : « Rien de livré pour l'instant. » |
| G | La couleur ? | Le budget de la 045 : les icônes ⇄ et ✕ sont grises, « Corrigé » est un mot ; « Supprimer la branche » est un bouton secondaire, pas rouge |

## Ce qui est repoussé

- **Le prochain numéro de version** du groupe « Pas encore publiée » (S17 écrit « Version 1.9.0 · aujourd'hui · pas encore publiée ») : Cockpit ne le connaît pas avant la release.
- **Qui a écrit et relu** chaque PR (S17 : « Claude, relu par Dorian »).
- **Plus de 300 PR** : les plus anciennes ne sont pas listées.
- **Supprimer d'un coup toutes les branches** à nettoyer.

## Limites connues

- **Une PR est rangée sous une release par les dates**, pas en regardant les commits que contient la release : une release publiée depuis une autre branche, ou une PR mergée pendant la publication, peut tomber dans le mauvais groupe.
- **Le changelog relit GitHub à chaque affichage** : quelques appels par visite (les PR, les releases et les branches).
