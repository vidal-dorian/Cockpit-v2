# 025 — Une issue modifiée sur GitHub

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-10-30
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [020 — Issues GitHub](020-issues-github.md), [024 — Webhooks](024-webhooks.md), [018 — Décisions humaines](018-decisions-humaines.md), [010 — Historique](010-historique.md), [008 — Service en ligne](008-service-en-ligne.md)
- **Tranche** : 5.2 du [découpage](../decoupage.md)

## Contexte

L'issue d'une US n'est qu'un rendu de Cockpit (brief, règle 6) : on la modifie dans Cockpit, pas sur GitHub (020). Si quelqu'un la modifie quand même sur GitHub, le brief (§6.3) veut que Cockpit **le signale avec le diff, sans rien fusionner en silence**, et que l'utilisateur choisisse : **reprendre la version de GitHub** dans Cockpit, ou **garder celle de Cockpit** et remplacer celle de GitHub. Les livraisons de webhook sont enregistrées depuis la 5.1, sans traitement : cette tranche ajoute le traitement (024 D) et son premier usage.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le traitement des livraisons ? | Un passage lit les livraisons non traitées (`processed_at` vide), les **réserve** une à une par une requête atomique (`claimed_at` rempli si vide ou plus vieux d'une minute, comme la 020 G), les traite, puis remplit `processed_at`. Il tourne juste après la réponse 202 d'une livraison, et toutes les minutes pour reprendre ce qui a échoué ou a été interrompu. Une livraison sans traitement pour son événement est simplement marquée traitée. Un échec laisse `processed_at` vide et compte une tentative (`attempts`) ; à la **cinquième**, la livraison est marquée traitée avec une entrée `process_webhook` en `error` (010 C, raison dans les logs) |
| B | Quelles livraisons comptent ? | `issues` avec l'action `edited`, dont le repo est celui d'un projet suivi et dont le numéro est l'`issue_number` d'une US de ce projet. Une modification faite **par l'App elle-même** (`sender.login` vaut `<slug>[bot]`) est ignorée : c'est la synchronisation de Cockpit. Les fermetures, réouvertures et suppressions à la main restent pour plus tard |
| C | Quand l'issue a-t-elle changé ? | Quand le titre ou le corps reçus diffèrent du rendu actuel de l'US (`renderIssue`, 020 B). Cockpit garde alors sur l'US la version de GitHub (`issue_github_title`, `issue_github_body`) et la date (`issue_diverged_at`). Une nouvelle modification sur GitHub remplace la version gardée. Si la version reçue redevient égale au rendu, l'écart est effacé |
| D | Et la synchronisation pendant ce temps ? | **Elle n'écrit plus sur GitHub** tant que l'écart n'est pas tranché : une validation, une modification ou un abandon dans Cockpit ne doit pas écraser en silence ce qui a été écrit sur GitHub. La décision reste enregistrée dans Cockpit ; la page de l'US dit que l'issue attend un choix |
| E | Le diff ? | Sur `/us/:id`, une section « Issue modifiée sur GitHub » : la date, le titre s'il a changé, et un **diff ligne à ligne** du corps (lignes retirées et ajoutées, marquées par des mots et pas seulement par la couleur, 003). Le diff est une fonction pure, testée seule ; au-delà de 2 000 lignes d'un côté, il montre les deux versions l'une sous l'autre plutôt qu'un diff |
| F | « Garder la version de Cockpit » ? | `POST /api/stories/:id/issue/keep-cockpit` : efface l'écart et republie l'issue (020 F), qui reprend le rendu de Cockpit. Permis quel que soit le statut de l'US, comme « Republier » |
| G | « Reprendre la version de GitHub » ? | `POST /api/stories/:id/issue/take-github` : Cockpit relit la version gardée **avec son gabarit** (l'inverse de `renderIssue`, fonction pure testée par aller-retour) pour en tirer le récit, les notes et les critères, puis les applique comme « Modifier » (018 C : mêmes statuts, mêmes limites, dépendances inchangées) et republie l'issue. Si le corps ne suit plus le gabarit (une partie manque ou ne se relit pas), **409 `not_template`** : « La version de GitHub ne suit plus le gabarit de Cockpit : garde la version de Cockpit, ou recopie les changements avec « Modifier ». » Le titre de GitHub n'est pas repris (c'est le « je veux » du récit) |
| H | Les barrières ? | Comme les autres décisions humaines (018 A) : 503, 401, 404 pour l'US d'un autre, 409 `project_archived` ; 409 `no_divergence` s'il n'y a pas d'écart ; 409 `wrong_status` pour « Reprendre » sur une US qu'on ne peut plus modifier. Chaque refus écrit une entrée `refused` |
| I | L'historique ? | `issue_diverged` (acteur `github`, origine `webhook`, `args: { storyId, deliveryId }`, l'utilisateur et le projet de l'US) à chaque version reçue qui diffère ; `keep_cockpit_issue` et `take_github_issue` (humain, `ui`, `args: { storyId }`). Jamais le texte. Le Journal et l'historique de l'US les nomment |
| J | Où le voit-on encore ? | Sur la carte de l'US dans le Kanban (019) : « Issue modifiée sur GitHub », pour ne pas avoir à ouvrir chaque US |

## Ce qui est repoussé

- Une issue fermée, rouverte ou supprimée à la main, et ses labels changés : avec leurs propres règles, plus tard.
- Relancer à la main une livraison en échec, ou demander à GitHub celles qu'il n'a pas pu livrer : quand le besoin se présentera.
- Une fusion des deux versions ligne par ligne : le brief demande un choix, pas une fusion.

## Limites connues

- **Une modification faite par une autre App ou un autre bot** est traitée comme une modification humaine : seule l'App de Cockpit est reconnue.
- **Deux modifications rapides sur GitHub** peuvent arriver dans le désordre : Cockpit garde la dernière reçue, pas forcément la dernière écrite. « Garder la version de Cockpit » reste toujours possible.
- **Le gabarit relu** : un corps tronqué par Cockpit (020 B, « (tronqué…) ») ne se relit pas en entier : « Reprendre » le refuse (`not_template`).
- **Non vérifiable ici** : de vraies livraisons `issues.edited` de GitHub (les tests les fabriquent).
