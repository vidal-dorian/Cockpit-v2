# 008 — Cockpit, service en ligne

- **Statut** : validée
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md), [002 — Modèle de données](002-modele-donnees.md), [004 — Outils MCP](004-outils-mcp.md), [006 — Connexion OAuth](006-connexion-oauth.md)
- **Modifiée par 012** : la règle « seuls les comptes listés entrent sur le Pi » (tranche 1.3) est remplacée par l'inscription ouverte et une liste de comptes bloqués, à la demande de Dorian — voir la [012](012-configuration-automatique.md), choix G
- **Modifie** : la base de données de la [001](001-stack.md) (SQLite → PostgreSQL) ; le propriétaire, l'unicité de `github_repo_id` et les types de colonnes de la [002](002-modele-donnees.md) ; l'accès d'un jeton dans la [004](004-outils-mcp.md) ; le brief §3 (hébergement) et §9 (plusieurs personnes sur un projet)

## Contexte

Cockpit pourra être vendu à des particuliers et à des professionnels, et beaucoup de personnes pourraient l'utiliser en même temps. Les décisions 001 et 002 supposaient une instance sur le Raspberry Pi, avec SQLite, et un seul propriétaire par projet.

La charge n'est pas le problème principal : Cockpit n'appelle jamais Claude, c'est l'abonnement Claude de chaque utilisateur qui fait le travail lourd. Cockpit ne fait que lire et écrire en base, recevoir des webhooks et répondre au MCP. Ce qui change avec des clients payants, c'est la **fiabilité**, l'**isolation entre clients**, la possibilité de **lancer plusieurs instances** et les **sauvegardes**.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Comment Cockpit est-il distribué ? | **Un service en ligne**, hébergé par Dorian. Les clients s'y connectent avec GitHub ; ils n'installent rien |
| B | Où tourne-t-il ? | **Sur le Pi** tant que seuls Dorian et des proches l'utilisent. **Chez un hébergeur** dès les premiers clients payants, pour ne plus gérer pannes, réseau et disques. Rien dans le code ne dépend du Pi : tout passe par des variables d'environnement |
| C | Comment le Pi est-il joignable depuis Internet ? | **Cloudflare Tunnel**, sur le domaine de Dorian déjà géré par Cloudflare (point laissé ouvert par la 001). Aucun port ouvert sur la box |
| D | Quelle base ? | **PostgreSQL 18**, à la place de SQLite |
| E | Comment tester sans serveur de base ? | **PGlite** : un PostgreSQL qui tourne dans le processus des tests, en mémoire, sans Docker. Drizzle le gère (`drizzle-orm/pglite`). Le principe « base en mémoire dans les tests » ne change pas |
| F | Plusieurs personnes sur un projet ? | **Le modèle le prévoit dès maintenant, l'application ne le permet pas encore.** Une table de membres remplace le propriétaire unique ; un index limite chaque projet à un seul membre, et une migration le retirera le jour du partage |

## D. Pourquoi PostgreSQL

| | SQLite (001) | PostgreSQL |
|---|---|---|
| Plusieurs instances de Cockpit | Impossible : un fichier, sur un seul serveur | Oui : toutes les instances parlent à la même base |
| Écritures simultanées | Une à la fois | Plusieurs à la fois, chacune avec ses verrous |
| Sauvegarde | Copie du fichier | Sauvegarde continue et restauration à une date précise, fournies par les hébergeurs |
| Chez un hébergeur | Rarement proposé | Proposé par tous, géré pour nous |
| Ce qu'on perd | — | Un service de plus à faire tourner ; les requêtes deviennent asynchrones (`await`) |

**Pourquoi maintenant** : la seule table existante est `users`. Chaque tranche ajoutée rendrait le changement plus coûteux.

**Pilote** : `pg` (node-postgres) avec `drizzle-orm/node-postgres`, le plus répandu et le mieux documenté.

**Ce qui reste valable de la 002** : les contraintes `CHECK`, l'index unique conditionnel (un seul run actif par US) et les triggers qui rendent l'historique inaltérable existent aussi en PostgreSQL. Les triggers s'écrivent en PL/pgSQL (`RAISE EXCEPTION`) et couvrent aussi `TRUNCATE`.

## F. Les membres d'un projet

`projects.owner_id` disparaît au profit d'une table **`project_members`** :

| Colonne | Rôle |
|---|---|
| `project_id`, `user_id` | Clé primaire sur le couple |
| `role` | `owner` seulement pour l'instant (`CHECK`) ; d'autres rôles viendront avec le partage |
| `created_at` | Date d'ajout |

- **Un repo GitHub = un projet Cockpit** (`github_repo_id` unique) : un webhook va sans ambiguïté à un seul projet. Une deuxième personne sur le même repo y sera ajoutée comme membre. **Au MVP**, comme un projet n'a qu'un membre, une deuxième personne qui ajoute un repo déjà suivi est refusée avec un message neutre (« Ce repo est déjà suivi dans Cockpit »), sans dire par qui. Avant, chacun pouvait suivre le même repo de son côté (unique sur `owner_id` + `github_repo_id`).
- **Un seul membre par projet** au MVP, garanti par un **index unique sur `project_id`**. Le partage n'aura qu'à supprimer cet index et à élargir `role`.
- **La fonction unique d'accès** (002, décision 1) vérifie que l'utilisateur est **membre** du projet, et non plus qu'il en est le propriétaire. C'est le seul endroit à changer le jour du partage.
- **004** : un jeton donne accès aux projets dont son utilisateur est **membre**.
- `runs.user_id` reste : il dit qui a lancé le run, ce qui servira quand plusieurs membres travailleront sur un projet.
- Le **partage entre utilisateurs individuels** (brief §6.19) devient le modèle. Les organisations (une équipe qui possède des projets et paie pour eux) restent à décider avec la facturation.

## Ce qui change dans les conventions de la 002

| Sujet | Avant (SQLite) | Après (PostgreSQL) |
|---|---|---|
| Dates | Texte ISO 8601 en UTC | `timestamptz` ; Drizzle rend des `Date` JavaScript |
| JSON (`args`, `detail`, `suggested_answers`…) | Texte | `jsonb` |
| Identifiants | Entiers auto-incrémentés | Entiers `generated always as identity` : toujours « US 42 » |
| Transactions | Synchrones (better-sqlite3) | Asynchrones : `await db.transaction(async (tx) => …)`. « Vérifier le droit → appliquer → journaliser » reste une seule transaction (1.4) |
| Valeurs fermées | Texte + `CHECK` | Inchangé : texte + `CHECK`, plus simple à faire évoluer qu'un type `enum` PostgreSQL |

## Une seule instance d'abord, sans s'interdire d'en lancer plusieurs

Sur le Pi, une instance suffit. Pour pouvoir en lancer plusieurs plus tard, on suit une seule règle : **ce qui doit survivre à un redémarrage va en base**. Trois choses restent en mémoire tant qu'il n'y a qu'une instance, et devront passer en base avant la deuxième :

| Gardé en mémoire | Avant la deuxième instance |
|---|---|
| Les connexions SSE (001) | Prévenir les autres instances par `LISTEN` / `NOTIFY` de PostgreSQL |
| Les codes d'autorisation OAuth (006) | Une table, avec expiration à 60 s |
| Les sessions du transport MCP | Le mode sans session du SDK MCP |

*Depuis la [016](016-serveur-mcp.md), le MCP tourne sans session : il ne garde plus rien en mémoire. La liste à jour est dans [l'architecture](../architecture.md#montée-en-charge), « Montée en charge ».*

## Webhooks : enregistrer d'abord, traiter ensuite

Avec beaucoup de clients, les webhooks GitHub arrivent par rafales, et GitHub compte une livraison comme échouée si la réponse prend plus de 10 secondes ([docs GitHub](https://docs.github.com/en/enterprise-server@3.9/webhooks/using-webhooks/best-practices-for-using-webhooks)). La tranche 5.1 suit donc ce schéma : vérifier la signature, **enregistrer la livraison en base** (identifiée par son en-tête `X-GitHub-Delivery`, ce qui évite les doublons), répondre `2xx`, puis la traiter à part. Une livraison dont le traitement échoue reste en base et peut être relancée.

## Données personnelles

Un client peut demander l'effacement de ses données (RGPD), alors que l'historique est inaltérable. Pour concilier les deux, **l'historique ne contient pas de données personnelles en clair** : il garde des identifiants (`user_id`), et le nom, le login et l'avatar restent dans `users`. Supprimer un compte rend anonyme sa ligne `users` sans toucher à l'historique. À appliquer dès la tranche 1.4.

## Conséquences sur le découpage

- **Nouvelle tranche 1.1 bis, avant 1.2** : passer de SQLite à PostgreSQL. Pilote `pg`, PGlite dans les tests, migration de départ régénérée pour PostgreSQL, conventions de `CLAUDE.md` mises à jour. La migration SQLite n'a jamais été appliquée ailleurs qu'en local : elle est remplacée et non complétée, ce qui est une exception assumée à la règle « ne jamais modifier une migration appliquée ».
- **1.2** : Docker Compose sur le Pi, avec trois services : Cockpit, PostgreSQL (données dans un volume) et `cloudflared`. Ajout d'une sauvegarde quotidienne (`pg_dump`). Le jeton du tunnel et le mot de passe de la base restent sur le Pi, hors du repo.
- **1.3** : ~~la liste de comptes autorisés reste tant que Cockpit est sur le Pi ; l'inscription ouverte viendra avec la facturation~~ — modifié par la [012](012-configuration-automatique.md) (G) : l'inscription est ouverte dès la 1.6, avec une liste de comptes bloqués.
- **1.4** : triggers PostgreSQL ; pas de données personnelles en clair dans l'historique.
- **2.1** : le test d'isolation passe par `project_members`.
- **5.1** : webhooks enregistrés avant d'être traités.
- **Après le MVP** : passage chez un hébergeur ; facturation (offre gratuite et offre payante, avec les fonctions payantes bloquées côté serveur, dans l'API et le MCP) ; plusieurs membres par projet.

## Limites connues

- **PGlite n'est pas exactement le PostgreSQL de production** : certaines extensions manquent, et il démarre en quelques secondes par instance (d'où des délais de test de 30 s). **Vérifié en 1.1 bis** : PGlite 0.5.11 fait tourner PostgreSQL 18.6, la même version majeure que la production.
- **PGlite reste dans l'image de production** sans être chargé : Drizzle le déclare comme dépendance facultative, et npm le garde avec `--omit=dev` (environ 26 Mo). Aucun code de production ne l'importe.
- **Sur le Pi, PostgreSQL consomme plus de mémoire que SQLite** (quelques centaines de Mo), ce qui reste raisonnable pour un Pi récent.
- **Des identifiants entiers communs à toute l'instance** laissent deviner le volume d'activité (« US 4210 »). C'est accepté pour la lisibilité ; un identifiant public opaque pourra s'ajouter si des clients le demandent.
- **Un trigger peut être supprimé** par le propriétaire des tables. Chez l'hébergeur, l'application se connectera avec un rôle qui n'a ni `UPDATE` ni `DELETE` sur l'historique, et les migrations avec un autre rôle.

## Points ouverts

1. **Hébergeur** : à choisir au premier client payant, de préférence en Europe (RGPD), avec PostgreSQL géré.
2. **Facturation** : par utilisateur ou par organisation ? À décider avec les offres, dont les premières idées sont dans [`offres.md`](../offres.md).
3. ~~**Repo déjà suivi par un autre compte** : le refus révèle qu'un projet existe sur ce repo, alors que la 004 répond « introuvable » pour l'objet d'un autre utilisateur. Le risque est faible, puisque la personne a déjà accès au repo sur GitHub pour l'ajouter. À confirmer en 2.1.~~ Confirmé en 2.1 par la [011](011-import-projets.md) C : le refus neutre est gardé, risque accepté.
4. ~~**Contenu des `args` de l'historique** : un titre de ticket peut contenir une donnée personnelle.~~ Tranché par la [010](010-historique.md) (règle D) : jamais de texte libre ni de donnée personnelle dans les `args`.

## Pistes écartées

- **Logiciel que chaque client installe chez lui** : chaque client devrait créer sa propre GitHub App, rendre son serveur joignable depuis Internet et faire ses mises à jour. C'est trop de friction pour un particulier, et du support pour Dorian. Une version à installer soi-même pourra revenir si des professionnels la demandent.
- **Garder SQLite avec Litestream** (sauvegarde continue vers un stockage objet) : moins cher au début, mais toujours une seule instance, et un changement de base plus coûteux à chaque tranche ajoutée.
- **Une base par client** : isolation maximale, mais des migrations à appliquer sur des centaines de bases. La fonction unique d'accès suffit ; la sécurité par ligne de PostgreSQL (*row-level security*) pourra s'ajouter en défense supplémentaire.
- **Le partage de projets dès le MVP** : une fonctionnalité entière (invitations, rôles, droits), sans utilité tant que chacun travaille seul.
