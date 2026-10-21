# 001 — Stack technique

- **Statut** : validée
- **Date** : 2026-10-18
- **Décidé par** : Dorian, avec Claude

## Contexte

Cockpit v2 est réécrit de zéro (aucun code de la v1). Il tourne sur un Raspberry Pi (Docker), joignable depuis Internet, et sert plusieurs développeurs. Dorian apprend TypeScript et relit toutes les PR : chaque brique doit pouvoir être **comprise**, pas seulement fonctionner. Moins de briques et moins de magie valent mieux que plus de fonctionnalités.

## Décision

| Brique | Choix | Rôle |
|---|---|---|
| Langage | **TypeScript** (mode strict) | Tout le code, serveur et interface |
| Moteur | **Node.js 24 LTS** (ou 26 dès qu'il est LTS) | Fait tourner le serveur |
| Exécution du TS | **Directement par Node** (*type stripping*), sans build du serveur | Une étape en moins ; les types sont vérifiés par `tsc --noEmit` |
| Serveur HTTP | **Hono** (+ `@hono/node-server`) | Interface, API, webhooks, MCP |
| Base | **SQLite** via **better-sqlite3** | Un fichier, des transactions synchrones |
| Accès aux données | **Drizzle** (+ drizzle-kit pour les migrations) | Schéma en TS, migrations SQL lisibles |
| Validation | **Zod** | Toutes les entrées : API, formulaires, MCP, webhooks |
| Temps réel | **SSE minimal** | Une connexion par utilisateur qui dit seulement « tel objet a changé » |
| Interface | **React + Vite**, application d'une seule page servie par le serveur | Écrans |
| Navigation | **React Router** (mode bibliothèque) | Routes de l'interface |
| Données côté front | **TanStack Query** | Cache, rechargement quand le SSE prévient |
| Client API | **Client `hc` de Hono** | Types des routes partagés avec le front, sans génération |
| GitHub | **Octokit** (`@octokit/app`, `@octokit/webhooks`) | GitHub App, API, signature des webhooks |
| MCP | **SDK officiel** `@modelcontextprotocol/sdk` | Serveur MCP |
| Tests | **Vitest** + **Testing Library** ; faux GitHub par interception de `fetch` | Tests serveur et écrans |
| Lint et format | **Biome** | Un seul outil, une seule config |
| Organisation | **Un seul paquet npm** : `src/server`, `src/web`, `src/shared` | — |

## Pourquoi

- **Node** : le SDK MCP officiel et Octokit le ciblent en premier ; il tourne sans souci sur le Pi (ARM64).
- **TS exécuté directement** : pas de dossier compilé à comprendre ni à déployer pour le serveur. Contrainte : la syntaxe doit être effaçable (pas d'`enum`, de `namespace` ni de propriétés de paramètres de constructeur), et les imports portent l'extension `.ts`.
- **Hono** : petit, suit les standards du web (`Request` / `Response`), utilitaire SSE intégré. Une route se teste **sans réseau** avec `app.request()`, ce qui sert le principe « les tests n'appellent jamais le vrai GitHub ».
- **SQLite** : sauvegarde = copie d'un fichier, pas de conteneur de base à faire tourner. Des **triggers** (`BEFORE UPDATE` / `BEFORE DELETE` → `RAISE(ABORT)`) rendent l'historique inaltérable au niveau de la base. La limite d'un seul écrivain à la fois ne gêne pas à notre échelle.
- **better-sqlite3** : synchrone, donc « vérifier le droit → appliquer → journaliser » dans une seule transaction est simple et sûr.
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
| Base | PostgreSQL | Un conteneur de plus et des sauvegardes plus lourdes, pour une instance qui n'en a pas besoin |
| Pilote | `node:sqlite` | Stabilité et prise en charge par Drizzle non vérifiées ; à revoir plus tard |
| Données | Prisma, Kysely, SQL brut | Plus opaque (Prisma) ; schéma et migrations à la main (Kysely) ; pas de types (SQL brut) |
| Temps réel | WebSocket | Bidirectionnel inutile : les actions passent déjà en HTTP |
| Temps réel | Polling | Gardé comme **plan B** si le SSE pose problème derrière le proxy |
| Interface | Svelte, HTMX | Écosystème plus petit (Svelte) ; trop de JS fait main pour le Kanban et le suivi en direct (HTMX) |
| Lint | ESLint + Prettier | Deux outils et plus de config pour notre besoin |

## Conséquences

- La CI exécutera : `biome check`, `tsc --noEmit`, `vitest run`, `vite build`.
- L'image Docker contient Node, le code source du serveur et le front construit par Vite.
- Le `CLAUDE.md` du repo reprendra ces commandes et la contrainte de syntaxe TS effaçable.

## Décidé ailleurs

- **Composants UI et CSS** : en 0.3 (interface) : Tailwind + shadcn/ui.
- **Connexion et session** (flux GitHub App + cookie de session stocké en base) : en 1.3.
- **Exposition sur Internet** (Caddy en HTTPS ou Cloudflare Tunnel) : en 1.2.

## À vérifier au moment de la tranche concernée

- **4.2** : le branchement du transport HTTP du SDK MCP sur Hono.
- **1.1** : que better-sqlite3 s'installe sur l'image Docker ARM64 du Pi sans compilation.
