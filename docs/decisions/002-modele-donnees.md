# 002 — Modèle de données

- **Statut** : validée
- **Date** : 2026-10-18
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md) (SQLite, Drizzle)

## Contexte

Ce modèle couvre le **MVP** : la boucle cœur en local (phases 1 à 8 du [découpage](../decoupage.md)). Ce qui vient ensuite (pièces jointes, routines, cloud, coût, partage…) s'ajoutera par de nouvelles tables ou colonnes, sans casser celles-ci.

## Principes

1. **On ne stocke pas ce qui se calcule.** L'étape d'un ticket, le verdict d'un run, le bilan de santé et le Kanban se déduisent des données : ils ne peuvent donc jamais se contredire.
2. **GitHub reste la source de vérité** pour les PR, la CI et la configuration Claude des repos. Cockpit en garde au plus une **copie de cache**, tenue à jour par les webhooks et relue par « Actualiser ».
3. **La base fait respecter les règles quand elle le peut** : statuts par contrainte `CHECK`, un seul run actif par US par index unique conditionnel, historique inaltérable par triggers. Une règle tenue par la base ne peut pas être oubliée par le code.

## Schéma

```mermaid
erDiagram
    users ||--o{ sessions : "se connecte"
    users ||--o{ mcp_tokens : possède
    users ||--o{ projects : possède
    users ||--o{ runs : lance
    projects ||--o{ tickets : contient
    tickets ||--o{ user_stories : "se découpe en"
    user_stories ||--o{ acceptance_criteria : a
    user_stories ||--o{ story_dependencies : "dépend de"
    user_stories ||--o{ runs : "est développée par"
    runs ||--o{ run_steps : comprend
    runs ||--o{ questions : pose

    users {
        int id PK
        int github_id UK
        text login
        text name
        text avatar_url
        text created_at
    }
    sessions {
        text id PK "empreinte du cookie"
        int user_id FK
        text expires_at
    }
    mcp_tokens {
        int id PK
        int user_id FK
        text name
        text token_hash UK
        text last_four
        text created_at
        text last_used_at
        text revoked_at
    }
    projects {
        int id PK
        int owner_id FK
        int github_repo_id
        text full_name
        text default_branch
        int installation_id
        text archived_at
        text created_at
    }
    tickets {
        int id PK
        int project_id FK
        text title
        text description_md
        text abandoned_at
        text created_at
        text updated_at
    }
    user_stories {
        int id PK
        int ticket_id FK
        int position
        text as_a
        text i_want
        text so_that
        text notes_md
        text status
        text rewrite_comment
        text branch
        int pr_number
        text pr_ci_state
        text pr_review_state
        int issue_number
        text issue_body_hash
        text created_at
        text updated_at
    }
    acceptance_criteria {
        int id PK
        int story_id FK
        int position
        text given_text
        text when_text
        text then_text
        text result
        text evidence
        int result_run_id FK
    }
    story_dependencies {
        int story_id PK, FK
        int depends_on_id PK, FK
    }
    runs {
        int id PK
        int story_id FK
        int user_id FK
        text status
        text model_requested
        text model_actual
        text stop_requested_at
        text comment
        text summary
        text started_at
        text finished_at
    }
    run_steps {
        int id PK
        int run_id FK
        text agent
        text status
        text summary
        text started_at
        text finished_at
    }
    questions {
        int id PK
        int run_id FK
        text question
        text suggested_answers
        text answer
        text asked_at
        text answered_at
    }
```

La table `history` n'apparaît pas dans le schéma : elle n'a **volontairement aucune clé étrangère** (voir plus bas).

## Les tables

### Comptes

| Table | Rôle | Règles |
|---|---|---|
| `users` | Un compte GitHub connecté à Cockpit | `github_id` unique. La liste des comptes autorisés est en configuration, pas en base (1.3) |
| `sessions` | Une connexion ouverte dans un navigateur | `id` est l'**empreinte** du cookie : si la base fuit, les sessions restent inutilisables |
| `mcp_tokens` | Un jeton MCP | Seule l'empreinte est stockée ; `last_four` sert à le reconnaître dans la liste. Révoqué = `revoked_at` rempli (4.1) |

### Projets

| Table | Rôle | Règles |
|---|---|---|
| `projects` | Un repo GitHub suivi par Cockpit | Unique sur (`owner_id`, `github_repo_id`). Le repo est identifié par `github_repo_id`, qui survit aux renommages ; `full_name` n'est qu'un affichage. Archivé = `archived_at` rempli |

Le **bilan de santé** n'a pas de table : il est relu sur GitHub à chaque affichage. Avec une GitHub App, le webhook est celui **de l'App** et non un webhook par repo : la ligne « webhook installé » du bilan devient « l'App est installée sur ce repo ».

### Tickets et user stories

| Table | Rôle | Règles |
|---|---|---|
| `tickets` | Une idée brute | Pas de colonne d'étape : elle se calcule (voir plus bas). `abandoned_at` couvre le seul cas décidé par l'humain |
| `user_stories` | Une US | `status` ∈ `to_validate`, `to_rewrite`, `ready`, `in_progress`, `in_review`, `done`, `abandoned` (`CHECK`) |
| `acceptance_criteria` | Un Given/When/Then d'une US | `result` ∈ `passed`, `failed` ou vide ; garde le **dernier** compte rendu, avec le run qui l'a donné |
| `story_dependencies` | « Cette US dépend de celle-là » | Clé primaire sur le couple ; une US ne dépend pas d'elle-même (`CHECK`). Sert au rappel au lancement (7.2) |

Sur `user_stories` :

- **`rewrite_comment`** : le commentaire du dernier renvoi. Claude le lit directement, sans fouiller l'historique ; il est vidé à la réécriture.
- **`branch`, `pr_number`** : sur l'US et non sur le run, car une relance réutilise la même branche et la même PR.
- **`pr_ci_state`, `pr_review_state`** : **copie de cache** de GitHub, mise à jour par les webhooks. Elle permet à l'accueil d'afficher « PR dont la CI échoue » sans interroger GitHub à chaque affichage.
- **`issue_body_hash`** : l'empreinte du dernier contenu publié par Cockpit dans l'issue. Si le texte sur GitHub ne correspond plus, l'issue a été modifiée à la main : Cockpit montre le diff entre l'issue et le rendu actuel de l'US (5.2).

### Runs

| Table | Rôle | Règles |
|---|---|---|
| `runs` | Un développement d'une US par Claude Code | `status` ∈ `running`, `succeeded`, `failed`, `stopped`, `closed_manually` (`CHECK`). **Index unique sur `story_id` où `status = 'running'`** : un seul run actif par US, garanti par la base. Arrêt demandé = `stop_requested_at` rempli |
| `run_steps` | Une étape d'un run, faite par un agent | `status` ∈ `running`, `succeeded`, `failed` |
| `questions` | Une question de Claude pendant un run | En attente tant que `answer` est vide. `suggested_answers` : au plus deux réponses proposées par Claude, en JSON, facultatives ([004](004-outils-mcp.md)) |

Le **verdict** de fin de run (« acceptable » ou « à vérifier ») n'est pas stocké : il se calcule à partir des critères et de `pr_ci_state` (7.7).

### Historique

| Colonne | Contenu |
|---|---|
| `id`, `at` | Identifiant et date |
| `user_id` | Le compte **au nom duquel** l'action a eu lieu (vide pour un appel refusé faute de jeton valide) |
| `actor` | `human`, `claude`, `github` ou `system` |
| `origin` | `ui`, `mcp`, `webhook` ou `system` |
| `token_id` | Le jeton MCP utilisé, s'il y en a un |
| `action` | Le nom de l'action métier ou de l'outil MCP |
| `project_id`, `ticket_id`, `story_id`, `run_id` | Les objets concernés, pour filtrer les onglets Historique et le journal global |
| `args` | Les arguments, en JSON, **secrets masqués** |
| `result` | `ok`, `error` ou `refused` |
| `detail` | Le résultat ou le message d'erreur, en JSON |
| `github_effects` | Ce qui a été fait sur GitHub, en JSON |

- Des triggers `BEFORE UPDATE` et `BEFORE DELETE` refusent toute modification et toute suppression (`RAISE(ABORT)`).
- **Aucune clé étrangère** vers les autres tables : un ticket peut être supprimé sans toucher à l'historique, et une entrée garde l'identifiant de l'objet même s'il a disparu.
- Une action et son entrée sont écrites **dans la même transaction** (1.4).

## Ce qui se calcule

### Étape d'un ticket

Dans cet ordre, la première règle qui s'applique l'emporte :

| Étape | Condition |
|---|---|
| Abandonné | `abandoned_at` rempli, **ou** toutes ses US sont abandonnées (et il en a au moins une) |
| Nouveau | Aucune US |
| En cours | Au moins une US `in_progress` ou `in_review` |
| À valider | Au moins une US `to_validate` ou `to_rewrite` |
| Terminé | Toutes ses US sont `done` ou `abandoned`, et au moins une est `done` |
| En cours | Au moins une US `done` et au moins une `ready` (le ticket est entamé) |
| Validé | Les autres cas : toutes ses US non abandonnées sont `ready` |

Deux cas que le brief ne tranchait pas :

- « En cours » passe avant « À valider » : un ticket dont une US est en développement est montré en cours, même si une autre attend encore la validation.
- Un ticket dont une US est terminée et une autre seulement prête est « En cours », pas « Validé » : le travail a commencé.

Un ticket n'est écrit qu'une fois : il n'est proposé à Claude que s'il n'a **aucune** US. Comme les US ne sont jamais supprimées (seulement abandonnées), aucune colonne supplémentaire n'est nécessaire.

### Autres calculs

- **Kanban** : les US du projet regroupées par `status`.
- **Accueil** : des requêtes sur `user_stories` (à valider, PR en revue, CI en échec), `questions` (sans réponse) et `runs` (en cours, échoués).
- **Bilan de santé** : relu sur GitHub.
- **Verdict d'un run** : critères + CI.

## Décisions

1. **Le propriétaire vit sur `projects`** (ainsi que sur `sessions`, `mcp_tokens` et `runs`). Tickets, US, critères et étapes y remontent par leur projet. Le propriétaire n'existe qu'à un seul endroit, et le partage de projet (après le MVP) s'ajoutera au même endroit. Chaque accès passe par une seule fonction qui vérifie que le projet appartient à l'utilisateur.
2. **Un ticket ne se supprime que s'il n'a aucune US** (étape « Nouveau »). Ensuite, on l'abandonne. Sinon, supprimer un ticket ferait disparaître des US déjà publiées en issues ou déjà développées.
3. **Le résultat d'un critère est le dernier compte rendu**, stocké sur le critère avec le run qui l'a donné. Les comptes rendus des runs précédents restent dans l'historique. Une table de résultats par run s'ajoutera si l'on veut revoir les critères de chaque run passé.

## Conventions

- **Identifiants** : entiers auto-incrémentés, communs à toute l'instance (US 42, ticket 17). Pas de numérotation par projet.
- **Dates** : texte ISO 8601 en UTC (`2026-10-18T14:03:00.000Z`) : lisible dans la base, triable tel quel.
- **Noms** des tables, colonnes et valeurs de statut en anglais ; libellés en français dans l'interface.
- **Valeurs fermées** (statuts, acteurs, origines) : colonnes texte avec contrainte `CHECK`, dont Drizzle tire aussi le type TS.
- **Suppressions** : clés étrangères en `ON DELETE RESTRICT` par défaut. Les seules suppressions prévues sont un ticket sans US et les sessions expirées.

## Hors de ce modèle

| Sujet | Où il vivra |
|---|---|
| Chemin du clone local | Décision 005 (lancement local) |
| Accès GitHub de Cockpit (jeton de l'utilisateur chiffré ou jeton de l'App) | Tranche 1.3 ; au plus deux colonnes sur `users` |
| Catalogue d'agents et de skills | Des fichiers livrés avec Cockpit, pas des données |
| Pièces jointes, priorité, tags, routines, cloud, coût, notifications, invitations, partage | Après le MVP, par de nouvelles tables ou colonnes |
