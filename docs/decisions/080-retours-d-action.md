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
| A | L'attente dans le bouton | Tout bouton désactivé pendant sa requête porte `aria-busy` (la requête en cours, 83 boutons). Il garde son aspect (pas le gris du désactivé), le curseur d'attente, et **le bouton pressé** montre l'anneau de la 079 avant son texte. Plusieurs boutons d'une même requête (Arrêter / Fermer un run) attendent tous ; seul celui sur lequel on a appuyé tourne (App marque le dernier bouton pressé, `data-pressed`) |
| B | La confirmation | Une ligne en bas de la page, « ✓ Ticket enregistré. », 4 s, au-dessus de la barre d'idée, centrée sur la colonne de la page ; lue par les lecteurs d'écran (`aria-live="polite"`). Déclarée sur l'action (`meta: { done: "…" }`), ou à l'appel quand le message dépend du geste (« Compte bloqué. » / « Compte débloqué. ») |
| C | Quelles actions | Celles qui ne disaient pas encore leur réussite : tickets (enregistré, supprimé, abandonné), US (validée, renvoyée à Claude, enregistrée, abandonnée, publiée sur GitHub, version gardée ou reprise), membres et invitations, jetons, codes Pro, plafonds, réglages du lanceur et de l'écriture des US, archivage, import d'un projet, équipes d'agents, tâches programmées et cloud, nuit (programmée, annulée, arrêtée), run (arrêt demandé, fermé), pièces jointes, branche supprimée, export, comptes bloqués. **Pas de doublon** : une action qui affiche déjà sa réussite (un commit, une PR, « Idée notée ») n'en reçoit pas une seconde ; ni les gestes dont l'effet se voit sous le doigt (étoile, interrupteur, thème, ordre de la file) |
| D | Les erreurs | Inchangées : elles restent à côté du geste, avec leur phrase. Une erreur ne part pas dans la ligne du bas, qui disparaît |

## Limites connues

- **Une action lancée sans clic** (un raccourci comme `V`) grise ses boutons sans anneau : aucun bouton n'a été pressé.
- **L'anneau élargit le bouton** le temps de la requête.
- **Une confirmation peut survivre à la page** qui l'a lancée (4 s) : c'est voulu, elle dit ce qui vient de se passer.
- **Les tests vérifient** que chaque bouton concerné porte `aria-busy`, la ligne de confirmation et un exemple bout en bout (enregistrer un ticket) ; l'anneau n'est vérifié qu'à l'œil dans Chromium.
