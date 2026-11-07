# 036 — Les questions de Claude

- **Statut** : validée
- **Date** : 2026-11-05
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [004 — Outils MCP](004-outils-mcp.md) (`ask_user`, `get_answer`, et pourquoi ce sont deux outils), [002 — Modèle de données](002-modele-donnees.md) (`questions`), [003 — Interface](003-interface.md) (réponses rapides), [033 — Le run minimal](033-run-minimal.md)
- **Modifiée par** : [044](044-la-nuit-de-claude.md) : la question d'un run « en pause » (`paused`) reste ouverte à la réponse (D et E)
- **Tranche** : 7.4 du [découpage](../decoupage.md)

## Contexte

La 004 a fixé les deux outils : Claude dépose sa question avec `ask_user`, qui rend tout de suite, puis repasse voir la réponse avec `get_answer`, parce qu'un appel MCP ne peut pas attendre des heures. La 002 a fixé la table `questions`. Démo : Claude pose une question, je réponds dans Cockpit, il reprend. Il reste à dire comment l'humain répond, ce que montre la page du run et comment le skill attend.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La base ? | Table **`questions`** de la 002 : `run_id`, `question`, `suggested_answers` (JSON, facultatif), `answer`, `asked_at`, `answered_at`. **Index unique sur `run_id` où `answer` est vide** : une seule question en attente par run, garanti par la base (comme le run actif, 002) |
| B | `ask_user` ? | `question` : 1 à 2 000 caractères ; `suggested_answers` : au plus 2, de 1 à 200 caractères chacune ; sans NUL. Refus : `question_pending` (une question de ce run attend déjà), `run_finished`, `project_archived`, `not_found`. Rend `{ question_id }` tout de suite |
| C | `get_answer` ? | Rend `{ answered, answer, stop_requested }` : `answer` vaut `null` tant que l'humain n'a pas répondu ; `stop_requested` vaut `false` jusqu'à la 7.5. Une lecture : marche aussi sur un run fini ou un projet archivé. Une question d'un autre : `not_found` |
| D | L'humain répond ? | **`POST /api/questions/:id/answer`** `{ answer }` (1 à 10 000 caractères, sans NUL), dans un `act` : 404 pour un non-membre, 409 `already_answered`, 409 `run_finished` (le run ne lira plus la réponse), 409 `project_archived`. Entrée `answer_question` (acteur humain, `run_id`). La réponse ne se modifie plus |
| E | Un run qui finit avec une question en attente ? | Rien de plus : la question reste sans réponse, la page la montre comme telle, sans champ |
| F | La lecture ? | `GET /api/runs/:id` rend en plus **`questions`**, dans l'ordre : `id`, `question`, `suggestedAnswers`, `answer`, `askedAt`, `answeredAt` |
| G | L'écran ? | Sur la page du run, une section **« Questions »**. La question en attente vient en premier, avec un bouton par réponse suggérée (il l'envoie telle quelle) et un champ « Ta réponse » avec « Répondre ». Les questions répondues suivent, chacune avec sa réponse. Une question sans réponse d'un run fini : « Sans réponse ». La page se recharge à chaque `change` de `run:<id>` (033 G), envoyé par `ask_user` et par la réponse |
| H | L'historique ? | L'entrée MCP de chaque appel (016), avec `run_id`. Le journal : « Question posée », « Réponse consultée », « Question répondue ». Chaque passage de `get_answer` laisse son entrée (004) |
| I | Le skill ? | `/dev-us` du catalogue : quand un choix revient à l'utilisateur, ne pas deviner : `ask_user`, avec au plus deux réponses suggérées s'il y en a d'évidentes, puis `get_answer` après 30 secondes, 1 minute, 2 minutes, puis toutes les 5 minutes (004 : espacer les passages), et reprendre avec la réponse |

## Ce qui est repoussé

- **La question en tête de l'accueil**, et les touches `1` et `2` des réponses rapides : 8.1.
- **Demander l'arrêt pendant qu'une question attend** : 7.5, qui remplira `stop_requested`.
- **Une notification sur le téléphone** : après le MVP.

## Limites connues

- **Claude attend dans sa session** : si elle est fermée, la réponse n'est jamais lue, et le run reste « En cours » jusqu'à la fermeture à la main (7.5).
- **Chaque passage de `get_answer`** laisse une entrée dans le journal : une heure d'attente en laisse une quinzaine.
