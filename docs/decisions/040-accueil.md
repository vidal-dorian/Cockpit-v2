# 040 — L'accueil : qu'est-ce qui m'attend ?

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : brief §6.13, [003 — Interface](003-interface.md) (qui doit agir, les tâches clés, agir sur place, le compteur de l'onglet Accueil), [028](028-creme-sombre-onglets-journal.md) (barre du haut), [036](036-questions-de-claude.md) (répondre), [038](038-suivi-de-la-pr.md) (CI et revue), [039](039-aide-a-la-decision.md) (le verdict)
- **Tranche** : 8.1 du [découpage](../decoupage.md), la dernière du MVP

## Contexte

Le brief veut un accueil qui répond à une question, « qu'est-ce qui m'attend ? » : à toi de jouer, Claude travaille, l'état des projets, une pastille par projet. La 003 classe ce qui t'attend par verbe, veut qu'on réponde à une question sans changer de page, et met sur l'onglet Accueil le nombre d'éléments qui t'attendent. Démo : l'accueil liste exactement ce qui attend mon action, et chaque élément mène où agir.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Une route ? | **`GET /api/home`**, pour l'utilisateur de la session (401 sinon), sur ses projets non archivés : `{ forYou, claudeWorks, projects }`. Rien n'est stocké : tout se lit dans les tables existantes (002) |
| B | « À toi de jouer » ? | Dans l'ordre des verbes : **Répondre** (chaque question en attente d'un run en cours, 036) ; **Valider** (chaque US `to_validate`) ; **Relire** (chaque US `in_review` avec une PR, avec l'état de sa CI en clair, 038) ; **Vérifier** (une US `ready` dont le dernier run est fini et « à vérifier », 039, avec ses raisons). **Une US n'y figure qu'une fois**, et une US dont un run tourne n'y a que sa question en attente : ni « Relire » ni « Vérifier » pendant que Claude y travaille. Chaque élément dit son projet et mène où agir : la question se répond **sur place** (le bloc de réponse de la 036), l'US à valider mène à `/us/:id`, la PR à relire à GitHub et à `/us/:id`, le run à vérifier à `/runs/:id` |
| C | « Claude travaille » ? | Chaque run `running` : l'US (« je veux »), le projet et **l'étape en cours** (l'agent de la dernière étape ouverte, sinon « Démarrage »), menant à `/runs/:id` |
| D | « Projets » ? | Chaque projet actif avec sa **pastille** : « À toi » s'il a un élément dans « À toi de jouer », sinon « Claude travaille » s'il a un run en cours, sinon « Rien en cours ». La couleur suit la 003 (corail, violet) et n'est jamais seule : le mot est écrit. Cockpit n'a pas de barre latérale (028) : la pastille est sur l'accueil |
| E | Le compteur ? | Sur l'onglet « Accueil » de la barre du haut, le nombre d'éléments de « À toi de jouer » quand il n'est pas nul, lu dans le même `GET /api/home` (003) |
| F | Le temps réel ? | L'accueil se recharge à chaque `change` du flux SSE (033 G), quel que soit l'objet |
| G | Rien à faire ? | « Rien ne t'attend. » sous « À toi de jouer », et « Claude ne travaille sur rien. » sous « Claude travaille ». Sans projet : un lien vers l'import des projets (2.1) |
| H | Déconnecté ? | La page d'aujourd'hui (connexion, état du serveur) ne change pas |

## Ce qui est repoussé

- **Le panneau de validation au-dessus de l'accueil** (003 : « Valider » passe à la suivante, « Annuler » 8 s) : l'US à valider mène à sa page.
- **Les raccourcis clavier** (`1`, `2`, `J`, `K`, `N`, `/`) : après le MVP, avec l'ergonomie.
- **Les routines** sur l'accueil (brief §6.13) et **les changements de workflow proposés** (ils n'existent pas encore).
- **Une pastille sur la page Projets.**

## Limites connues

- **Le verdict de chaque run candidat** se calcule à chaque lecture de l'accueil (039 D), en un nombre fixe de requêtes.
- **Toutes les écritures ne préviennent pas le flux SSE** : les US écrites par Claude (4.3) et les décisions humaines sur une US (4.4) ne rechargent pas l'accueil ; elles apparaissent au prochain affichage ou au retour sur l'onglet.
- **Une question par carte** : chaque question en attente a son propre bouton « Répondre » ; chaque carte compte comme une zone (003, règle 2).
- **Une US validée par erreur ou un run muet** ne reviennent pas dans « À toi de jouer » : l'US `ready` sans run n'attend personne, et un run `running` muet est dans « Claude travaille » (037 : l'humain le ferme).

## Mise à jour du 2026-11-06

À la demande de Dorian (ticket « Pouvoir ouvrir un projet depuis la page d'accueil »), chaque projet de « Projets » mène à sa page, et une section « Dernièrement » montre les 5 dernières entrées du Journal (les siennes, 028 F), avec leur projet ; le Journal affiche aussi le projet de chaque entrée. Rien d'autre de cette décision n'est rouvert.
