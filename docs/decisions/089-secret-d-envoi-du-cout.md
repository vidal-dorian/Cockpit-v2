# 089 — Un secret par utilisateur pour envoyer le coût (ticket #41)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #41 : le coût d'un run ne doit plus pouvoir être gonflé par un tiers), avec Claude
- **Dépend de** : [060 — Le coût et le budget](060-cout-et-budget.md), [088 — L'adresse de la session cloud n'est montrée qu'au lanceur](088-adresse-de-session-au-lanceur.md)
- **Modifie** : 060, choix A (« Sans secret ») et « Limites connues » (« Sans secret, quiconque connaît l'identifiant d'une session peut gonfler son coût »)

## Contexte

La 060 recevait la télémétrie sur `POST /v1/metrics` sans secret : quiconque connaissait l'identifiant d'une session pouvait gonfler son coût, jusqu'à arrêter le run ou bloquer les lancements du mois. La 088 a fermé l'exposition par Cockpit, pas l'envoi lui-même.

## Le choix

| Question | Décision |
|---|---|
| Le secret | Un par utilisateur : `HMAC-SHA256` de `metrics:<id de l'utilisateur>` avec la clé de chiffrement de l'instance, en base64url (`metricsTokenOf`, `cost.ts`). Rien n'est stocké ni journalisé ; il est stable tant que la clé de l'instance l'est |
| L'envoi | L'exportateur le met dans l'en-tête `x-cockpit-token`, via `OTEL_EXPORTER_OTLP_HEADERS=x-cockpit-token=<secret>` |
| La vérification | Sans en-tête : `401`, rien n'est ajouté. Sinon, pour chaque lancement dont la session est dans l'envoi, le secret doit être celui de son lanceur (`cloud_launches.user_id`), comparé en temps constant (`timingSafeEqual`) ; un seul lancement d'un autre utilisateur : `401` pour tout l'envoi. Les sessions inconnues restent ignorées (`200 {}`) |
| La page | `GET /api/me/launcher` rend `metricsToken` ; la ligne « Coût » de « Réglages », « Tâches cloud » ajoute la ligne `OTEL_EXPORTER_OTLP_HEADERS=…` avec ce secret, et dit que sans elle Cockpit refuse le coût |

## Ce qui reste

- **Les environnements déjà configurés** cessent de remonter le coût tant que la ligne d'en-tête n'y est pas collée : la page le dit.
- **Le secret est le même pour tous les environnements d'un utilisateur** et ne se renouvelle qu'avec la clé de l'instance ; changer cette clé invalide tous les secrets.
- **La 060 garde le reste** : un envoi répété compte deux fois en `delta`, la réponse est `200 {}` pour un corps valide.
