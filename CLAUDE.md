# Cockpit v2

Self-hosted control center for the GitHub repos developed with Claude Code. Read `cockpit-v2-brief.md` for the product, `docs/decoupage.md` for the slices and `docs/decisions/` for every decision already taken. Do not reopen a decision without saying so.

## Commands

| Command | What it does |
|---|---|
| `npm run dev:server` | API server on http://localhost:3000, restarts on change |
| `npm run dev:web` | Vite on http://localhost:5173, forwards `/api` to the server |
| `npm run build` | Builds the page into `dist/web` |
| `npm start` | Serves the API and the built page on http://localhost:3000 |
| `npm test` | Vitest, server and web |
| `npm run lint` | Biome: lint, format and import order (`npx biome check --write` fixes) |
| `npm run typecheck` | `tsc`, no emit |
| `npm run db:generate` | New migration in `drizzle/` from `src/server/db/schema.ts` |

CI runs lint, typecheck, test and build. All four must pass before a PR.

## Layout

- `src/server`: Hono app (`app.ts`, testable with `app.request()`), entry point (`index.ts`), database (`db/`).
- `src/web`: React page built by Vite. `api.ts` is the typed client of the server routes.
- `drizzle/`: generated SQL migrations, applied at startup. Never edit an applied migration; add a new one.

## Conventions

- Node runs the TypeScript directly (type stripping): only erasable syntax (no `enum`, `namespace` or constructor parameter properties) and relative imports end in `.ts` / `.tsx`.
- UI text in French; code, comments, commit messages and prompts in English.
- Colors and fonts are the tokens of `src/web/styles.css` (decision 003). Never hard-code a color.
- Components: Tailwind + shadcn/ui (decision 003).
- Tests never call Claude or the real GitHub. Server routes are tested with `app.request()` on an in-memory database (`openDatabase(":memory:")`); screens with Testing Library and a stubbed `fetch`.
- Every PR has a "Notions TS utilisées ici" section, in French, for Dorian who is learning TypeScript.
