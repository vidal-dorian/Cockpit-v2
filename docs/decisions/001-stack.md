# 001 — Stack technique

- **Statut** : validée
- **Date** : 2026-10-18
- **Décidé par** : Dorian, avec Claude
- **Modifiée par** : [008 — Service en ligne](008-service-en-ligne.md) : PostgreSQL remplace SQLite et better-sqlite3 ; l'exposition sur Internet est décidée (Cloudflare Tunnel)

## Contexte

Cockpit v2 est réécrit de zéro (aucun code de la v1). Il tourne sur un Raspberry Pi (Docker), joignable depuis Internet, et sert plusieurs développeurs. *(Depuis la 008 : service en ligne, sur le Pi d'abord puis chez un hébergeur.)* Dorian apprend TypeScript et relit toutes les PR : chaque brique doit pouvoir être **comprise**, pas seulement fonctionner. Moins de briques et moins de magie valent mieux que plus de fonctionnalités.

## Décision

| Brique | Choix | Rôle |
|---|---|---|
| Langage | **TypeScript** (mode strict) | Tout le code, serveur et interface |
| Moteur | **Node.js 24 LTS** (ou 26 dès qu'il est LTS) | Fait tourner le serveur |
| Exécution du TS | **Directement par Node** (*type stripping*), sans build du serveur | Une étape en moins ; les types sont vérifiés par `tsc --noEmit` |
| Serveur HTTP | **Hono** (+ `@hono/node-server`) | Interface, API, webhooks, MCP |
| Base | **PostgreSQL 18** via **`pg`** (node-postgres) — *remplace SQLite et better-sqlite3 depuis la [008](008-service-en-ligne.md)* | Plusieurs instances possibles, écritures simultanées, sauvegardes continues chez un hébergeur |
| Accès aux données | **Drizzle** (+ drizzle-kit pour les migrations) | Schéma en TS, migrations SQL lisibles |
| Validation | **Zod** | Toutes les entrées : API, formulaires, MCP, webhooks |
| Temps réel | **SSE minimal** | Une connexion par utilisateur qui dit seulement « tel objet a changé » |
| Interface | **React + Vite**, application d'une seule page servie par le serveur | Écrans |
| Navigation | **React Router** (mode bibliothèque) | Routes de l'interface |
| Données côté front | **TanStack Query** | Cache, rechargement quand le SSE prévient |
| Client API | **Client `hc` de Hono** | Types des routes partagés avec le front, sans génération |
| GitHub | **Octokit** (`@octokit/app`, `@octokit/webhooks`) | GitHub App, API, signature des webhooks |
| MCP | **SDK officiel** `@modelcontextprotocol/sdk` | Serveur MCP |
| Tests | **Vitest** + **Testing Library** ; **PGlite** (PostgreSQL en mémoire, 008) ; faux GitHub par interception de `fetch` | Tests serveur et écrans |
| Lint et format | **Biome** | Un seul outil, une seule config |
| Organisation | **Un seul paquet npm** : `src/server`, `src/web`, `src/shared` | — |

## Pourquoi

- **Node** : le SDK MCP officiel et Octokit le ciblent en premier ; il tourne sans souci sur le Pi (ARM64).
- **TS exécuté directement** : pas de dossier compilé à comprendre ni à déployer pour le serveur. Contrainte : la syntaxe doit être effaçable (pas d'`enum`, de `namespace` ni de propriétés de paramètres de constructeur), et les imports portent l'extension `.ts`.
- **Hono** : petit, suit les standards du web (`Request` / `Response`), utilitaire SSE intégré. Une route se teste **sans réseau** avec `app.request()`, ce qui sert le principe « les tests n'appellent jamais le vrai GitHub ».
- **PostgreSQL** (008) : une base que plusieurs instances partagent, que tous les hébergeurs gèrent, avec sauvegarde continue. Des **triggers** PL/pgSQL (`BEFORE UPDATE` / `DELETE` / `TRUNCATE` → `RAISE EXCEPTION`) rendent l'historique inaltérable au niveau de la base. « Vérifier le droit → appliquer → journaliser » reste une seule transaction, désormais asynchrone. *Choix initial : SQLite et better-sqlite3 (un fichier, transactions synchrones), écartés quand Cockpit est devenu un service vendu.*
- **Drizzle** : le schéma est la source des types ; les requêtes ressemblent à du SQL ; les migrations sont des fichiers SQL qu'on relit. Les triggers de l'historique s'écrivent à la main dans une migration.
- **Zod** : le SDK MCP décrit ses outils avec Zod ; une seule bibliothèque de validation pour tout, et chaque schéma donne aussi son type.
- **SSE minimal** : `EventSource` est natif dans le navigateur ; l'événement ne transporte pas de données, le front recharge par l'API normale. Une seule source pour les données.
- **React + Vite** : le plus documenté, bien maîtrisé par Claude. Pas de rendu côté serveur : tout est derrière une connexion, rien à référencer.
- **TanStack Query** : évite de réécrire à la main le cache, les états de chargement et d'erreur (principe « les erreurs se voient »).
- **Biome** : remplace ESLint + Prettier par un outil et une config. Les vérifications de types restent du ressort de `tsc`.
- **Un seul paquet** : une seule application ; un monorepo n'apporterait que de la configuration.

## Alternatives écartées

| Brique | Écartée | Raison |
|---|---|---|
| Moteur | Bun, Deno | Compatibilité moins sûre avec les paquets natifs ou écosystème plus petit |
| Exécution du TS | `tsc` / `tsx` | Une étape de build de plus, sans gain pour nous |
| Serveur | Next.js (v1) | Mélange serveur et client, comportements implicites (cache, rendu) : contraire à « compris » |
| Serveur | Express, Fastify | Types ajoutés après coup (Express) ; plus de concepts (Fastify) |
| Base | SQLite (choix initial) | Une seule instance possible, un seul écrivain à la fois, rarement proposé par les hébergeurs (008) |
| Données | Prisma, Kysely, SQL brut | Plus opaque (Prisma) ; schéma et migrations à la main (Kysely) ; pas de types (SQL brut) |
| Temps réel | WebSocket | Bidirectionnel inutile : les actions passent déjà en HTTP |
| Temps réel | Polling | Gardé comme **plan B** si le SSE pose problème derrière le proxy |
| Interface | Svelte, HTMX | Écosystème plus petit (Svelte) ; trop de JS fait main pour le Kanban et le suivi en direct (HTMX) |
| Lint | ESLint + Prettier | Deux outils et plus de config pour notre besoin |

## Conséquences

- La CI exécutera : `biome check`, `tsc --noEmit`, `vitest run`, `vite build`.
- L'image Docker contient Node, le code source du serveur et le front construit par Vite. PostgreSQL tourne à côté (Docker Compose sur le Pi, service géré chez l'hébergeur).
- Le `CLAUDE.md` du repo reprendra ces commandes et la contrainte de syntaxe TS effaçable.

## Décidé ailleurs

- **Composants UI et CSS** : en 0.3 (interface) : Tailwind + shadcn/ui.
- **Connexion et session** (flux GitHub App + cookie de session stocké en base) : en 1.3.
- **Exposition sur Internet** : **Cloudflare Tunnel**, décidé dans la [008](008-service-en-ligne.md).

## À vérifier au moment de la tranche concernée

- **4.2** : le branchement du transport HTTP du SDK MCP sur Hono.
- ~~**1.1** : que better-sqlite3 s'installe sur l'image Docker ARM64 du Pi sans compilation.~~ Sans objet depuis la 008 (`pg` est en JavaScript pur).
- **1.1 bis** : la version de PostgreSQL de PGlite. **Vérifié** : PGlite 0.5.11 fait tourner PostgreSQL 18.6, la même version majeure que la production.
