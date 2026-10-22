# 009 — Connexion avec GitHub

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-22
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [001 — Stack technique](001-stack.md), [002 — Modèle de données](002-modele-donnees.md), [008 — Service en ligne](008-service-en-ligne.md)
- **Tranche** : 1.3 du [découpage](../decoupage.md)

## Contexte

On se connecte à Cockpit avec son compte GitHub, au travers de la **GitHub App** de Cockpit (001, 002). Tant que Cockpit tourne sur le Pi, seuls les comptes listés en configuration entrent (008). La 002 laissait à cette tranche le choix de ce que Cockpit garde de l'accès GitHub de l'utilisateur.

## Le flux

C'est le flux « application web » des GitHub Apps ([docs GitHub](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)) :

1. « Se connecter avec GitHub » mène à `GET /api/auth/login`. Cockpit tire un `state` au hasard, le met dans un cookie de 10 minutes, et renvoie vers `https://github.com/login/oauth/authorize` avec le `client_id` de l'App, le `state` et l'adresse de retour `<PUBLIC_URL>/api/auth/callback`.
2. GitHub demande à l'utilisateur d'autoriser l'App, puis revient sur `/api/auth/callback` avec un `code` et le `state`.
3. Cockpit vérifie que le `state` est celui du cookie (sinon, quelqu'un d'autre a lancé la demande : on arrête), échange le `code` contre un jeton (`POST https://github.com/login/oauth/access_token`), et lit le compte avec `GET https://api.github.com/user`.
4. Compte autorisé : Cockpit crée ou met à jour la ligne `users` (par `github_id`), ouvre une session et revient sur l'accueil. Compte refusé : rien n'est créé, l'accueil affiche pourquoi.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Où vit la liste des comptes autorisés ? | **Dans la configuration** : `ALLOWED_GITHUB_LOGINS`, des logins séparés par des virgules, comparés sans tenir compte des majuscules (002). L'inscription ouverte viendra avec la facturation (008) |
| B | Cockpit garde-t-il le jeton GitHub de l'utilisateur ? | **Non.** Il ne sert ici qu'à lire le compte, puis il est oublié. Pour agir sur les repos (2.1), Cockpit utilisera les jetons d'**installation** de l'App, limités aux repos que l'utilisateur lui a ouverts : c'est le mode prévu par GitHub pour une App, et il n'y a aucun jeton d'utilisateur à chiffrer ni à rafraîchir. À confirmer en 2.1 |
| C | Comment la session est-elle tenue ? | Un **cookie `cockpit_session`** : 32 octets tirés au hasard, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` quand `PUBLIC_URL` est en `https`, valable **30 jours**. La base n'en garde que l'**empreinte SHA-256** (`sessions.id`, 002) : une fuite de la base ne donne aucune session utilisable |
| D | Déconnexion | `POST /api/auth/logout` supprime la ligne de session et efface le cookie. Un `POST` et non un lien, pour qu'une page tierce ne puisse pas déconnecter quelqu'un en chargeant une image |
| E | Que voit l'interface ? | `GET /api/me` rend le compte connecté, ou `401`. Sans session, l'accueil montre « Se connecter avec GitHub ». Les erreurs reviennent sur l'accueil (`/?erreur=…`) et s'affichent avec ce qu'il faut faire : compte non autorisé (avec son login), ou connexion échouée avec « Réessayer » |
| F | Octokit ? | **Pas encore** : deux appels `fetch` suffisent à la connexion. Octokit arrivera avec les appels à l'API des repos (2.1) |
| G | Configuration | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PUBLIC_URL` et `ALLOWED_GITHUB_LOGINS` : le serveur refuse de démarrer s'il en manque une, comme pour `DATABASE_URL` |

## Modèle de données

`sessions` comme prévu par la 002 : `id` (empreinte du cookie, texte, clé primaire), `user_id` (vers `users`), `expires_at` et `created_at` (`timestamptz`). Une session expirée est refusée et supprimée quand elle est présentée.

**Écart à la 002** : la 002 met les clés étrangères en `ON DELETE RESTRICT` par défaut. `sessions.user_id` est en `ON DELETE CASCADE`, car une session n'a aucun sens sans son compte, et supprimer un compte (RGPD, 008) doit fermer ses sessions.

## Limites connues

- **Un login GitHub peut changer.** La liste compare des logins, plus lisibles que des identifiants. Un compte renommé n'entre plus jusqu'à la mise à jour de la liste ; un login libéré puis repris par quelqu'un d'autre entrerait. Le risque est accepté tant que la liste ne contient que des proches.
- **Les sessions expirées non présentées restent en base** jusqu'à un nettoyage, à ajouter si la table grossit.
- **Pas d'historique ici** : la connexion et la déconnexion seront journalisées par la tranche 1.4.

## Ce que Dorian doit faire

Créer la GitHub App sur son compte (une seule fois) : voir le README, « Créer la GitHub App ».

## Pistes écartées

- **OAuth App** au lieu de la GitHub App : elle ne permet pas à chacun de choisir ses repos (brief §8).
- **Session dans un jeton signé (JWT) sans base** : impossible à révoquer avant son expiration, et la table `sessions` existe déjà dans la 002.
- **Garder le jeton de l'utilisateur, chiffré** : inutile tant que les jetons d'installation suffisent, et c'est un secret de plus à protéger.
