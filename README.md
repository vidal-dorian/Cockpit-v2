# Cockpit v2

Service en ligne de pilotage des repos GitHub développés avec Claude Code. Le produit est décrit dans [`cockpit-v2-brief.md`](cockpit-v2-brief.md), l'ordre de construction dans [`docs/decoupage.md`](docs/decoupage.md), les choix dans [`docs/decisions/`](docs/decisions/) et leur résumé dans [`docs/architecture.md`](docs/architecture.md).

## Lancer en local

Il faut Node.js 24 ou plus récent et une base PostgreSQL 18. Pour en avoir une en local :

```sh
docker run --name cockpit-db -e POSTGRES_PASSWORD=cockpit -p 5432:5432 -d postgres:18
```

```sh
npm install
npm run build
DATABASE_URL=postgres://postgres:cockpit@localhost:5432/postgres npm start
```

Puis ouvrir http://localhost:3000. Les migrations sont appliquées au démarrage.

Pour développer, lancer `DATABASE_URL=postgres://postgres:cockpit@localhost:5432/postgres npm run dev:server` et `npm run dev:web` dans deux terminaux, puis ouvrir http://localhost:5173 : la page se recharge à chaque modification.

## Vérifier

```sh
npm test
npm run lint
npm run typecheck
```
