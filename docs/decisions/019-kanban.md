# 019 — Le Kanban d'un projet

- **Statut** : validée
- **Date** : 2026-10-29
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md), [017 — Claude écrit les US](017-user-stories.md), [018 — Les décisions humaines](018-decisions-humaines.md)
- **Modifiée par** : [045](045-interface-quatre-temps.md) : le Kanban a six colonnes, la première est « Idées » (B)
- **Tranche** : 4.5 du [découpage](../decoupage.md)

## Contexte

Le brief (§6.3) veut un tableau par projet : à valider, prêtes, en cours, en revue, terminées, **sans glisser-déposer**, pour obliger à ouvrir une US avant de la valider. La 002 le calcule : les US du projet regroupées par `status`, rien n'est stocké.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quelle route ? | `GET /api/projects/:id/stories` : les US **non abandonnées** du projet, chacune avec `id`, `ticketId`, le titre de son ticket, `position`, `iWant`, `status`. Ordre : ticket, puis position. Mêmes barrières que la liste des tickets (503, 401, 404 pour le projet d'un autre). Une lecture : pas d'entrée d'historique. Lisible sur un projet archivé |
| B | Quelles colonnes ? | Cinq, dans cet ordre : **À valider** (`to_validate` et `to_rewrite`, cette dernière marquée « à réécrire »), **Prêtes** (`ready`), **En cours** (`in_progress`), **En revue** (`in_review`), **Terminées** (`done`). Les US abandonnées n'apparaissent pas : elles restent sur la page de leur ticket |
| C | Une carte ? | Le « je veux » de l'US, le titre de son ticket, et pour une US à réécrire le libellé « à réécrire ». Toute la carte est un lien vers `/us/:id`. **Aucun bouton** sur la carte : on ne déplace rien, on ouvre l'US (brief §6.3) |
| D | Où ? | Une section « Kanban » sur `/projets/:id`, au-dessus des tickets. Chaque colonne est une section avec un titre et son compte (« À valider (3) ») et une liste, ou « Aucune » quand elle est vide. Les colonnes sont dans une région focalisable au clavier (« Colonnes du Kanban »), pour pouvoir les faire défiler sans souris ; pour un lecteur d'écran, le titre du ticket sur une carte est précédé de « Ticket : ». En largeur téléphone, les colonnes s'empilent ; sinon elles sont côte à côte et défilent horizontalement si besoin. Couleurs des jetons seulement (003) |
| E | Fraîcheur ? | Les décisions (018), l'abandon et le renommage d'un ticket invalident aussi la requête du Kanban, pour qu'il reflète l'état réel au retour sur le projet |

## Ce qui est repoussé

- Les filtres (ticket, texte) et le tri : quand un projet aura assez d'US pour qu'on s'y perde.
- Les indicateurs de PR et de CI sur les cartes : tranches 5.x et 7.x.

## Limites connues

- **Pas de pagination** : la colonne « Terminées » grandit avec le projet. Elle se repliera ou se paginera quand elle deviendra longue.
- **Pas de mise à jour en direct** : les US que Claude écrit pendant que la page est ouverte apparaissent au rafraîchissement suivant. Il n'y a qu'une relecture quand la fenêtre reprend le focus.
