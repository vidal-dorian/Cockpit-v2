# 090 — Les limites de débit de GitHub ne font plus perdre d'événements (ticket #42)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #42), avec Claude
- **Dépend de** : [024 — Webhooks](024-webhooks.md), [025 — Une issue modifiée sur GitHub](025-issue-modifiee-sur-github.md)
- **Modifie** : 025, choix A (la reprise d'une livraison une minute après sa réservation, et le compte d'une tentative pour tout échec)

## Contexte

Quand GitHub limite le débit (429, ou 403 avec `Retry-After`), un appel échouait aussitôt, et une livraison de webhook comptait l'échec parmi ses cinq tentatives : en quelques minutes, un événement de PR ou de CI pouvait être abandonné sans avoir été traité. Le client GitHub du passage des livraisons était aussi recréé à chaque minute.

## Le choix

| Question | Décision |
|---|---|
| Un appel limité | Un crochet sur le client Octokit de `github.ts` (`retryAfterRateLimit`) attend le `Retry-After` indiqué puis réessaie une fois, sans autre compte. Les plugins officiels `@octokit/plugin-throttling` et `@octokit/plugin-retry` ne sont pas utilisés : le premier ignore `Retry-After` sur les 429 et les limites primaires, et aucune dépendance n'est ajoutée |
| Le plafond | Une attente de plus de 30 s n'est pas faite : l'appel échoue aussitôt, pour ne pas bloquer une route de l'écran pendant des minutes. Le délai de 10 s par requête reste |
| Ce qui est une limite de débit | `isRateLimited` : 429, ou 403 avec `Retry-After` ou `x-ratelimit-remaining` à `0` |
| Une livraison limitée | L'échec n'est pas compté dans `attempts` : elle ne compte pas parmi les cinq essais permis. Elle reste à traiter et sera reprise par un passage suivant |
| Une livraison en échec pour une autre raison | L'écart entre deux essais double : une livraison est reprise quand sa réservation date de plus de `2^attempts` minutes, où `attempts` vaut déjà 1 après le premier échec : les écarts sont de 2, 4, 8 puis 16 minutes (le premier essai est immédiat). Seule une livraison limitée à son premier passage (`attempts` à 0) est reprise après 1 minute. Au lieu d'une minute fixe |
| Le client des passages | `scheduleDeliveries` et `webhookRoutes` créent le lecteur GitHub une fois et le passent à `processDeliveries` (`deps.readGitHub`) : les passages d'une minute à l'autre réutilisent le même client et ses jetons d'installation |

## Ce qui reste

- **Une livraison limitée n'est pas comptée**, donc si GitHub limite sans fin, elle est reprise sans fin (avec la même attente que pour un échec, selon son `attempts`) ; rien ne l'abandonne.
- **Une attente de plus de 30 s** fait échouer l'appel : la route répond son erreur, et la livraison est reprise plus tard.
