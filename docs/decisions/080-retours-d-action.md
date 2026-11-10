# 080 — Les retours d'action : l'attente dans le bouton, la confirmation

- **Statut** : proposée (à valider à la relecture de la PR) ; le code est construit
- **Date** : 2026-11-10
- **Décidé par** : Dorian (« l'utilisateur doit savoir si tout s'est bien passé, si ça charge, s'il y a eu une erreur »), avec Claude
- **Dépend de** : [079 — Le polish](079-polish-mouvement-et-retours.md) (les durées, l'anneau de `loading`, la limite « pas d'attente dans les boutons » que cette décision lève)
- **Modifie** : 079, « Limites connues » (les boutons montrent maintenant leur attente)
- **Écrans** : tous

## Contexte

L'inventaire des 79 actions de `src/web` (`useMutation`) :

| Ce que l'utilisateur doit savoir | Avant |
|---|---|
| **Ça charge** (une page, une liste) | Fait par la 079 (`loading`) |
| **Ça part** (j'ai cliqué) | Le bouton se grise, sans rien d'autre : rien ne distingue « en cours » de « désactivé » |
| **Ça a échoué** | Fait partout : chaque action a sa phrase d'erreur en français (`role="alert"`), à côté du geste |
| **Ça a marché** | Une vingtaine d'actions le disent (« Idée notée dans recettes. », un commit montré, une PR ouverte…) ; les autres changent l'écran sans un mot (enregistrer un ticket, inviter un membre, révoquer un jeton…) |

## Les choix

| # | Question | Décision |
|---|---|---|
| A | L'attente dans le bouton | Tout bouton désactivé pendant sa requête porte `aria-busy` : qu'il lise la requête lui-même (`x.isPending`) ou par une prop ou une variable (`pending`, `busy`, `validating`, `deleting`, `sending`, `canSend`, `canValidate`), une centaine de boutons. Il garde son aspect (pas le gris du désactivé), le curseur d'attente, et **le bouton pressé** montre l'anneau de la 079 avant son texte. Plusieurs boutons d'une même requête (Arrêter / Fermer un run) attendent tous ; seul celui sur lequel on a appuyé tourne (App marque le dernier bouton pressé, `data-pressed`) |
| B | La confirmation | Une ligne en bas de la page, « ✓ Ticket enregistré. », 4 s, au-dessus de la barre d'idée, centrée sur la colonne de la page ; lue par les lecteurs d'écran (`aria-live="polite"`). Déclarée sur l'action (`meta: { done: "…" }`), ou à l'appel quand le message dépend du geste (« Compte bloqué. » / « Compte débloqué. ») |
| C | Quelles actions | Celles qui ne disaient pas encore leur réussite : tickets (enregistré, supprimé, abandonné), US (validée, renvoyée à Claude, enregistrée, abandonnée, publiée sur GitHub, version gardée ou reprise, état de la PR rafraîchi), abonnement (code Pro activé), membres (rôle modifié, retiré, invitation annulée), codes Pro (modifié, révoqué), réglages de l'écriture des US, archivage, import d'un projet, équipes d'agents (enregistrée, supprimée), tâches programmées et cloud, nuit (programmée, annulée, arrêt demandé), run fermé, pièces jointes, branche supprimée, export, comptes bloqués ou débloqués. **Pas de doublon** : une action qui affiche déjà sa réussite n'en reçoit pas une seconde (un commit, une PR, « Idée notée », « Plafonds enregistrés. », « Heures enregistrées. », « Jeton révoqué. », le code Pro ou le lien d'invitation créés, « Arrêt demandé » sur la page du run) ; ni les gestes dont l'effet se voit sous le doigt (étoile, interrupteur, thème, ordre de la file) |
| D | Les erreurs | Inchangées : elles restent à côté du geste, avec leur phrase. Une erreur ne part pas dans la ligne du bas, qui disparaît. Une action dont le refus revient comme une réponse (et non une erreur) ne confirme qu'après avoir vérifié qu'il n'y a pas de refus (supprimer une équipe). **Pas de confirmation** quand la réponse ne dit pas que c'est fait : accepter une invitation (la page part chez GitHub, qui décide), relire les constats (la page dit déjà ce qui a été lu, ou les permissions qui manquent) |

## Limites connues

- **Une action lancée sans clic** (un raccourci comme `V`) grise ses boutons ; l'anneau ne tourne que si ce bouton est le dernier pressé.
- **Les boutons d'attente** comprennent ceux qui attendent sans être le geste (« Annuler » pendant un enregistrement) : ils le disent aux lecteurs d'écran, sans anneau.
- **L'anneau élargit le bouton** le temps de la requête.
- **Une confirmation peut survivre à la page** qui l'a lancée (4 s) : c'est voulu, elle dit ce qui vient de se passer.
- **Les deux boutons de relance** (« Afficher plus » du Journal, `pages.isFetchingNextPage` ; « Relancer le bilan » du projet, `health.isFetching`) portent aussi `aria-busy`, bien que ce soient des requêtes de lecture et non des mutations.
- **Les tests vérifient** que chaque bouton concerné porte `aria-busy` (lecture du code source : un drapeau sous un autre nom échapperait), la ligne de confirmation, un exemple bout en bout (enregistrer un ticket) et qu'un refus ne confirme rien. Le test 080 A ne lit que `isPending` et les alias `pending`, `busy`, `validating`, `deleting`, `sending`, `canSend`, `canValidate`, `canLaunch`, `canCommit`, `canDecide`, `off` : il ne couvre donc pas les deux boutons de relance ci-dessus. Pour l'anneau, il vérifie seulement que la règle CSS existe ; qu'il tourne à l'écran ne se voit qu'à l'œil dans Chromium.
