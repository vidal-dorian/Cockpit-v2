# 010 — Historique inaltérable

- **Statut** : validée
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [008 — Service en ligne](008-service-en-ligne.md), [009 — Connexion avec GitHub](009-connexion-github.md)
- **Modifiée par 053** : `GET /api/history` accepte des filtres et rend aussi `projectId`, `ticketId`, `storyId`, `runId`, `args`, `detail` et `retry` ; `GET /api/history/export` rend le CSV — voir la [053](053-journal-filtrable.md), choix A, B et H
- **Modifiée par 028** : `GET /api/history` rend 25 entrées par page, `{ entries, hasMore }`, et `?before=<id>` pour la suivante — voir la [028](028-creme-sombre-onglets-journal.md), choix F
- **Tranche** : 1.4 du [découpage](../decoupage.md)
- **Règle** : le point ouvert 4 de la [008](008-service-en-ligne.md) (données personnelles dans les `args`)

## Contexte

Le brief en fait une règle non négociable (§6.12, principe 4) : tout ce qui se passe laisse une trace, que personne ne peut modifier ni effacer, et une action n'existe pas sans sa trace. La 002 a décrit la table `history` ; cette tranche la crée, avec la fonction par laquelle passera chaque action métier, et journalise la connexion et la déconnexion (009).

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Comment la base protège-t-elle l'historique ? | Des **triggers PL/pgSQL** refusent `UPDATE`, `DELETE` (par ligne) et `TRUNCATE` (par requête) avec `RAISE EXCEPTION`. Écrits dans une **migration à la main** (`drizzle-kit generate --custom`), car drizzle-kit ne génère pas de triggers |
| B | Quelles colonnes maintenant ? | Celles dont la 1.4 se sert : `id`, `at`, `user_id`, `actor`, `origin`, `action`, `args`, `result`, `detail`. `token_id`, `project_id`, `ticket_id`, `story_id`, `run_id` et `github_effects` (002) arriveront par migration avec les tranches qui les remplissent. Aucune clé étrangère (002) |
| C | Comment passe une action métier ? | Par **une seule fonction**, `act(db, entrée, travail)`. Dans **une transaction** : le travail vérifie le droit, applique, puis l'entrée `ok` est écrite. Si le travail lève un **refus** (`Refused`), ou une erreur, la transaction est annulée (rien n'est appliqué) et une entrée `refused` ou `error` est écrite à part. Il n'y a donc aucune action sans trace, et aucun refus ni échec silencieux |
| D | Données personnelles (point ouvert 4 de la 008) | **Les `args` et le `detail` ne contiennent jamais de texte libre ni de donnée personnelle** : seulement des identifiants (`ticket 17`), des valeurs fermées (un statut) et des nombres. Le texte (titre d'un ticket, commentaire…) reste dans sa table, d'où il peut être effacé. Le journal affiche le texte actuel en le relisant par l'identifiant, s'il existe encore. **La raison d'un refus est un code fixe** choisi par le code (`account not allowed`, `no_session`…) ; **celle d'une erreur est toujours `error`**. Jamais un message d'erreur brut, qui peut contenir les paramètres d'une requête SQL ou du texte venu de l'extérieur : le message complet et le code précis (`token_http_500`…) ne vont que dans les logs du serveur |
| E | Connexion | `login` : `ok` avec l'utilisateur. Un compte **refusé** donne une entrée `refused` **sans rien qui l'identifie** (il n'a pas de ligne `users` à rendre anonyme). Un échec avec GitHub donne une entrée `error` dont la raison est `error` (le code précis, comme `token_http_500`, ne va que dans les logs). Une requête sans `state` valide (qui n'a donc pas été lancée depuis Cockpit) n'écrit **rien** dans l'historique, seulement dans les logs : sinon n'importe qui pourrait faire grossir une table qu'on ne peut pas vider. La création de la session et l'entrée `ok` sont dans la même transaction |
| F | Déconnexion | `logout` : `ok` avec l'utilisateur, seulement quand une session existait vraiment |
| G | Qui voit quoi ? | `GET /api/history` (connecté seulement) rend **ses propres entrées**, les 100 plus récentes. Les entrées sans utilisateur (refus, erreurs de connexion) ne sont visibles par personne pour l'instant ; l'administration viendra plus tard (brief §6.19) |
| H | La page Journal | Une page `/journal` (React Router, 001), reliée depuis l'en-tête : date, action, résultat (en mots et en couleur), origine. Les filtres (brief §6.12) viendront avec les projets<br>*Tranché par la [053](053-journal-filtrable.md) en 11.1 : le Journal se filtre (auteur, résultat, projet, outil, origine, période, recherche), s'exporte en CSV, et chaque projet a un onglet « Historique ».* |

## Limites connues

- **Un trigger peut être supprimé** par le propriétaire des tables. Chez l'hébergeur, l'application aura un rôle sans `UPDATE` ni `DELETE` sur `history` (008).
- **L'entrée d'erreur est écrite hors de la transaction annulée** : si la base elle-même est tombée, elle ne peut pas l'être non plus. L'erreur reste alors dans les logs du serveur.
- **Deux déconnexions simultanées** : la seconde trouve la session déjà supprimée et laisse une entrée `refused` (`no_session`) au lieu d'un second `ok`.
- **Une connexion lancée par un script** (`/api/auth/login` puis un retour avec erreur) peut encore ajouter des lignes, d'environ 150 octets chacune. Une limite de débit s'ajoutera si cela arrive.
- **La règle D repose sur la relecture** : le type de `args` n'accepte que des nombres, des booléens, `null` et des chaînes, et TypeScript ne peut pas distinguer une chaîne « fermée » d'un texte libre.

## Pistes écartées

- **Interdire la modification par les droits seulement** (`REVOKE UPDATE, DELETE`) : sur le Pi, l'application est propriétaire des tables et garde ces droits. Les triggers protègent dans tous les cas ; les droits s'ajouteront chez l'hébergeur.
- **Chiffrer les données personnelles du journal et jeter la clé à l'effacement** (*crypto-shredding*) : plus lourd, inutile si le journal n'en contient pas (règle D).
- **Journaliser dans des fichiers** : pas de requête possible pour la page Journal ni les filtres, et pas de transaction commune avec l'action.
