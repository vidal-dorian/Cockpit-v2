# 088 — L'adresse de la session cloud n'est montrée qu'au lanceur (ticket #41)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #41 : le coût d'un run ne doit plus pouvoir être gonflé par un tiers), avec Claude
- **Dépend de** : [060 — Le coût et le budget](060-cout-et-budget.md), [054 — Lancer dans le cloud](054-lancer-dans-le-cloud.md), [076 — Plusieurs utilisateurs](076-plusieurs-utilisateurs.md)
- **Modifie** : 060, « Limites connues » (« l'identifiant n'est montré qu'à l'utilisateur »)

## Contexte

La 060 recevait la télémétrie sans secret et notait que quiconque connaît l'identifiant d'une session peut gonfler son coût, en disant que l'identifiant n'est montré qu'à l'utilisateur. Or sur un projet partagé, la page d'un run rendait l'adresse de la session (`sessionUrl`) à tout membre, même en lecture seule : il pouvait y écrire des messages et faire monter le coût du run, jusqu'au plafond.

## Le choix

| Question | Décision |
|---|---|
| Qui voit l'adresse | Seul le lanceur du lancement (`cloud_launches.user_id`) |
| La page d'un run | `GET /api/runs/:id` rend `cloud: { sessionUrl }` au lanceur ; aux autres membres `cloud` est un objet sans `sessionUrl` (la page ne montre pas le lien). `cloud` reste `null` pour un run sans lancement cloud |
| Les demandes à Claude | `claudeAsks` (onglet CI / CD, 067) reçoit l'utilisateur et rend `sessionUrl: null` pour les lancements d'un autre |
| Les autres routes | `custom-routines.ts` ne rend l'adresse qu'à son propriétaire (il filtre sur `routines.userId` et `cloud_launches.userId`) : rien à changer. La routine d'écriture des US du projet (`routines.ts`, `presentSchedule`) : `GET /api/projects/:id/routine` ne rend `lastRun.sessionUrl` qu'au propriétaire du projet, seul à pouvoir la lancer (bouton et planning) ; les autres membres reçoivent `null` |

## Ce qui reste

Un membre qui a déjà vu l'adresse avant ce changement, ou à qui le lanceur la transmet, pouvait encore gonfler le coût tant que `/v1/metrics` acceptait un envoi sans secret : la [089](089-secret-d-envoi-du-cout.md), dans la même PR, ferme ce reste.
