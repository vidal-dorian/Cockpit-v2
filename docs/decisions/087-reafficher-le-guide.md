# 087 — Le guide de mise en route peut revenir (ticket #50)

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-20
- **Décidé par** : Dorian (ticket #50 : « j'ai masqué le guide trop vite »), avec Claude
- **Dépend de** : [075 — La mise en route](075-mise-en-route.md) (E), [073 — Ergonomie](073-ergonomie.md) (I), [081 — Les retours d'action](081-retours-d-action.md)
- **Modifie** : 075, choix E (« Pas de « réafficher » »)

## Le choix

| Question | Décision |
|---|---|
| Où | Une carte « Guide de mise en route » dans Préférences, avec un bouton **« Réafficher le guide de mise en route »** |
| Comment | `POST /api/me/onboarding/show` (session, sans corps, `favorites.ts`) remet `users.onboarding_hidden_at` à `null` et répond `{ ok: true }`, sans entrée d'historique (comme `hide`). Donc sur tous les appareils |
| Au retour sur l'accueil | Le guide est en haut, ses étapes cochées d'après la base comme avant : rien n'est remis à zéro. Un guide dont les sept étapes sont faites reste absent (`onboarding` est `null` s'il est fini) |
| Le geste | Bouton désactivé avec `aria-busy` pendant la requête, confirmation « Le guide est de retour sur l'accueil. » (`meta: { done }`, 081), ligne d'erreur s'il échoue ; la requête `["home"]` est invalidée |

La 075 E garde son texte pour l'historique ; le code fait foi.
