# 004 — Outils MCP

- **Statut** : validée
- **Date** : 2026-10-21
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md), [002 — Modèle de données](002-modele-donnees.md), [003 — Interface](003-interface.md)
- **Modifiée par** : [016 — Le serveur MCP](016-serveur-mcp.md) (ce que le journal garde des arguments et de la réponse) ; [017 — Claude écrit les US](017-user-stories.md) (`create_user_stories` en plusieurs appels pour un gros ticket, dépendances par position dans le ticket) ; [018 — Les décisions humaines sur une US](018-decisions-humaines.md) (table des droits, choix B : l'humain valide aussi une US à réécrire) ; [033 — Le run minimal](033-run-minimal.md) (D : `finish_run` accepte `succeeded` sans PR jusqu'à la 7.3)

## Contexte

Le serveur MCP est la seule porte par laquelle Claude agit sur Cockpit (brief §6.11). Claude n'a accès ni à la base ni à l'interface : il ne peut faire **que** ce qu'un outil propose. La liste des outils est donc la première protection de la règle centrale du produit : un outil qui n'existe pas ne peut pas être appelé.

Ce document fixe, pour le MVP, la liste des outils, ce que chacun demande, ce qu'il fait et quand il refuse.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Un outil par action, ou quelques outils génériques ? | **Un outil par action métier.** Chaque outil porte ses propres règles : la table des droits se lit et se teste ligne par ligne. Pas d'outil du type `update_status(id, statut)` |
| B | Comment Claude retrouve « le truc de connexion sur GestionProjet » ? | **Un outil `search`** : recherche simple de mots, sans gestion des fautes de frappe ni des synonymes |
| C | Que répond un outil à une demande interdite ? | Un **refus** distinct d'une **erreur**, avec un message qui dit **pourquoi et quoi faire**, en anglais (seul Claude le lit) |
| D | À quoi donne accès un jeton ? | **Un seul type de jeton** : tous les projets dont son utilisateur est membre (008), tous les outils. Un jeton par machine, révocable un par un. Les types de jetons (routines, développement) viendront avec les routines |
| E | `create_ticket` et `add_note` (brief §6.11) ? | **`create_ticket` : oui.** **`add_note` : plus tard** (il faudrait une table de notes ; l'historique suffit pour l'instant) |

## Règles communes à tous les outils

### Connexion

- Transport HTTP du SDK MCP (*Streamable HTTP*), à l'adresse `/mcp` de Cockpit.
- Le jeton voyage dans l'en-tête `Authorization: Bearer …`, **jamais dans les arguments** : il ne peut donc pas finir dans l'historique. Le `.mcp.json` d'un repo n'y met qu'une référence à une variable d'environnement (`${COCKPIT_MCP_TOKEN}`), jamais le jeton lui-même.
- Jeton inconnu ou révoqué : refus, journalisé avec `user_id` vide (002). Jeton valide : `last_used_at` mis à jour.

### Accès

- Chaque objet demandé (projet, ticket, US, critère, run, question) passe par **la fonction unique** qui vérifie que l'utilisateur du jeton est **membre** de son projet (002, décision 1 ; 008).
- Un objet d'un autre utilisateur est refusé **comme s'il n'existait pas** (« not found ») : on ne révèle pas son existence.
- **Projet archivé** : les lectures restent possibles, les écritures sont refusées. `list_projects` et `search` ne montrent pas les projets archivés.

### Réponses

- **Réussite** : un objet JSON.
- **Refus** : la demande est comprise mais interdite ou impossible dans l'état actuel. Le message commence par `Refused:`, dit pourquoi et quoi faire. Exemple : `Refused: story 42 is "to_validate"; only "ready" stories can be started. Ask the user to validate it in Cockpit.`
- **Erreur** : quelque chose a échoué (GitHub injoignable, bug). Le message commence par `Error:` et dit si l'on peut réessayer.
- Refus et erreurs sont renvoyés comme **résultat d'outil marqué en erreur** (`isError: true`), pas comme une erreur du protocole : c'est ce qui permet à Claude de lire le message et d'adapter sa conduite ([spécification MCP, gestion des erreurs](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling)).
- Des arguments qui ne respectent pas le schéma Zod de l'outil donnent un **refus** qui nomme le champ fautif.

### Journal

**Chaque appel laisse une entrée** dans `history`, sans exception : réussite, erreur, refus, outil inconnu, jeton invalide.

| Colonne (002) | Valeur |
|---|---|
| `actor`, `origin` | `claude`, `mcp` |
| `token_id` | Le jeton utilisé (vide s'il est invalide) |
| `action` | Le nom de l'outil |
| `args` | Les arguments, en JSON |
| `result` | `ok`, `error` ou `refused` |
| `detail` | La réponse ou le message de refus ou d'erreur |
| `project_id`, `ticket_id`, `story_id`, `run_id` | Les objets concernés, quand l'outil en touche |

Un outil qui modifie quelque chose le fait **dans la même transaction** que son entrée (1.4).

### Descriptions

Chaque outil a une description en anglais, écrite pour qu'une demande vague mène au bon outil (« use this when the user mentions a ticket by a few words »). Elles font partie du produit et se relisent comme du code.

## Les outils

16 outils, en quatre familles. Les textes demandés sont **non vides** une fois les espaces retirés, avec une longueur maximale fixée dans le schéma.

### Lire et chercher

| Outil | Demande | Rend | Refus |
|---|---|---|---|
| `list_projects` | — | Les projets non archivés : `id`, `full_name`, `default_branch` | — |
| `get_project` | `project_id` | Le projet, son `CLAUDE.md` (lu sur GitHub ; vide s'il n'existe pas) et ses tickets (`id`, titre, étape) | Projet introuvable. GitHub injoignable → erreur, à réessayer |
| `search` | `query` (2 à 200 caractères), `project_id` facultatif | Au plus 20 résultats : type (projet, ticket, US), `id`, titre, projet, étape ou statut | — (aucun résultat n'est pas un refus) |
| `get_ticket` | `ticket_id` | Le ticket (titre, description, étape) et le résumé de ses US (`id`, statut, « je veux ») | Ticket introuvable |
| `get_user_story` | `story_id` | Tout ce qu'il faut pour développer : récit, notes, statut, commentaire de réécriture, branche, PR, critères (`id`, Given/When/Then, résultat, preuve), dépendances avec leur statut, projet et branche par défaut, ticket, run actif | US introuvable |

`search` cherche **tous** les mots de la requête, sans tenir compte des majuscules, dans le nom des projets, le titre des tickets et le récit des US.

### Créer un ticket

| Outil | Demande | Fait | Refus |
|---|---|---|---|
| `create_ticket` | `project_id`, `title`, `description_md` facultative | Crée un ticket (étape « Nouveau ») et rend son `id` | Projet introuvable ou archivé |

### Écrire les US

| Outil | Demande | Fait | Refus |
|---|---|---|---|
| `list_tickets_needing_us` | `project_id` facultatif | Rend deux listes : les **tickets sans US** (avec leur description et leur projet) et les **US à réécrire** (avec le commentaire de l'humain et leur ticket). Projets archivés et tickets abandonnés exclus. *(Modifié par la [017](017-user-stories.md), choix F et N : les tickets dont l'écriture n'est pas close y figurent aussi, avec le nombre d'US déjà écrites.)* | — |
| `create_user_stories` | `ticket_id` et une liste d'US (au moins une). Chaque US : `as_a`, `i_want`, `so_that`, `notes_md` facultatives, **au moins un critère** (`given`, `when`, `then`), et `depends_on` facultatif : les positions d'**US précédentes du même envoi** | Crée **toutes** les US d'un coup (tout ou rien), au statut `to_validate`, dans l'ordre donné | Ticket introuvable, abandonné, ou **qui a déjà des US** (un ticket n'est écrit qu'une fois) ; projet archivé ; champ vide ; US sans critère ; dépendance vers une position qui n'est pas antérieure. *(Modifié par la [017](017-user-stories.md), choix N : un gros ticket s'écrit en plusieurs envois, `depends_on` donne des positions dans le ticket, et l'écriture se clôt explicitement.)* |
| `update_user_story` | `story_id`, `as_a`, `i_want`, `so_that`, `notes_md` facultatives, la **liste complète** des critères (au moins un) | Remplace le récit et les critères, vide `rewrite_comment`, passe l'US de `to_rewrite` à `to_validate` | US qui n'est pas `to_rewrite` ; champ vide ; aucun critère |

Deux précisions :

- **Dépendances seulement vers une US précédente du même envoi** : cela suffit pour découper un ticket, et rend toute boucle impossible sans avoir à la détecter. Les dépendances entre tickets viendront si le besoin se présente.
- **Remplacer les critères à la réécriture est sans risque** : une US `to_rewrite` n'a jamais été développée, ses critères n'ont donc aucun résultat à perdre.

### Développer

| Outil | Demande | Fait | Refus |
|---|---|---|---|
| `start_run` | `story_id`, `branch`, `model` (celui sur lequel tourne la session), `comment` facultatif (le prompt complémentaire) | Crée le run (`running`) et passe l'US de `ready` à `in_progress`. Enregistre la branche sur l'US si elle n'en a pas. Rend le `run_id` et l'US (comme `get_user_story`) | US qui n'est pas `ready` ; un run déjà actif sur l'US (index unique, 002) ; branche différente de celle déjà enregistrée sur l'US ; projet archivé |
| `report_step` | `run_id`, `agent` (`test-writer`, `developer`, `reviewer`…), `event` (`started` ou `finished`) ; si `finished` : `status` (`succeeded` ou `failed`) et `summary` facultatif | Ouvre ou clôt une étape. **Rend `stop_requested`** : c'est ainsi que Claude apprend que l'humain demande l'arrêt | Run qui n'est pas `running` ; `finished` sans étape ouverte pour cet agent |
| `report_criterion` | `run_id`, `criterion_id`, `result` (`passed` ou `failed`), `evidence` | Enregistre le résultat et sa preuve sur le critère, avec le run qui l'a donné | Run qui n'est pas `running` ; critère qui n'appartient pas à l'US du run |
| `ask_user` | `run_id`, `question`, `suggested_answers` facultatives (au plus 2, pour les touches `1` et `2` de l'accueil) | Enregistre la question, qui apparaît en tête de l'accueil. Rend le `question_id` **tout de suite** | Run qui n'est pas `running` ; une question de ce run attend déjà sa réponse |
| `get_answer` | `question_id` | Rend `answered`, la réponse si elle existe, et `stop_requested` | Question introuvable |
| `link_pull_request` | `run_id`, `pr_number` | Vérifie sur GitHub que la PR existe et part de la branche de l'US, l'enregistre sur l'US et passe l'US de `in_progress` à `in_review` | Run qui n'est pas `running` ; US qui n'est pas `in_progress` ; PR introuvable ou sur une autre branche. GitHub injoignable → erreur, à réessayer |
| `finish_run` | `run_id`, `outcome` (`succeeded` ou `failed`), `summary` | Clôt le run. Si l'arrêt était demandé et que le run n'a pas réussi, il est noté `stopped`. Si l'US est encore `in_progress`, elle redevient `ready` | Run qui n'est pas `running` ; `succeeded` sans PR liée |

**Pourquoi `ask_user` et `get_answer` sont deux outils.** Une réponse humaine peut prendre des heures, et un appel MCP ne peut pas rester ouvert aussi longtemps : selon la version et l'application, Claude Code coupe un appel au bout d'une seconde à quelques minutes ([anthropics/claude-code#47076](https://github.com/anthropics/claude-code/issues/47076), [#63379](https://claudeissues.com/issue/63379-bug-desktop-app-cancels-stdio-mcp-tool-calls-at-60s-and-ignores-mcp-tool-timeout)). Claude dépose donc sa question, puis repasse voir la réponse. Le skill `/dev-us` espacera ces passages (par exemple 30 secondes, puis de plus en plus) : chacun laisse une entrée dans le journal.

## Table des droits

Qui peut faire chaque transition d'une US, et par où. Elle reprend le brief (§5) ; chaque ligne aura son test (tranche 4.4).

| Transition | Claude (outil MCP) | Humain (interface) | GitHub (webhook) |
|---|---|---|---|
| Créer → `to_validate` | `create_user_stories` | — | — |
| `to_validate` → `ready` (valider) | **jamais** | oui *(et depuis `to_rewrite`, 018 B ; l'humain modifie aussi une US `to_validate`, `to_rewrite` ou `ready` sans en changer le statut, 018 C)* | — |
| `to_validate` → `to_rewrite` (renvoyer, commentaire obligatoire) | **jamais** | oui | — |
| `to_rewrite` → `to_validate` (réécrire) | `update_user_story` | — | — |
| `ready` → `in_progress` *(et `in_review` → `in_progress`, 037 E)* | `start_run` | — | — |
| `in_progress` → `in_review` | `link_pull_request` | — | — |
| `in_progress` → `ready` (run échoué ou arrêté avant la PR) *(→ `in_review` si une PR est liée, 037 C)* | `finish_run` | fermeture à la main d'un run muet | — |
| `in_review` → `done` (PR mergée) | **jamais** | **jamais** | oui |
| `in_review` → `ready` (PR fermée sans merge) | **jamais** | — | oui |
| n'importe quel état → `abandoned` | **jamais** | oui | — |

## Ce qu'aucun outil ne fait

Valider, renvoyer, terminer ou abandonner une US ; modifier une US qui n'est pas à réécrire ; supprimer un ticket ; merger ; supprimer une branche ; modifier ou effacer l'historique ; committer un workflow ; créer, voir ou révoquer un jeton ; fermer un run à la main.

## Conséquences

- **Modèle de données (002)** : la table `questions` reçoit une colonne `suggested_answers` (JSON, facultative).
- **Découpage** : `search`, `get_ticket` et `create_ticket` rejoignent la tranche 4.2, à côté de `list_projects` et `get_project`. `get_user_story` rejoint la 4.3, et `search` y couvre aussi les US.
- **Skills** : `/write-us` s'appuie sur `list_tickets_needing_us`, `get_project`, `create_user_stories` et `update_user_story`. `/dev-us` sur `get_user_story`, puis les outils de la famille « Développer ».
- **Fausse PR impossible** : `link_pull_request` vérifie la PR sur GitHub. Le test passe par le faux GitHub (principe n° 9 du brief).

## Limites connues

- **Un jeton volé** donne accès à tous les projets dont son utilisateur est membre, mais jamais à valider, merger ou effacer quoi que ce soit, puisque ces outils n'existent pas. On le révoque dans les réglages.
- **Un secret écrit par Claude dans un résumé ou une preuve** serait journalisé tel quel. Les arguments ne sont pas censés en contenir ; un masquage par motifs pourra s'ajouter si le cas se présente.
- **`search` est simple** : « connexion » ne trouve pas « login ». Les descriptions des outils invitent Claude à essayer d'autres mots ou à lister les tickets du projet.

## Points ouverts

1. ~~**Relancer une US en revue**~~ (tranché par la [037](037-arreter-relancer-fermer.md) E : `start_run` accepte une US `in_review`) (CI rouge après l'ouverture de la PR) : ~~`start_run` n'accepte qu'une US `ready`. À trancher en tranche 7.5 : autoriser `in_review` → `in_progress` pour une relance, ou attendre la relance automatique (après le MVP).~~
2. ~~**Modèle demandé** (`runs.model_requested`)~~ : réglé par la [005](005-lancement-local.md). Le modèle est fixé dans la fiche des agents ; la colonne est retirée.

## Pistes écartées

- **Outils génériques** (`update_status`, `get(type, id)`) : moins d'outils, mais toutes les règles dans un seul, où un oubli laisserait passer une transition interdite.
- **Pas de recherche** : Claude devrait tout lister pour retrouver un ticket, avec plus d'appels et plus d'erreurs.
- **Une seule question qui attend sa réponse dans le même appel** : coupée par les délais de Claude Code (voir plus haut).
- **Jetons par usage dès le MVP** : utiles seulement avec les routines, qui viennent après.
