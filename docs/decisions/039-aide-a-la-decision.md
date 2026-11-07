# 039 — L'aide à la décision

- **Statut** : validée
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md) (le verdict n'est pas stocké, il se calcule des critères et de `pr_ci_state`), [003 — Interface](003-interface.md) (« Décider en fin de run »), [035](035-criteres-et-pr.md), [037](037-arreter-relancer-fermer.md), [038](038-suivi-de-la-pr.md)
- **Tranche** : 7.7 du [découpage](../decoupage.md)

## Contexte

Le brief (§6) veut, en fin de run, chaque critère avec son résultat et sa preuve, l'état de la CI, et un verdict « acceptable » ou « à vérifier » avec les raisons. La 003 veut le verdict d'abord, puis une seule action principale, relire et merger sur GitHub, et le journal détaillé replié. Démo : la fin d'un run affiche le verdict.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quand ? | Pour tout run **fini**, quel que soit son statut. Un run en cours n'a pas de verdict |
| B | La règle ? | **Acceptable** seulement si tout est vrai : le run a réussi ; l'US a au moins un critère, et **chaque** critère de l'US a le résultat `passed` **donné par ce run** ; l'US a une PR liée ; sa CI est `success` ; sa revue ne demande pas de modifications. Sinon **à vérifier**, avec chaque raison qui manque. L'absence de revue n'est pas une raison : c'est l'humain qui relit |
| C | Les raisons ? | Des codes, dans cet ordre : `run_not_succeeded`, `criteria_failed`, `criteria_not_reported`, `no_pull_request`, `ci_failing`, `ci_pending`, `ci_missing`, `changes_requested`. L'écran les dit en français : « Le run n'a pas réussi », « 2 critères en échec », « 1 critère non signalé dans ce run », « Aucune PR liée », « La CI échoue », « La CI tourne encore », « Aucune CI sur la PR », « Des modifications sont demandées sur la PR » |
| D | Où se calcule-t-il ? | Une **fonction pure** du serveur (`src/server/verdict.ts`), appelée par `GET /api/runs/:id`, qui rend en plus `verdict: { acceptable, reasons }` (ou `null` pour un run en cours) et, sur l'US, `prNumber`, `prCiState`, `prReviewState`. Rien n'est stocké (002) : le verdict suit la CI et la revue tenues à jour par la 7.6. L'accueil (8.1) la réutilisera pour « runs à vérifier » |
| E | L'écran ? | Sur la page d'un run fini, **en tête** : « Acceptable » ou « À vérifier », et la liste des raisons ; puis les critères avec leur preuve (035) ; puis **une seule action principale**, le bouton **« Relire et merger sur GitHub »** vers la PR, quand elle existe et n'est pas encore mergée (une US `done` n'a plus qu'un simple lien « Voir la PR sur GitHub ») ; les étapes passent dans un bloc replié **« Journal détaillé »**. Un run en cours garde la page d'aujourd'hui. Le verdict se dit en mots, jamais par la seule couleur (003) |
| F | L'historique ? | Rien : c'est une lecture |

*Ajout par la [050](050-figer-l-existant.md) C : pour une US de reprise, la raison `app_code_changed` (« La PR modifie du code de l'app, pas seulement des tests ») s'ajoute à la fin de la liste.*

## Ce qui est repoussé

- **Les runs à vérifier dans l'accueil** : 8.1.
- **Un verdict plus fin** (le diff, la couverture de tests) : après le MVP.

## Limites connues

- **La preuve reste déclarée par Claude** (035) : un « acceptable » dit que Claude a signalé chaque critère réussi et que la CI est verte, pas que les tests prouvent vraiment les critères.
- **Le verdict d'un ancien run** se calcule avec la CI et la revue d'aujourd'hui, celles de la PR liée à l'US.
- **Un critère re-signalé par un run plus récent** ne garde que ce dernier compte rendu (035 B) : la page de l'ancien run le dit « non signalé dans ce run », et son verdict passe « à vérifier ».
