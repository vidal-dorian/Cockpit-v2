# 023 — Réglages en onglets, adresse publique en https

- **Statut** : validée
- **Date** : 2026-10-30
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [012 — Configuration automatique](012-configuration-automatique.md), [021 — Connecter Claude](021-connecter-claude.md), [022 — Routine d'écriture des US](022-routine-ecriture-us.md), [010 — Historique](010-historique.md)
- **Modifie** : la [012](012-configuration-automatique.md), choix C (détection de l'adresse, et `https://` exigé)
- **Modifiée par 028** : la section « Adresse publique » de Réglages et `GET`/`PUT /api/settings/public-url` disparaissent (choix C), Réglages a quatre onglets (choix E) — voir la [028](028-creme-sombre-onglets-journal.md)
- **Modifiée par 024** : les choix C et G ne demandent plus à l'administrateur de changer l'adresse du webhook à la main sur GitHub : Cockpit le fait (`PATCH /app/hook/config`), et la page ne le demande que si cela échoue — voir la [024](024-webhooks.md), choix G
- **Modifiée par 028** (J) : l'assistant détecte l'adresse lui-même, sans champ à confirmer (choix B)
- **Répond à** : la demande du 2026-10-30 : « Claude attend un lien https et tu m'en donnes un http » ; « la partie dépliante, nomme-la "Connecter Claude depuis le CLI Claude Code" » ; « la création de la routine dans un onglet de la page Réglages »

## Contexte

Derrière le tunnel Cloudflare, l'assistant de démarrage a proposé une adresse en `http://`. L'hypothèse retenue, non vérifiable ici : avec un tunnel, `X-Forwarded-Proto` peut donner le protocole entre Cloudflare et le Pi (`http://app:3000`), alors que `CF-Visitor` donne celui du visiteur (`{"scheme":"https"}`). L'administrateur a confirmé l'adresse sans le voir. Or claude.ai n'accepte un connecteur qu'en `https://`, et l'OAuth de la 021 annonce cette adresse partout (`issuer`, `resource`). Il faut donc détecter juste, refuser `http://`, et corriger une instance déjà installée.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | La détection ? | L'en-tête `CF-Visitor` (JSON, `scheme` `http` ou `https`) l'emporte sur `X-Forwarded-Proto` ; sans lui, rien ne change (012 C) |
| B | Une adresse en `http://` ? | Refusée, à l'assistant comme dans Réglages : « L'adresse publique doit commencer par https:// : claude.ai l'exige. » Seule exception : `localhost`, `127.0.0.1` et `[::1]`, pour développer sur sa machine |
| C | Corriger une instance installée ? | Section « Adresse publique » de Réglages, **pour l'administrateur seulement** : l'adresse actuelle et un champ pour la changer (`GET /api/settings/public-url` rend `{ publicUrl, appSettingsUrl }` ; `PUT /api/settings/public-url`, corps `{ publicUrl }`, comme les autres routes d'administration de `/api/settings/`, gardée sous la forme d'une origine comme à l'assistant ; 400 si invalide, 403 pour un non-administrateur, 401 sans session). Cockpit la prend en compte tout de suite, sans redémarrer. Avant le bouton, la page dit ce qu'il faut faire **d'abord sur GitHub**, dans les réglages de l'App (lien `https://github.com/settings/apps/<slug>`) : ajouter l'adresse de retour `<nouvelle adresse>/api/auth/callback` (sinon la connexion GitHub échoue) et remplacer l'adresse du webhook par `<nouvelle adresse>/api/webhooks/github`. Cockpit ne les change pas lui-même : GitHub ne permet pas de changer l'adresse de retour d'une App par l'API. Elle dit aussi qu'un connecteur déjà ajouté sur claude.ai avec l'ancienne adresse est à rajouter |
| D | L'historique ? | `change_public_url` (humain, `ui`), `args: {}` (010 D : ni l'ancienne ni la nouvelle adresse) |
| E | Les onglets de Réglages ? | Deux onglets en tête de la page, des liens : **« Général »** (`/reglages` : Connecter Claude, Adresse publique, Utilisateurs, Jetons MCP) et **« Écriture automatique des US »** (`/reglages/ecriture-us` : la section de la 022). L'onglet ouvert est marqué (`aria-current="page"`). Le lien « Réglages » de la page d'un projet, quand la tâche n'est pas connectée, mène à l'onglet de la routine |
| F | La partie repliée de « Connecter Claude » ? | Son titre devient **« Connecter Claude depuis le CLI Claude Code »** ; son contenu ne change pas |

## Ce qui est repoussé

- Changer l'adresse du webhook de l'App par l'API (`PATCH /app/hook/config`) : avec la 5.1, qui recevra les webhooks et dont le bilan de santé dira si la dernière livraison a réussi.
- Les autres réglages en onglets : la page n'en a pas besoin.

## Limites connues

- **L'adresse de retour de l'App se change à la main sur GitHub.** Si l'administrateur change l'adresse sans l'ajouter, la connexion GitHub échoue jusqu'à ce qu'il le fasse (sa session en cours continue).
- **Non vérifiable ici** : la valeur de `X-Forwarded-Proto` et de `CF-Visitor` derrière un vrai tunnel (la documentation de Cloudflare n'est pas joignable depuis cette session).
