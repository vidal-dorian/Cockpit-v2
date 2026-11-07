# 050 — Figer l'existant

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-07
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [007 — Reprendre une app existante](007-reprise-app-existante.md) (choix E, point ouvert 2), [047 — Les règles et l'écran de reprise](047-ecran-de-reprise.md), [048 — Le graphe par fonctionnalité](048-graphe-par-fonctionnalite.md), [035 — Critères et PR](035-criteres-et-pr.md), [038 — Le suivi de la PR](038-suivi-de-la-pr.md), [039 — L'aide à la décision](039-aide-a-la-decision.md), [049 — La mise à jour du catalogue](049-mise-a-jour-du-catalogue.md)
- **Tranche** : R4 du [découpage](../decoupage.md), phase 10

## Contexte

La 007 E dit ce que fait le run d'une US de reprise : `/dev-us` en mode **« figer l'existant »**, le test-writer écrit un test par règle, qui doit **passer tout de suite**, et aucun fichier de l'app n'est modifié. Un test qui échoue veut dire que la règle est fausse. Démo : la règle validée a son test, qui passe ; son nœud passe « figée ».

Le point ouvert 2 de la 007 demandait qui vérifie que la PR ne touche que des tests. Le 2026-11-07, Dorian a choisi **B** : le reviewer **et** Cockpit, sur le diff de la PR.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le mode « figer » ? | `/dev-us` lit `kind` dans `get_user_story` (047 N). Pour une US `takeover` : le **test-writer** écrit un test par règle (chaque critère de reprise), qui doit passer **sans toucher au code de l'app** ; **seuls le test-writer puis le reviewer tournent**, quelle que soit l'équipe (le developer et les autres étapes, comme un `doc-writer`, sont sautés : rien à implémenter ni à documenter) ; le **reviewer** vérifie que chaque test dit bien sa règle et que la PR ne modifie pas le code de l'app, et ses remarques bloquantes reviennent **au test-writer**, jamais au developer. Une modification de la configuration des tests ou d'un manifeste (D) n'est pas bloquante pour le reviewer : il la nomme dans son résumé, pour l'humain. Chaque règle est signalée par `report_criterion` comme d'habitude (035) : `passed` avec le test en preuve, ou `failed` quand le test échoue sur le code tel qu'il est |
| B | Une règle dont le test échoue ? | Son test **n'entre pas dans la PR** (la CI resterait rouge pour rien) ; le critère est `failed` avec la preuve (le test et ce qu'il donne), et le verdict dit « à vérifier » (039). Les règles qui passent sont figées quand même : un échec ne bloque pas les autres |
| C | Qui vérifie que la PR ne touche que des tests ? | **Le reviewer** (A) **et Cockpit** (point ouvert 2 : B). Cockpit lit les fichiers de la PR quand il la suit (038), pour une US de reprise seulement, et garde les chemins qui ne sont pas des tests. S'il y en a, le verdict du run gagne la raison **« La PR modifie du code de l'app, pas seulement des tests »**, avec la liste des fichiers sur la page du run |
| D | Qu'est-ce qu'un test ? | Un chemin dont un dossier s'appelle `test`, `tests`, `__tests__` ou `spec`, ou dont le nom se termine par `.test.<ext>`, `.spec.<ext>`, `_test.<ext>` ou `Test.<ext>` (Java, PHP) ; les instantanés de tests (`__snapshots__/`, `*.snap`) comptent aussi comme tests. Un fichier renommé compte **ses deux chemins** : déplacer du code de l'app dans un dossier de tests est signalé. Les fichiers de configuration des tests ne comptent pas comme tests : les modifier est signalé, à l'humain de juger |
| E | Le stockage ? | Une colonne `pr_app_files` (`text[]`, nulle tant que rien n'est lu) sur `user_stories` : les chemins hors tests de la PR, **20 au plus** (le compte total en plus si la PR en a davantage). Remplie à chaque lecture de la PR d'une US de reprise (webhook ou « Actualiser », 038), comme le cache de la CI ; remise à nulle quand la PR est détachée |
| F | L'état « figée » ? | Une règle de reprise est **figée** quand son US est terminée (la PR est mergée, 038) **et** que son critère est `passed`. C'est un état calculé, pas une colonne. Il s'affiche partout où l'état d'une règle s'affiche : le graphe et la liste par fonctionnalité (048 D, « figée » à côté de « à trancher » et « voulue »), la page de l'US et l'export Markdown |
| G | Le catalogue ? | `/dev-us` (le skill), le `test-writer` et le `reviewer` gagnent le mode « figer ». `catalog/history.json` est régénéré (049 B), et les repos déjà préparés reçoivent « Mettre à jour » dans leur onglet Santé (049) |

## Ce qui est repoussé

- **Rendre la liste des chemins de tests réglable** par projet : à faire si un repo range ses tests autrement (D).
- **Que faire d'une règle fausse** une fois l'US en cours : aujourd'hui, l'humain lit « à vérifier » et décide (abandonner l'US, la relancer) ; une action dédiée viendra si le besoin se montre.

## Limites connues

- **Figer l'existant fige aussi les bugs** que l'humain n'a pas reconnus en validant (007).
- **Un test peut passer sans dire sa règle** : c'est au reviewer de le voir, Cockpit ne le peut pas.
- **La liste des fichiers d'une PR** coûte une lecture GitHub de plus par suivi (par page de 100 fichiers), seulement pour les US de reprise.
