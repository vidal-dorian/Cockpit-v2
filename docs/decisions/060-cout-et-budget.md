# 060 — Le coût et le budget

- **Statut** : validée
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md) (le lanceur, la session rendue par `/fire`), [037 — Arrêter, relancer, fermer](037-arreter-relancer-fermer.md) (la demande d'arrêt), [058 — La file d'attente](058-file-d-attente.md)
- **Tranche** : 14.5 du [découpage](../decoupage.md)
- **Écrans** : [S33](../ecrans/S33_CoutBudget.png) (le coût et les plafonds), [S30](../ecrans/S30_Run_Fini.png) (« Coût du run »)

## Contexte

Brief §6.16 : le coût et les tokens de chaque run, remontés par la télémétrie de Claude Code ; un plafond par run, prérempli depuis les réglages ; au plafond, Cockpit demande l'arrêt du run et prévient l'humain. Démo : « La page d'un run affiche son coût ; au plafond, l'arrêt est demandé ».

Claude Code exporte sa télémétrie en OpenTelemetry ([doc](https://code.claude.com/docs/en/monitoring-usage)) : la métrique `claude_code.cost.usage` (USD, incrémentée après chaque requête, temporalité `delta` par défaut) et `claude_code.token.usage` (tokens, attribut `type`). Dans une session cloud, chaque point porte `ccr.session.id`. Les variables se règlent **sur l'environnement cloud, pas sur le run**, et la doc déconseille d'y mettre un jeton. Le 2026-11-08, Dorian a choisi : **le coût des runs cloud seulement**, rattaché par la session.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Recevoir ? | `POST /v1/metrics`, OTLP/HTTP en **JSON** (`Content-Type: application/json`, 415 sinon ; 1 Mio au plus, 413 au-delà ; 400 si le corps n'a pas la forme OTLP). **Sans secret** : Cockpit ne garde que les points dont `ccr.session.id` (attribut du point ou de la ressource) est la session d'un de ses lancements (054 : `cse_…` lu comme `session_…`) ; tout le reste est ignoré ; les points sont regroupés par session et par type, 100 sessions au plus par requête. La réponse est toujours `200 {}` pour un corps valide, qu'il ait servi ou non |
| B | Garder ? | Sur le lancement (`cloud_launches.cost_usd`, `cloud_launches.tokens`) : le coût vient avant le run et sert aussi aux routines. Un point `delta` (temporalité 1) s'ajoute ; un point `cumulative` (2) remplace s'il est plus grand. Un point négatif ou au-dessus de 1 000 $ est ignoré. Le coût d'un run est celui de son lancement ; un run local n'en a pas (« coût inconnu ») |
| C | Les plafonds ? | Trois réglages par utilisateur, facultatifs, en dollars : **par run**, **par nuit** (servira en 14.6), **par mois** (`users.budget_run_usd`, `budget_night_usd`, `budget_month_usd`). `GET` et `PUT /api/me/budgets`. Entrée `set_budgets` (`args: {}`) |
| D | Au plafond du run ? | Chaque lancement garde son plafond (`cloud_launches.budget_usd`) : celui de la fenêtre « Développer avec Claude » (champ « Plafond », prérempli par le plafond par run), sinon le plafond par run pour ce que Cockpit lance seul (file, relance, routine). Quand le coût reçu atteint le plafond et que le run tourne sans arrêt demandé, Cockpit **demande l'arrêt** (037 A) : entrée `request_stop`, acteur `system`, `detail: { reason: "budget" }` ; la page du run le dit (« Plafond atteint : arrêt demandé ») |
| E | Au plafond du mois ? | Quand le coût des lancements du mois (calendaire, en UTC) atteint le plafond par mois, **plus aucun lancement ne part** : `launchCloud` refuse `monthly_budget_reached` (409), pour les US, la file (qui se met en pause, `launch_failed`), la relance et les routines |
| F | Les écrans ? | La page **« Coût »** (S33, `/claude/cout`, lien de la page « Claude ») : la phrase d'état (« Claude a coûté N $ ce mois-ci. »), trois cases (ce mois-ci avec la jauge du plafond, par run en moyenne, par PR mergée ce mois-ci, comptée sur les entrées `pull_request_merged` de l'historique ; `GET /api/claude/cost`), le coût **par projet** du mois, et les trois plafonds à régler. Sur la page d'un run : **« Coût du run : 0,84 $ »** (S30), ou « coût inconnu ». Dans « Tâches cloud » (Réglages), une ligne « Coût » donne les variables à mettre dans l'environnement cloud, avec « Copier » : `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=<adresse de Cockpit>/v1/metrics`, et l'hôte de Cockpit à autoriser |
| G | L'historique ? | `set_budgets` ; `request_stop` (acteur `system`, raison `budget`). Les points reçus n'écrivent rien (ils arrivent chaque minute). Journal : « Plafonds réglés » |

## Ce qui est repoussé

- **Le coût des runs locaux** : il faudrait un jeton d'envoi par utilisateur dans ses réglages Claude Code, et rattacher une session locale à son run.
- **Prévenir sur le téléphone** au plafond : la 15.2, construite par la [072](072-pwa-et-notifications.md).
- **Le mois dans le fuseau de l'utilisateur** : UTC suffit pour commencer.

## Limites connues

- **Une estimation au prix catalogue** (doc), pas la facture.
- **Sans secret, quiconque connaît l'identifiant d'une session peut gonfler son coût** (pas le faire baisser) : l'identifiant n'est montré qu'à l'utilisateur, sur claude.ai et dans Cockpit.
- **Gonfler le coût d'une session peut atteindre le plafond du mois** et bloquer tous les lancements jusqu'au mois suivant : remonter ou retirer le plafond par mois les débloque.
- **En temporalité `cumulative`** (pas le défaut), une session a une série par modèle (et par type de tokens) : Cockpit garde la plus grande, pas leur somme.
- **Un envoi répété par l'exportateur** (nouvelle tentative) compte deux fois en `delta`.
- **L'arrêt reste coopératif** (037) : Claude le lit à sa prochaine étape ; le coût continue jusque-là.
- **Sans les variables dans l'environnement**, rien n'arrive : la page dit « coût inconnu ».
