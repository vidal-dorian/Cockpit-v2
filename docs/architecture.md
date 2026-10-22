# Architecture de Cockpit

> L'état d'ensemble, à jour au **2026-10-22**. Il résume les décisions de [`decisions/`](decisions/), qui gardent le détail et le pourquoi de chaque choix. En cas de désaccord, c'est la décision la plus récente qui fait foi, et ce document doit être corrigé.

## En une phrase

Cockpit est un **service en ligne** : un seul serveur Node (Hono) sert la page React, l'API, le serveur MCP et les webhooks GitHub, et garde ses données dans **PostgreSQL**. Il **n'appelle jamais Claude** : ce sont les sessions Claude Code de chaque utilisateur qui viennent à lui par le MCP.

## Vue d'ensemble

```mermaid
flowchart LR
    subgraph Utilisateur
        B["Navigateur<br/>page React"]
        CC["Claude Code<br/>Desktop en local, ou cloud"]
    end
    subgraph Internet
        CF["Cloudflare Tunnel<br/>HTTPS"]
        GH["GitHub<br/>GitHub App, API, webhooks"]
    end
    subgraph Serveur["Serveur : le Pi, puis un hébergeur"]
        S["Cockpit (Node + Hono)<br/>/ page · /api · /mcp · /webhooks · SSE"]
        PG[("PostgreSQL 18")]
    end
    B -- "HTTP + SSE" --> CF
    CC -- "MCP (jeton)" --> CF
    GH -- "webhooks signés" --> CF
    CF --> S
    S --> PG
    S -- "Octokit, accès de l'utilisateur" --> GH
    B -. "lien claude://code/new" .-> CC
```

- **Le navigateur** ouvre Claude Desktop sur le PC avec un lien `claude://code/new` ([005](decisions/005-lancement-local.md)). Cockpit ne voit jamais le PC.
- **Claude Code** s'identifie avec un jeton MCP ([004](decisions/004-outils-mcp.md)), et plus tard par OAuth, comme connecteur claude.ai ([006](decisions/006-connexion-oauth.md)).
- **GitHub** reste la source de vérité du code, des PR et de la CI. Cockpit n'en garde qu'une copie de cache, tenue à jour par les webhooks ([002](decisions/002-modele-donnees.md)).

## Les briques

| Brique | Choix | Décision |
|---|---|---|
| Langage | TypeScript strict, exécuté directement par Node (*type stripping*) | [001](decisions/001-stack.md) |
| Serveur | Node.js 24, Hono | [001](decisions/001-stack.md) |
| Base | **PostgreSQL 18**, pilote `pg`, Drizzle et drizzle-kit | [008](decisions/008-service-en-ligne.md) (remplace SQLite) |
| Validation | Zod, sur toutes les entrées | [001](decisions/001-stack.md) |
| Temps réel | SSE minimal : « tel objet a changé », puis rechargement par l'API | [001](decisions/001-stack.md) |
| Interface | React, Vite, React Router, TanStack Query, Tailwind v4, shadcn/ui | [001](decisions/001-stack.md), [003](decisions/003-interface.md) |
| GitHub | Une seule GitHub App, installée par chaque utilisateur ; Octokit | [001](decisions/001-stack.md), [002](decisions/002-modele-donnees.md) |
| MCP | SDK officiel, transport HTTP, à l'adresse `/mcp` | [004](decisions/004-outils-mcp.md) |
| Tests | Vitest, Testing Library, **PGlite** (PostgreSQL en mémoire), faux GitHub | [001](decisions/001-stack.md), [008](decisions/008-service-en-ligne.md) |
| Qualité | Biome (lint et format), `tsc` ; la CI lance lint, typecheck, tests et build | [001](decisions/001-stack.md) |
| Exposition | Cloudflare Tunnel, sur le domaine de Dorian | [008](decisions/008-service-en-ligne.md) |

## Les règles qui tiennent l'architecture

Ce sont les points sur lesquels tout le reste s'appuie. Les changer, c'est revenir sur une décision.

1. **L'humain garde la main.** Valider, abandonner, merger : aucun outil MCP ne le permet. La table des droits est testée ligne par ligne ([004](decisions/004-outils-mcp.md)).
2. **Une seule fonction d'accès.** Tout objet remonte à son projet, et une seule fonction vérifie que l'utilisateur en est **membre** ([002](decisions/002-modele-donnees.md), [008](decisions/008-service-en-ligne.md)). Un objet d'un autre utilisateur répond « introuvable ».
3. **Une action métier = une transaction.** On vérifie le droit, on applique le changement et on écrit l'entrée d'historique **dans la même transaction**, ou rien n'est fait (tranche 1.4).
4. **Historique inaltérable.** Des triggers PostgreSQL refusent `UPDATE`, `DELETE` et `TRUNCATE`. Chez l'hébergeur, l'application n'aura en plus aucun droit d'écriture sur cette table hors `INSERT` ([008](decisions/008-service-en-ligne.md)).
5. **La base fait respecter ce qu'elle peut** : statuts par `CHECK`, un seul run actif par US par index unique conditionnel, un seul membre par projet au MVP par index unique ([002](decisions/002-modele-donnees.md)).
6. **On ne stocke pas ce qui se calcule** : l'étape d'un ticket, le Kanban, le verdict d'un run, le bilan de santé ([002](decisions/002-modele-donnees.md)).
7. **Aucun secret en clair** : jetons stockés par empreinte et affichés une seule fois ; secrets du serveur dans des variables d'environnement, hors du repo ; aucune donnée personnelle en clair dans l'historique ([004](decisions/004-outils-mcp.md), [008](decisions/008-service-en-ligne.md)).
8. **Les erreurs se voient** : à l'écran, avec « Réessayer » ; au démarrage, le serveur refuse de partir sans `DATABASE_URL`.
9. **Les tests n'appellent jamais Claude ni le vrai GitHub** : routes testées avec `app.request()` sur PGlite, écrans avec un `fetch` simulé.

## Les données

Le modèle complet est dans la [002](decisions/002-modele-donnees.md), modifiée par la [008](decisions/008-service-en-ligne.md) :

| Domaine | Tables |
|---|---|
| Comptes | `users`, `sessions`, `mcp_tokens` |
| Projets | `projects` (un repo GitHub = un projet), `project_members` |
| Travail | `tickets`, `user_stories`, `acceptance_criteria`, `story_dependencies` |
| Développement | `runs`, `run_steps`, `questions` |
| Trace | `history`, sans clé étrangère, inaltérable |
| Après le MVP | `criterion_sources` et les colonnes `kind` et `reasoning` pour la reprise ([007](decisions/007-reprise-app-existante.md)) ; colonnes OAuth sur `mcp_tokens` ([006](decisions/006-connexion-oauth.md)) ; livraisons de webhooks enregistrées (5.1) |

Conventions : dates en `timestamptz`, JSON en `jsonb`, identifiants entiers `identity`, identifiants GitHub en `bigint`, valeurs fermées en texte avec `CHECK`. Les migrations sont générées par drizzle-kit, appliquées au démarrage, et ne sont jamais modifiées une fois appliquées.

## Déploiement

| | Phase 1 : le Pi | Phase 2 : un hébergeur |
|---|---|---|
| Quand | Dorian et des proches | Dès les premiers clients payants |
| Cockpit | Image Docker (Node, serveur, page construite) | La même image |
| PostgreSQL | Conteneur, données dans un volume | Service géré : sauvegarde continue, restauration à une date |
| Sauvegarde | `pg_dump` quotidien | Fournie par l'hébergeur |
| Exposition | Cloudflare Tunnel (`cloudflared`), aucun port ouvert | Selon l'hébergeur |
| Mise en production | Workflow CD lancé à la main, runner sur le Pi, `scripts/deploy.sh` | À définir |
| Secrets | Fichier d'environnement sur le Pi, hors du repo | Gestion des secrets de l'hébergeur |

Le code ne contient rien de propre au Pi : tout passe par des variables d'environnement (`DATABASE_URL`, `PORT`, puis les secrets GitHub). Passer de la phase 1 à la phase 2, c'est déplacer l'image et la base.

## Montée en charge

- **La charge est faible par nature** : Cockpit ne fait tourner aucun modèle d'IA. Mille runs en parallèle représentent de l'ordre de cent écritures par seconde, ce qu'un seul serveur tient.
- **Une seule instance d'abord.** La règle : ce qui doit survivre à un redémarrage va en base. Trois choses restent en mémoire et devront passer en base avant une deuxième instance : connexions SSE (par `LISTEN` / `NOTIFY`), codes OAuth, sessions MCP (mode sans session) ([008](decisions/008-service-en-ligne.md)).
- **Webhooks : enregistrés d'abord, traités ensuite**, sans doublon grâce à `X-GitHub-Delivery` (5.1).
- **La connexion à la base survit à un redémarrage de PostgreSQL** : le pool de connexions écoute ses erreurs au lieu de faire tomber le serveur (1.1 bis).

## Ce qui existe dans le code aujourd'hui

| Élément | État |
|---|---|
| Serveur Hono, route `/api/health`, page React servie par le serveur | Fait (1.1) |
| Table `users`, migrations appliquées au démarrage | Fait (1.1), passée à PostgreSQL en 1.1 bis |
| Tests serveur sur PGlite, tests d'écran, lint, typecheck, CI | Fait |
| Workflow CD et `scripts/deploy.sh` | Squelette ; le vrai déploiement vient en 1.2 |
| Tout le reste (connexion GitHub, historique, projets, MCP…) | À faire, dans l'ordre du [découpage](decoupage.md) |

## Index des décisions

| # | Sujet | Statut | En bref |
|---|---|---|---|
| [001](decisions/001-stack.md) | Stack technique | Validée, modifiée par 008 | Node, Hono, React, Drizzle, Zod, SSE |
| [002](decisions/002-modele-donnees.md) | Modèle de données | Validée, modifiée par 008 | Tables du MVP, ce qui se calcule, historique |
| [003](decisions/003-interface.md) | Interface | Validée | « Qui doit agir ? », règles d'ergonomie, style |
| [004](decisions/004-outils-mcp.md) | Outils MCP | Validée | Ce que Claude peut faire, et ce qu'aucun outil ne fait |
| [005](decisions/005-lancement-local.md) | Lancement local | Validée | `claude://code/new`, modèle choisi par la fiche de chaque agent |
| [006](decisions/006-connexion-oauth.md) | Connexion OAuth | Validée | Cockpit comme connecteur claude.ai, après le MVP |
| [007](decisions/007-reprise-app-existante.md) | Reprendre une app existante | Proposée | La fonctionnalité phare : règles extraites du code, validées en regard du code |
| [008](decisions/008-service-en-ligne.md) | Service en ligne | Proposée | PostgreSQL, membres d'un projet, le Pi puis un hébergeur |
| [Offres](offres.md) | Gratuit, Pro, Entreprise | Notes, rien de décidé | Idées de prix et de quotas |

## Points ouverts

| Sujet | Où |
|---|---|
| Relancer une US en revue quand la CI échoue après la PR | [004](decisions/004-outils-mcp.md), tranche 7.5 |
| Cloudflare ne doit bloquer ni les adresses d'Anthropic ni les webhooks | [006](decisions/006-connexion-oauth.md), tranche 1.2 |
| Repo déjà suivi par un autre compte : refus qui révèle l'existence du projet | [008](decisions/008-service-en-ligne.md), tranche 2.1 |
| Choix de l'hébergeur ; facturation par personne ou par organisation | [008](decisions/008-service-en-ligne.md), [offres](offres.md) |
| Données personnelles possibles dans les `args` de l'historique | [008](decisions/008-service-en-ligne.md), tranche 1.4 |
| Écrans restants et version téléphone | [003](decisions/003-interface.md) |
| Granularité des règles et contrôle du mode « figer l'existant » | [007](decisions/007-reprise-app-existante.md) |
