# 054 — Les tickets complets

- **Statut** : proposée (à valider à la relecture de la PR)
- **Date** : 2026-11-08
- **Décidé par** : Dorian, avec Claude
- **Dépend de** : [014 — Les tickets](014-tickets.md), [017 — Les user stories](017-user-stories.md), [010 — Historique](010-historique.md) (D), [022 — La routine d'écriture des US](022-routine-ecriture-us.md), [045 — Quatre temps](045-interface-quatre-temps.md) (F : la barre « Noter une idée »)
- **Modifie** : la [014](014-tickets.md) I (le formulaire « Nouveau ticket » quitte l'onglet Tickets : on ne crée un ticket que par la barre « Noter une idée ») ; la [045](045-interface-quatre-temps.md) F (Entrée dans la barre n'enregistre plus tout de suite : elle l'agrandit)
- **Tranche** : 11.2 du [découpage](../decoupage.md)
- **Écrans** : [S09](../ecrans/S09_NoterIdee.png) (noter une idée en détail), [S14](../ecrans/S14_Tickets.png) (l'onglet Tickets)

## Contexte

Le brief (§6.2) veut une capture rapide depuis n'importe quel écran, une priorité et des étiquettes, et une recherche plein texte sur les tickets et les US. La 014 les avait repoussées. Le 2026-11-08, Dorian a choisi :
- **la priorité** : trois niveaux, les tickets « haute » en tête de liste, sans changer l'ordre de travail de Claude ;
- **les étiquettes** : libres, par projet, gardées dans Cockpit ;
- **la recherche** : dans les tickets et les US du projet ouvert ;
- **la création** : **seulement par la barre « Noter une idée »**. Entrée l'agrandit vers le haut en un panneau où l'on corrige le titre, écrit la description, change le projet, la priorité et les étiquettes. L'onglet Tickets n'a plus de formulaire de création, et aucun autre bouton ne crée de ticket.

## Les choix

| # | Question | Décision |
|---|---|---|
| A | Le stockage ? | Deux colonnes sur `tickets`. **`priority`** : `low`, `normal` (par défaut) ou `high`, avec un `CHECK`. **`tags`** : `text[]`, vide par défaut. Une étiquette est rognée, ses espaces intérieurs réduits à un, puis mise en **minuscules**. Elle fait de 1 à 30 caractères, sans le caractère NUL. Un ticket a **10 étiquettes au plus**, sans doublon |
| B | Les routes ? | `POST /api/projects/:id/tickets` et `PATCH /api/tickets/:id` acceptent `priority` et `tags`, facultatifs, validés par zod avant `act` (400 sinon, 014 C). Si une étiquette est invalide, toute la requête est refusée. `GET /api/projects/:id/tickets` et `GET /api/tickets/:id` les rendent. La liste est triée **par priorité** (haute, normale, basse), **puis du plus récent au plus ancien**. L'historique ne garde jamais les étiquettes, qui sont du texte libre (010 D) : `create_ticket` et `update_ticket` gardent `{ ticketId }` comme avant |
| C | La recherche ? | `GET /api/projects/:id/search?q=`, réservé aux membres, lisible sur un projet archivé. `q` fait de 1 à 100 caractères, sinon 400. Elle cherche **sans tenir compte de la casse**, comme une sous-chaîne : dans le titre et la description des **tickets**, et dans le récit (« en tant que », « je veux », « afin de »), les notes et les critères (Étant donné, Quand, Alors) des **US** du projet. Elle rend `{ tickets: [{ id, title, step }], stories: [{ id, ticketId, title, status }] }`, 50 de chaque au plus, du plus récent au plus ancien. Une lecture ne laisse pas d'entrée |
| D | La barre « Noter une idée » ? | On tape le titre, puis **Entrée agrandit la barre vers le haut** en un panneau (S09), avec en tête « Noter une idée » et « Claude en écrira les user stories ». Le panneau contient le **titre** (modifiable), la **description** (Markdown), le **projet** (celui de la page par défaut, modifiable), la **priorité** (« Priorité : normale ▾ ») et les **étiquettes** (« + étiquette » : on tape, Entrée l'ajoute, et Cockpit propose les étiquettes déjà utilisées dans le projet choisi). En bas : « Seuls le titre et le projet sont obligatoires. », **« Annuler »** et **« Noter »** (`Ctrl Entrée`). « Noter » crée le ticket, referme le panneau et dit « Idée notée » comme aujourd'hui. « Annuler » ou Échap referme le panneau et garde le titre dans la barre. La pièce jointe de S09 attend la 11.4 |
| E | La seule façon de créer ? | La barre de D est **la seule entrée** pour créer un ticket à la main. Le formulaire « Nouveau ticket » quitte l'onglet Tickets (014 I), et aucun bouton « Nouveau ticket » n'est ajouté ailleurs. Restent, parce qu'ils transforment autre chose en ticket et ne sont pas des formulaires de création : « En faire un ticket » sur un constat (051), « C'est un bug » sur une règle (047) et `create_ticket` pour Claude (MCP) |
| F | L'onglet Tickets (S14) ? | Phrase d'état : « 12 tickets, 2 attendent leurs user stories. ». En dessous, « Claude les écrira à 7 h, ou maintenant si tu veux. » quand la routine d'écriture des US est programmée (022) ; sinon, rien. Puis la rangée de S14 : la **loupe** (un champ « Chercher dans les tickets et les US »), les puces **« Ouverts · N »** (ni terminés, ni abandonnés ; puce choisie par défaut) et **« Nouveaux · N »** (étape « Nouveau »), le menu **« Étiquette »** (les étiquettes du projet), et le bouton **« Écrire les US maintenant »** quand la routine existe (022). « Importer les issues » attend la 11.3. Une ligne de la liste donne le titre, l'étape et son détail (« 4 US · 1 à valider, 2 prêtes, 1 en cours »), les étiquettes et « priorité haute » en mots à droite, et l'âge (« 10 min », « 2 j », « 2 sem. »). Une recherche remplace la liste par ses résultats : les tickets, puis les US, et un clic sur une US ouvre sa page |
| G | Le panneau d'un ticket ? | Un clic sur une ligne ouvre le ticket dans le panneau de droite (045). On y voit « Ticket », le titre, la description en Markdown (rendu sûr de la 014 H) et « Les user stories de ce ticket » avec leur statut. Le compteur « 2 sur 9 » et les flèches ↑ ↓ passent d'un ticket à l'autre. En bas : **« Ouvrir le ticket »** (bouton principal, vers `/tickets/:id`) et « Modifier · Supprimer ». Modifier ouvre la page du ticket en modification ; Supprimer demande une confirmation sur place (014 G, refusé si le ticket a des US, 017) |
| H | La page d'un ticket ? | « Modifier » change aussi la priorité et les étiquettes. La page les affiche sous le titre |
| I | Ce que Claude voit ? | `get_ticket` (MCP) rend aussi `priority` et `tags`. `create_ticket` ne change pas : Claude crée ses tickets en priorité normale, sans étiquette |
| J | La couleur ? | Le budget de la 045 : « priorité haute » et les étiquettes sont des mots dans une étiquette grise, sans rouge |

## Ce qui est repoussé

- **La pièce jointe** du panneau (S09) : tranche 11.4.
- **« Importer les issues »** (S14) : tranche 11.3.
- **La recherche globale** `Ctrl K` (S08) : tranche 15.3.
- **Renommer ou supprimer une étiquette** dans tout le projet : on la retire ticket par ticket.

## Limites connues

- **La recherche est une sous-chaîne**, pas un vrai moteur plein texte : « facture » trouve « factures », mais pas « facturé » ; les accents comptent.
- **Les étiquettes sont en minuscules** : « Export » et « export » sont la même étiquette.
- **La liste n'est pas paginée** (014) : un projet a peu de tickets.
