# Architecture de Cockpit

> L'état d'ensemble en dix minutes, à jour au **2026-11-20**. Il résume les décisions de [`decisions/`](decisions/), qui gardent le détail et le pourquoi de chaque choix ; les règles en vigueur sont dans [`regles.md`](regles.md). L'avancement tranche par tranche, le détail des briques, des tables, du déploiement et de la montée en charge, et l'index des décisions sont dans l'annexe de [`decoupage.md`](decoupage.md#annexe--le-détail-de-larchitecture). En cas de désaccord, la décision la plus récente fait foi, et ce document doit être corrigé.

## En une phrase

Cockpit est un **service en ligne** : un seul serveur Node (Hono) sert la page React, l'API, le serveur MCP et les webhooks GitHub, et garde ses données dans **PostgreSQL**. Il **n'appelle jamais Claude** : ce sont les sessions Claude Code de chaque utilisateur qui viennent à lui par le MCP.

## Les modules

- `src/server` : l'application Hono (`app.ts`), le point d'entrée (`index.ts`), la base (`db/` : schéma Drizzle, migrations dans `drizzle/`), les routes de l'API par domaine (projets, tickets, US, runs, équipes, webhooks), le serveur MCP (`/mcp`) et l'OAuth de son connecteur, les passages programmés (purge, routines, livraisons de webhooks, notifications). Une seule fonction d'accès, `memberProject`, garde chaque objet d'un projet ([002](decisions/002-modele-donnees.md), [076](decisions/076-plusieurs-utilisateurs.md)).
- `src/web` : la page React (Vite, React Router, TanStack Query, Tailwind v4, shadcn/ui, style « Quatre temps »). `api.ts` est le client typé des routes du serveur ; `public/` porte la PWA ([003](decisions/003-interface.md), [045](decisions/045-interface-quatre-temps.md), [072](decisions/072-pwa-et-notifications.md)).
- `catalog/` : les agents, skills, `CLAUDE.md`, équipes et CI de départ qu'« Préparer pour Claude » écrit dans le repo d'un utilisateur ([027](decisions/027-preparer-pour-claude.md), [049](decisions/049-mise-a-jour-du-catalogue.md)).
- `scripts/` : déploiement (`deploy.sh`), sauvegarde (`backup.sh`), test de fumée de la pile (`smoke-test.sh`).
- Les piles : TypeScript strict exécuté directement par Node 24, Zod sur toutes les entrées, PostgreSQL 18 (PGlite dans les tests), Biome et `tsc`, Vitest ([001](decisions/001-stack.md), [008](decisions/008-service-en-ligne.md)).

## Le trajet des données

```mermaid
flowchart LR
    subgraph Utilisateur
        B["Navigateur<br/>page React"]
        CC["Claude Code<br/>Desktop en local, ou cloud"]
    end
    subgraph Internet
        CF["Cloudflare Tunnel<br/>HTTPS"]
        GH["GitHub<br/>GitHub App, API, webhooks"]
        EOL["endoflife.date<br/>fin de vie des runtimes"]
    end
    subgraph Serveur["Serveur : le Pi, puis un hébergeur"]
        S["Cockpit (Node + Hono)<br/>/ page · /api · /mcp · /oauth · /api/webhooks/github · /v1/metrics · SSE"]
        PG[("PostgreSQL 18")]
    end
    B -- "HTTP + SSE" --> CF
    CC -- "MCP (jeton)" --> CF
    GH -- "webhooks signés" --> CF
    CF --> S
    S --> PG
    S -- "Octokit, identité de la GitHub App" --> GH
    S -- "lecture HTTPS, 5 s au plus (052)" --> EOL
    B -. "lien claude://code/new" .-> CC
```

- **Le navigateur** parle à l'API en HTTP, et reçoit en SSE « tel objet a changé » avant de recharger par l'API ([001](decisions/001-stack.md)). Il ouvre Claude Desktop avec un lien `claude://code/new` ; Cockpit ne voit jamais le PC ([005](decisions/005-lancement-local.md)).
- **Claude** vient au MCP par OAuth comme connecteur claude.ai ([006](decisions/006-connexion-oauth.md), [021](decisions/021-connecter-claude.md)) ou avec un jeton créé à la main ([004](decisions/004-outils-mcp.md)). Chaque outil écrit via la même fonction d'accès que l'API.
- **GitHub** reste la source de vérité du code, des PR et de la CI. Cockpit en garde un cache, tenu à jour par les webhooks signés : enregistrés d'abord, traités ensuite, sans doublon ([002](decisions/002-modele-donnees.md), [024](decisions/024-webhooks.md)). Il lui parle avec l'identité de sa GitHub App ([012](decisions/012-configuration-automatique.md)).
- **Une action métier** vérifie le droit, change la base et écrit l'entrée d'historique dans une seule transaction ([010](decisions/010-historique.md)).
- **PostgreSQL** garde tout ce qui doit survivre à un redémarrage ; seuls quelques caches restent en mémoire (connexions SSE, codes OAuth, fin de vie des runtimes), ce qui impose une instance unique pour l'instant ([008](decisions/008-service-en-ligne.md)).

## Le déploiement

- **Phase 1, le Pi** : une image Docker (Node, serveur, page construite), PostgreSQL en conteneur avec son volume, Cloudflare Tunnel sans port ouvert, sauvegarde `pg_dump` quotidienne par cron, mise en production par un workflow CD lancé à la main qui lance `scripts/deploy.sh` ([008](decisions/008-service-en-ligne.md)).
- **Phase 2, un hébergeur** : la même image, une base gérée avec sauvegarde continue.
- **Configuration** : une seule variable obligatoire, `DATABASE_URL` ; `PORT`, `COCKPIT_KEY_FILE` et `POSTHOG_KEY` (facultative, [083](decisions/083-telemetrie-posthog.md)) en option. La GitHub App et le premier administrateur viennent de l'assistant de démarrage, et la clé de chiffrement de ses secrets vit dans un volume à part ([012](decisions/012-configuration-automatique.md)). Le code ne contient rien de propre au Pi.

Le détail (sauvegardes, exposition, secrets) est dans l'annexe de [`decoupage.md`](decoupage.md#annexe--le-détail-de-larchitecture), « Déploiement ». Les points ouverts y sont aussi.
