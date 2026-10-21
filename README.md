# Cockpit v2

Centre de contrôle auto-hébergé pour les repos GitHub développés avec Claude Code. Le produit est décrit dans [`cockpit-v2-brief.md`](cockpit-v2-brief.md), l'ordre de construction dans [`docs/decoupage.md`](docs/decoupage.md) et les choix dans [`docs/decisions/`](docs/decisions/).

## Lancer en local

Il faut Node.js 24 ou plus récent.

```sh
npm install
npm run build
npm start
```

Puis ouvrir http://localhost:3000. La base SQLite est créée dans `data/cockpit.db`.

Pour développer, lancer `npm run dev:server` et `npm run dev:web` dans deux terminaux, puis ouvrir http://localhost:5173 : la page se recharge à chaque modification.

## Vérifier

```sh
npm test
npm run lint
npm run typecheck
```
