# Cockpit v2

Self-hosted control center for the GitHub repos developed with Claude Code. Read `cockpit-v2-brief.md` for the product, `docs/ecrans/` for the screens, `docs/decoupage.md` for the slices and `docs/decisions/` for every decision already taken, `docs/glossaire.md` for the one name of each notion in the UI; `docs/architecture.md` sums up the current architecture. Do not reopen a decision without saying so.

## Commands

| Command | What it does |
|---|---|
| `npm run dev:server` | API server on http://localhost:3000, restarts on change (needs only `DATABASE_URL`) |
| `npm run dev:web` | Vite on http://localhost:5173, forwards `/api` to the server |
| `npm run build` | Builds the page into `dist/web` |
| `npm start` | Serves the API and the built page on http://localhost:3000 (needs only `DATABASE_URL`, a PostgreSQL 18 URL; the start-up wizard then creates the GitHub App, decision 012) |
| `npm test` | Vitest, server and web (`npm test -- --project server` or `web` for one side; CI runs them in two jobs) |
| `npm run lint` | Biome: lint, format and import order (`npx biome check --write` fixes) |
| `npm run typecheck` | `tsc`, no emit |
| `npm run catalog:history` | Regenerates `catalog/history.json` after a change to `catalog/` (decision 049); needs a full clone |
| `npm run db:generate` | New migration in `drizzle/` from `src/server/db/schema.ts` |

CI runs lint, typecheck, test and build, plus a Docker smoke test of the stack (`scripts/smoke-test.sh`, job `docker`). All of them must pass before a PR.

## Layout

- `src/server`: Hono app (`app.ts`, testable with `app.request()`), entry point (`index.ts`), database (`db/`: PostgreSQL in production, PGlite in tests via `test-db.ts`).
- `src/web`: React page built by Vite. `api.ts` is the typed client of the server routes. `public/` holds the PWA files (manifest, icons, `sw.js`, decision 072), copied as they are into `dist/web`.
- `drizzle/`: generated SQL migrations, applied at startup. Never edit an applied migration; add a new one.
- `catalog/`: the agents (including `cartographer`, `rules-analyst`, `bug-hunter`, `security-reviewer`, `architect` and `upgrade-advisor`, plus `doc-writer` and `doc-reviewer`, written only by the Premium and Max teams), skills (`/dev-us`, `/write-us`, `/analyser`) and starter `CLAUDE.md` and the four starter teams (`teams/<level>.md`, decision 063) that « Préparer pour Claude » writes into a user's repo (decision 027), plus the starter CI workflows (`ci/<language>.yml`, decision 067) that the CI / CD tab commits; `history.json` lists the hashes of every past version (decision 049); copied into the Docker image.
- `docs/ecrans/`: every screen to build, as PNG and HTML, with an index giving each screen's slice, decisions and open points (decision 045). Build what the screen shows; when it contradicts a decision, the decision wins and you say so.
- `scripts/`: deployment on the Pi (`deploy.sh`), daily backup (`backup.sh`) and the stack's smoke test (`smoke-test.sh`).

## Developing a user story

Test-driven, always with the agents of `.claude/agents/`, in this order. Never start a step before the previous one is done.

1. **test-writer** writes the acceptance tests from the Given/When/Then criteria. They must fail, for the right reason.
2. **developer** implements until those tests pass, without touching them.
3. **reviewer** reviews the diff with a fresh context. Blocking findings go back to the developer, then to a new review, until the verdict is **ready**.
4. **doc-writer** updates every documentation the change reaches (README, `docs/`, this file), without touching code or tests.
5. **doc-reviewer** reviews the documentation diff only (what **doc-writer** changed): is it true against the code, complete for the change, and in the right language. Blocking findings go back to the doc-writer, then to a new doc review, until the verdict is **ready**.

Only then open the pull request.

## Conventions

- Node runs the TypeScript directly (type stripping): only erasable syntax (no `enum`, `namespace` or constructor parameter properties) and relative imports end in `.ts` / `.tsx`.
- UI text in French; code, comments, commit messages and prompts in English.
- One changelog line per pull request (release-please, `.github/workflows/cd.yml`, reads every commit of `main`): commits on a branch start with `chore: `, which the changelog hides; the pull request title is the line, `feat(<slice>): <what the user gets>` or `fix(<area>): <what was wrong>`. GitHub copies that title into the merge commit, so merge with a merge commit or a squash, never a rebase.
- Loading text gets the `loading` class (decision 080). Motion uses the duration and easing tokens of `styles.css`, and no transform on `main` or on an ancestor of the fixed right panel (it would re-anchor the fixed right panel).
- Colors and fonts are the tokens of `src/web/styles.css` (decisions 003 and 028; « Quatre temps » of decision 045 from slice 9.3, with its colour budget). Never hard-code a color. Every color token has a dark and a light value (decision 073); a new token needs both.
- Components: Tailwind + shadcn/ui (decision 003).
- A button disabled while its request runs also gets `aria-busy` (right after `disabled`); an action whose success the screen does not already say declares `meta: { done: "…" }` on its mutation, or calls `toast()` at the call site, only once the action really succeeded (decision 081).
- Every route or MCP tool that writes asks its role from `memberProject(db, userId, projectId, min)` (`min`: `read_only` by default, up to `owner`; decision 076); a new write gesture names its `min`.
- Tests never call Claude, the real GitHub, PostHog or a push service (`sendPush` is injected; `test-setup.ts` deletes `POSTHOG_KEY`, the telemetry tests stub `posthog-js` and `fetch`). Server routes are tested with `app.request()` on an in-memory PostgreSQL (`openTestDatabase()` from `src/server/db/test-db.ts`, PGlite: migrated once per run, one database per worker, emptied at the start of each test, so never `it.concurrent` on it). The server's test files are not isolated from each other (they share their modules, `isolate: false`): a test leaves no global state behind (timers and stubbed globals are reset after each test); screens with Testing Library and a stubbed `fetch`.
- An agent of `.claude/agents/` that also lives in `catalog/agents/` must match it, except for the parts only this repo needs: wrap them in `<!-- repo-specific -->` ... `<!-- /repo-specific -->` (each marker on its own line), with, inside, an optional `<!-- generic` ... `-->` comment that holds the catalog's own text (a comment, so the agent does not take it as its instruction). `src/server/agent-drift.test.ts` fails on any other difference.
- Every PR has a "Notions TS utilisées ici" section, in French, for Dorian who is learning TypeScript.
