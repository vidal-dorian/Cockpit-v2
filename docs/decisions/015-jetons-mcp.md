# 015 — Les jetons MCP

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-25
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [002 — Modèle de données](002-modele-donnees.md), [004 — Outils MCP](004-outils-mcp.md), [006 — Connexion OAuth](006-connexion-oauth.md), [010 — Historique](010-historique.md), [012 — Configuration automatique](012-configuration-automatique.md)
- **Tranche** : 4.1 du [découpage](../decoupage.md)

## Contexte

Claude Code parle au serveur MCP de Cockpit avec un jeton (004). Cette tranche crée la table `mcp_tokens` décrite par la 002, et l'écran où chaque utilisateur crée, liste et révoque **ses** jetons. Le serveur MCP lui-même, qui lira ces jetons, vient en 4.2.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Quel format ? | `ckp_` suivi de 32 octets aléatoires (`crypto.randomBytes`) en base64url : 43 caractères, 47 en tout. Le préfixe `ckp_` fait reconnaître un jeton Cockpit d'un coup d'œil et rend possible un **motif personnalisé** du secret scanning de GitHub (par exemple `ckp_[A-Za-z0-9_-]{43}`, défini par l'organisation : les motifs personnalisés n'existent que sur les dépôts d'une organisation, en GitHub Team ou Enterprise Cloud, avec GitHub Secret Protection, donc pas sur un compte personnel comme `vidal-dorian` ([docs GitHub](https://docs.github.com/enterprise-cloud@latest//code-security/secret-scanning/using-advanced-secret-scanning-and-push-protection-features/custom-patterns))). **Aucun motif dédié ne l'attrape par défaut** : le programme partenaire de GitHub demande un point d'accès de service qui reçoit les alertes, ce qu'un Cockpit auto-hébergé n'est pas. Seuls des détecteurs génériques d'entropie (gitleaks, trufflehog) peuvent le signaler |
| B | Que garde la base ? | Uniquement le **SHA-256** du jeton (`token_hash`, unique) et ses quatre derniers caractères (`last_four`, pour le reconnaître dans la liste). Un secret de 256 bits d'entropie n'a pas besoin d'un hachage lent (bcrypt, argon2) : on ne peut pas le deviner, et la vérification de la 4.2 se fait à chaque appel. Même fonction `sha256` que les sessions (009) |
| C | Quand le voit-on ? | **Une seule fois**, dans la réponse de la création. Il n'est ni relisible ni renvoyé par la liste. L'écran le garde dans l'état du composant seulement (ni cache TanStack, ni adresse), et l'efface au clic sur « J'ai copié le jeton » |
| D | Combien ? | **20 jetons actifs** au plus par utilisateur ; un jeton révoqué ne compte pas. Au-delà : 409 `too_many_tokens`, refus écrit dans l'historique. Le compte est fait dans la transaction de `act`, après un verrou `FOR UPDATE` sur la ligne de l'utilisateur : deux créations simultanées s'attendent et ne dépassent pas la limite. Le même verrou relit `blocked_at` : si un blocage a été validé après le contrôle de la session, la création est refusée (403 `account_blocked`, refus écrit dans l'historique) |
| E | Quelles routes ? | Pour l'utilisateur connecté, quel qu'il soit : `POST /api/me/tokens` `{ name }` (201 `{ token, secret }`), `GET /api/me/tokens` (du plus récent au plus ancien, jamais le secret ni l'empreinte), `POST /api/me/tokens/:id/revoke` (204). 401 sans session. Le nom est rogné, de 1 à 100 caractères, sans NUL : sinon 400 **avant** `act`, rien n'est écrit |
| F | Qui voit et révoque quoi ? | Chacun **ses** jetons. Un jeton d'un autre, inconnu ou à l'identifiant invalide répondent tous 404, sans entrée d'historique. **L'administrateur ne voit ni ne révoque les jetons des autres** : un jeton agit au nom de son propriétaire, l'administrateur qui le verrait n'aurait pas de raison de le toucher, et pour couper l'accès d'un compte il le bloque (012 G) |
| G | Et une révocation ? | `revoked_at` est rempli, la ligne reste : un jeton révoqué **reste listé** (« Révoqué »), pour que l'historique et la liste racontent la même chose. Révoquer deux fois : 409 `already_revoked`, la première date est gardée. La page demande une confirmation sur place (003, règle 4) |
| H | Que garde l'historique ? | `create_token` et `revoke_token`, avec `args: { tokenId }` seulement. **Jamais le nom** (texte libre) **ni le secret** (010 D). Le Journal les nomme « Jeton créé » et « Jeton révoqué » |
| I | Qui ouvre « Réglages » ? | **Tout utilisateur connecté** : le lien du bandeau et la page sont ouverts à tous, pour leurs jetons. La section « Utilisateurs » (et la route `/api/settings/users`) reste réservée à l'administrateur. Cela précise la 012 G, qui faisait de « Réglages » la page de l'administrateur |

## Ce que la 4.2 devra faire

- Lire `Authorization: Bearer ckp_…`, hacher le jeton et chercher `token_hash` ; un jeton inconnu ou révoqué est refusé et journalisé.
- Remplir `last_used_at` à chaque appel accepté (la page affiche déjà « Jamais utilisé » ou la date).
- **Refuser les jetons d'un utilisateur bloqué** (012 G) : le blocage ferme ses sessions mais pas encore ses jetons.
- Ajouter à `history` une colonne `token_id` (sans clé étrangère, comme `ticket_id`) pour savoir quel jeton a fait quel appel (002).

## Ce qui est repoussé

- L'expiration automatique des jetons, les droits par jeton (portée) et la rotation : pas au MVP.
- Un checksum dans le jeton (comme ceux de GitHub, contre les faux positifs des scanners).
- Les jetons OAuth de la 006 (colonnes facultatives de `mcp_tokens`) : plus tard.
- Pas de suppression d'un jeton : la révocation suffit, et la ligne sert de trace.

## Limites connues

- Le nom d'un jeton est du texte libre : il est affiché à son seul propriétaire, jamais écrit dans l'historique. Si l'insertion échoue sur une erreur de base inattendue, le log du serveur peut contenir les paramètres de la requête (nom, empreinte, quatre derniers caractères), jamais le jeton lui-même (010 D).
- Un jeton perdu ne se récupère pas : il se révoque et s'en crée un autre.

## Pistes écartées

- **Hachage lent (bcrypt, argon2)** : il protège les mots de passe, devinables ; un secret de 256 bits ne l'est pas, et le coût serait payé à chaque appel MCP.
- **Chiffrer le jeton pour pouvoir le réafficher** : une fuite de la base (et de la clé) donnerait des jetons utilisables ; « montré une fois » est plus sûr et plus simple.
- **Laisser l'administrateur révoquer les jetons de tous** : plus de pouvoir sans besoin ; le blocage d'un compte (012 G) coupera aussi ses jetons en 4.2.
